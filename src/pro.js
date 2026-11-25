'use strict';
/**
 * Cliente do Cortador Pro (Diretor de Cortes com IA na nuvem).
 *
 * O video NUNCA sai do PC do usuario: o PC continua baixando, extraindo o
 * audio, transcrevendo no Whisper e renderizando no FFmpeg. Para o servidor Pro
 * (Cloudflare Worker + Supabase) vai apenas a transcricao compactada (~25 KB),
 * junto da chave Pro (ou do ID anonimo do PC para os 3 testes gratis).
 */

const crypto = require('crypto');
const os = require('os');
const pastas = require('./pastas');
const atualizador = require('./atualizar');
const { achatarPalavras, montarFrases, mmss, rotulo } = require('./score');

const PLANOS_PADRAO = [
  {
    id: 'mensal',
    nome: 'Passe 30 dias · Cortador Pro',
    preco: 'R$ 24,90',
    detalhe: 'Pix ou cartão · 80 vídeos completos/mês na IA Gemini (até 20 cortes por vídeo) + Lives ilimitadas',
    destaque: true,
  },
  {
    id: 'trimestral',
    nome: 'Passe 90 dias · Cortador Pro',
    preco: 'R$ 59,90',
    detalhe: '3 meses completos · 100 vídeos completos/mês na IA Gemini + Lives ilimitadas',
    destaque: false,
  },
];

function machineId() {
  const cfg = pastas.lerConfig();
  if (cfg.machineId && /^[a-f0-9]{24}$/.test(cfg.machineId)) return cfg.machineId;
  const cpus = os.cpus() || [];
  const semente = [
    os.hostname(),
    os.platform(),
    os.arch(),
    cpus[0] ? cpus[0].model : '',
    cpus.length,
    (os.userInfo && os.userInfo().username) || '',
  ].join('|');
  const id = crypto.createHash('sha256').update(semente).digest('hex').slice(0, 24);
  try {
    cfg.machineId = id;
    pastas.gravarConfig(cfg);
  } catch (_) {}
  return id;
}

function chaveSalva() {
  const cfg = pastas.lerConfig();
  return String(cfg.chavePro || '').trim().toUpperCase();
}

const PROVEDORES = ['gemini', 'anthropic', 'openai'];

/** Qual IA o usuario escolheu: Gemini nativo (incluso) ou a propria chave do Claude/ChatGPT. */
function provedorSalvo() {
  const cfg = pastas.lerConfig();
  const provedor = PROVEDORES.includes(cfg.iaProvedor) ? cfg.iaProvedor : 'gemini';
  const chave = provedor !== 'gemini' ? String(cfg.iaChavePropria || '').trim() : '';
  const modelo = provedor !== 'gemini' ? String(cfg.iaModeloProprio || '').trim() : '';
  return { provedor, chave, modelo };
}

function resumoProvedor() {
  const p = provedorSalvo();
  return { provedor: p.provedor, temChavePropria: !!p.chave, modeloProprio: p.modelo };
}

function salvarProvedor(provedor, chave, modelo) {
  const prov = PROVEDORES.includes(provedor) ? provedor : 'gemini';
  const cfg = pastas.lerConfig();
  const chaveLimpa = String(chave || '').trim();
  if (prov !== 'gemini') {
    const atual = cfg.iaProvedor === prov ? String(cfg.iaChavePropria || '') : '';
    const final = chaveLimpa || atual;
    if (!final) throw new Error('Cole a sua chave de API para usar ' + (prov === 'anthropic' ? 'o Claude' : 'o ChatGPT') + '.');
    if (final.length < 20 || /\s/.test(final)) throw new Error('Essa chave de API parece incompleta. Copie de novo, inteira.');
    if (prov === 'anthropic' && !/^sk-ant-/i.test(final)) throw new Error('A chave do Claude começa com "sk-ant-". Confira se copiou a certa.');
    if (prov === 'openai' && !/^sk-/i.test(final)) throw new Error('A chave do ChatGPT (OpenAI) começa com "sk-". Confira se copiou a certa.');
    cfg.iaChavePropria = final;
    cfg.iaModeloProprio = String(modelo || '').trim().slice(0, 80);
  } else {
    delete cfg.iaChavePropria;
    delete cfg.iaModeloProprio;
  }
  cfg.iaProvedor = prov;
  pastas.gravarConfig(cfg);
  cacheEstado = null;
  return resumoProvedor();
}

function mascararChave(chave) {
  if (!chave) return '';
  if (chave.length <= 9) return chave;
  return chave.slice(0, 9) + '••••' + chave.slice(-4);
}

const URL_PRO_PADRAO = 'https://cortador-pro.gabrielhraa.workers.dev';

async function resolverApiUrl() {
  if (process.env.PRO_API_URL) return String(process.env.PRO_API_URL).trim().replace(/\/+$/, '');
  const cfg = pastas.lerConfig();
  if (cfg.proApiUrl && /^https?:\/\//i.test(cfg.proApiUrl)) {
    return String(cfg.proApiUrl).trim().replace(/\/+$/, '');
  }
  try {
    const rem = await atualizador.checarRemoto(false);
    if (rem && rem.proApiUrl) return rem.proApiUrl;
  } catch (_) {}
  return URL_PRO_PADRAO;
}

async function chamarWorker(caminho, metodo, corpo, timeoutMs) {
  const base = await resolverApiUrl();
  if (!base) {
    const e = new Error('O servidor do Cortador Pro ainda está sendo ativado. Tente novamente em breve.');
    e.semServidor = true;
    throw e;
  }
  const opcoes = {
    method: metodo || 'GET',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs || 15000),
  };
  if (corpo) opcoes.body = JSON.stringify(corpo);
  let r;
  try {
    r = await fetch(base + caminho, opcoes);
  } catch (e) {
    const demorou = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new Error(demorou
      ? 'O servidor do Cortador Pro demorou demais para responder. Confira sua internet e tente de novo.'
      : 'Sem conexão com o servidor do Cortador Pro. Confira sua internet e tente de novo.');
  }
  let dados = null;
  try { dados = await r.json(); } catch (_) {}
  if (!r.ok) {
    throw new Error((dados && dados.erro) || ('Erro ao comunicar com o Cortador Pro (HTTP ' + r.status + ').'));
  }
  return dados || {};
}

let cacheEstado = null;
let cacheEstadoEm = 0;

async function obterEstado(forcar) {
  const est = await obterEstadoBase(forcar);
  return Object.assign({}, est, resumoProvedor());
}

async function obterEstadoBase(forcar) {
  if (!forcar && cacheEstado && Date.now() - cacheEstadoEm < 60000) return cacheEstado;
  const chave = chaveSalva();
  const machine = machineId();
  const base = await resolverApiUrl();

  if (!base) {
    return {
      configurado: false,
      ativo: false,
      podeUsar: false,
      trialsRestantes: 3,
      chaveMascarada: mascararChave(chave),
      planos: PLANOS_PADRAO,
    };
  }

  try {
    const qs = '?machine=' + encodeURIComponent(machine) + (chave ? '&chave=' + encodeURIComponent(chave) : '');
    const d = await chamarWorker('/v1/status' + qs, 'GET', null, 10000);
    let chaveFinal = chave;
    if (!chaveFinal && d.ativo && d.chaveRecuperada) {
      chaveFinal = String(d.chaveRecuperada).trim().toUpperCase();
      try {
        const cfg = pastas.lerConfig();
        cfg.chavePro = chaveFinal;
        pastas.gravarConfig(cfg);
      } catch (_) {}
    }
    const trialsRest = Math.max(0, Number(d.trialsRestantes != null ? d.trialsRestantes : 3));
    const podeVideo = !!(d.ativo || (d.podeUsarVideo != null ? d.podeUsarVideo : trialsRest > 0));
    const podeLive = !!(d.ativo || (d.podeUsarLive != null ? d.podeUsarLive : (d.liveAtivo || (!d.liveUsado && trialsRest > 0))));
    const est = {
      configurado: true,
      ativo: !!d.ativo,
      podeUsar: !!(podeVideo || podeLive),
      podeUsarVideo: podeVideo,
      podeUsarLive: podeLive,
      plano: d.plano || null,
      expiraEm: d.expiraEm || null,
      cicloInicio: d.cicloInicio || null,
      renovaCotaEm: d.renovaCotaEm || null,
      usosMes: Number(d.usosMes || 0),
      limiteMes: Number(d.limiteMes || 80),
      usosFeitos: Number(d.usosFeitos || 0),
      trialsRestantes: trialsRest,
      liveUsado: !!d.liveUsado,
      liveAtivo: !!d.liveAtivo,
      liveExpiraEm: d.liveExpiraEm || null,
      liveRestanteSeg: Number(d.liveRestanteSeg != null ? d.liveRestanteSeg : (d.liveUsado ? 0 : 900)),
      conviteUpgrade: d.conviteUpgrade || null,
      chaveMascarada: d.ativo ? mascararChave(chaveFinal) : '',
      planos: Array.isArray(d.planos) && d.planos.length ? d.planos : PLANOS_PADRAO,
    };
    cacheEstado = est;
    cacheEstadoEm = Date.now();
    return est;
  } catch (_) {
    return {
      configurado: true,
      offline: true,
      ativo: !!chave,
      podeUsar: !!chave,
      podeUsarVideo: !!chave,
      podeUsarLive: !!chave,
      trialsRestantes: 0,
      liveUsado: false,
      liveAtivo: false,
      liveExpiraEm: null,
      liveRestanteSeg: 0,
      chaveMascarada: mascararChave(chave),
      planos: PLANOS_PADRAO,
    };
  }
}

async function iniciarTrialLive() {
  const d = await chamarWorker('/v1/live-trial', 'POST', {
    chave: chaveSalva(),
    machine: machineId(),
  }, 12000);
  cacheEstado = null;
  return d;
}

async function ativarChave(bruta) {
  const chave = String(bruta || '').trim().toUpperCase();
  if (chave.length < 8) throw new Error('Digite uma chave válida (ex.: CORT-XXXX-XXXX-XXXX).');
  const d = await chamarWorker('/v1/ativar', 'POST', { chave, machine: machineId() }, 15000);
  if (!d.ativo) throw new Error(d.erro || 'Essa chave não é válida ou já expirou.');
  const cfg = pastas.lerConfig();
  cfg.chavePro = chave;
  pastas.gravarConfig(cfg);
  cacheEstado = null;
  return obterEstado(true);
}

function sairDaChave() {
  const cfg = pastas.lerConfig();
  delete cfg.chavePro;
  pastas.gravarConfig(cfg);
  cacheEstado = null;
}

async function criarCheckout(planoId) {
  return chamarWorker('/v1/checkout', 'POST', {
    plano: String(planoId || 'mensal'),
    machine: machineId(),
  }, 15000);
}

async function checarPedido(pedidoId) {
  if (!pedidoId) return { pago: false };
  const qs = '?id=' + encodeURIComponent(pedidoId) + '&machine=' + encodeURIComponent(machineId());
  const d = await chamarWorker('/v1/pedido' + qs, 'GET', null, 10000);
  if (d.pago && d.chave) {
    const cfg = pastas.lerConfig();
    cfg.chavePro = String(d.chave).trim().toUpperCase();
    pastas.gravarConfig(cfg);
    cacheEstado = null;
    const estado = await obterEstado(true);
    return { pago: true, chave: cfg.chavePro, estado };
  }
  return { pago: false };
}

/**
 * Envia a transcricao enxuta pro Diretor IA Pro na nuvem e reconstroi os cortes
 * alinhados palavra por palavra no video local.
 */
async function analisarComIa(transcricao, picos, duracaoVideo, opcoes) {
  opcoes = opcoes || {};
  const todasPalavras = achatarPalavras(transcricao);
  const trecho = opcoes.trecho;
  const palavrasEscopo = trecho
    ? todasPalavras.filter((p) => p.fim >= trecho.inicio - 0.5 && p.inicio <= trecho.fim + 0.5)
    : todasPalavras;
  const frases = montarFrases(palavrasEscopo);
  if (!frases.length) throw new Error('O vídeo não tem fala suficiente para analisar.');

  // Compacta as frases pra caber ate 3h de live com custo minimo de tokens
  const blocos = frases.map((f) => ({
    i: Math.round(f.inicio * 10) / 10,
    f: Math.round(f.fim * 10) / 10,
    t: f.texto,
  }));

  const picosResumo = (picos || []).slice(0, 35).map((p) => ({
    t: Math.round(p.tempo * 10) / 10,
    forca: Math.round(p.forca * 10) / 10,
    tipo: p.tipo,
  }));

  const prov = provedorSalvo();
  const resposta = await chamarWorker('/v1/analisar', 'POST', {
    chave: chaveSalva(),
    machine: machineId(),
    provedor: prov.chave ? prov.provedor : 'gemini',
    apiKeyPropria: prov.chave || undefined,
    modeloProprio: prov.chave && prov.modelo ? prov.modelo : undefined,
    duracaoVideo: Math.round(duracaoVideo || 0),
    quantidade: opcoes.quantidade || 8,
    minDur: opcoes.minDur || 25,
    maxDur: opcoes.maxDur || 60,
    descricao: String(opcoes.descricao || '').trim().slice(0, 400),
    contexto: String(opcoes.contexto || '').trim().slice(0, 200),
    canal: String(opcoes.canal || '').trim().slice(0, 80),
    evitar: (opcoes.evitar || []).map((e) => [Math.round(e.inicio), Math.round(e.fim)]),
    trecho: trecho ? [Math.round(trecho.inicio), Math.round(trecho.fim)] : null,
    modoLive: !!opcoes.modoLive,
    sessaoLiveId: opcoes.sessaoLiveId || undefined,
    picos: picosResumo,
    blocos,
  }, 95000);

  cacheEstado = null; // atualiza contagem de usos/trials na proxima leitura

  const brutos = Array.isArray(resposta.cortes) ? resposta.cortes : [];
  const minDur = opcoes.minDur || 18;
  const maxDur = (opcoes.maxDur || 62) + 6;
  const cortes = [];

  for (const item of brutos) {
    let ini = Number(item.inicio);
    let fim = Number(item.fim);
    if (!isFinite(ini) || !isFinite(fim) || fim <= ini) continue;
    ini = Math.max(0, ini);
    if (duracaoVideo) fim = Math.min(duracaoVideo, fim);
    if (fim - ini < Math.max(8, minDur * 0.65) || fim - ini > maxDur + 8) continue;

    // Alinha o inicio e o fim nas palavras reais pra nao cortar silaba
    const pals = todasPalavras.filter((p) => p.fim > ini - 0.15 && p.inicio < fim + 0.15);
    if (pals.length >= 3) {
      ini = Math.max(0, Math.min(ini, pals[0].inicio));
      fim = Math.max(fim, pals[pals.length - 1].fim);
      if (duracaoVideo) fim = Math.min(duracaoVideo, fim);
    }

    const conflita = cortes.some((e) => {
      const sob = Math.min(e.fim, fim) - Math.max(e.inicio, ini);
      return sob > 0 && sob / Math.min(e.fim - e.inicio, fim - ini) > 0.28;
    });
    if (conflita) continue;

    const nota = Math.max(55, Math.min(99, Math.round(Number(item.nota) || 88)));
    const titulo = String(item.titulo || '').trim().slice(0, 95);
    const alts = Array.isArray(item.alternativas)
      ? item.alternativas.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 2)
      : [];
    const hashtags = Array.isArray(item.hashtags)
      ? item.hashtags.map((h) => String(h || '').replace(/^#/, '').trim().toLowerCase()).filter(Boolean).slice(0, 7)
      : [];
    const ganchoIa = String(item.ganchoTela || '').trim().slice(0, 65) || null;
    const motivoIa = String(item.motivo || 'Escolhido pela IA pelo arco completo e potencial de retenção').trim().slice(0, 140);
    const seoIa = item.seo && typeof item.seo === 'object' ? {
      tiktok: item.seo.tiktok ? String(item.seo.tiktok).trim() : '',
      shorts: item.seo.shorts ? String(item.seo.shorts).trim() : '',
      reels: item.seo.reels ? String(item.seo.reels).trim() : '',
    } : null;

    cortes.push({
      numero: cortes.length + 1,
      inicio: Math.round(ini * 100) / 100,
      fim: Math.round(fim * 100) / 100,
      duracao: Math.round((fim - ini) * 10) / 10,
      inicioTexto: mmss(ini),
      fimTexto: mmss(fim),
      nota,
      rotulo: rotulo(nota),
      titulo: titulo || 'Momento em destaque',
      tituloIa: titulo || null,
      titulosIa: [titulo].concat(alts).filter(Boolean).map((texto, idx) => ({ texto, estilo: idx === 0 ? 'ia' : 'alt' })),
      hashtagsIa: hashtags.length ? hashtags : null,
      seoIa,
      ganchoIa,
      tags: hashtags.slice(0, 4),
      motivos: [{ fator: '✨ ' + motivoIa, pontos: nota }],
      texto: pals.map((p) => p.texto).join(' ').replace(/\s+/g, ' ').trim(),
      palavras: pals,
      geradoPorIa: true,
    });
    if (cortes.length >= (opcoes.quantidade || 8)) break;
  }

  return {
    cortes,
    usouTrial: !!resposta.usouTrial,
    usouTrialVideo: !!resposta.usouTrialVideo,
    usouTrialLive: !!resposta.usouTrialLive,
    trialsRestantes: resposta.trialsRestantes,
    liveUsado: !!resposta.liveUsado,
    liveAtivo: !!resposta.liveAtivo,
    liveExpiraEm: resposta.liveExpiraEm || null,
    liveRestanteSeg: resposta.liveRestanteSeg,
  };
}

/**
 * Analisa um clipe recem-capturado de uma live ao vivo usando o Diretor IA Pro:
 * refina o comeco/fim nas frases certas e devolve titulo, gancho de tela e SEO por plataforma.
 */
async function refinarClipeAoVivo(transcricao, offsetPadrao, duracaoPadrao, duracaoOriginal, opcoes) {
  opcoes = opcoes || {};
  const minDur = Math.max(10, Math.round(duracaoPadrao * 0.55));
  const maxDur = Math.min(Math.round(duracaoOriginal || duracaoPadrao + 18), Math.round(duracaoPadrao * 1.45) + 6);
  const res = await analisarComIa(transcricao, opcoes.picos || [], duracaoOriginal, {
    quantidade: 1,
    minDur,
    maxDur,
    modoLive: true,
    sessaoLiveId: opcoes.sessaoLiveId,
    contexto: opcoes.contexto || 'Live ao vivo',
    canal: opcoes.canal || '',
  });
  const melhor = res.cortes && res.cortes[0] ? res.cortes[0] : null;
  return {
    corte: melhor,
    usouTrial: !!res.usouTrial,
    usouTrialLive: !!res.usouTrialLive,
    trialsRestantes: res.trialsRestantes,
    liveUsado: !!res.liveUsado,
    liveAtivo: !!res.liveAtivo,
    liveExpiraEm: res.liveExpiraEm || null,
    liveRestanteSeg: res.liveRestanteSeg,
  };
}

module.exports = {
  obterEstado,
  iniciarTrialLive,
  ativarChave,
  sairDaChave,
  criarCheckout,
  checarPedido,
  analisarComIa,
  refinarClipeAoVivo,
  chaveSalva,
  machineId,
  salvarProvedor,
  resumoProvedor,
};
