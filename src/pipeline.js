'use strict';
/** Do arquivo de video ate os clipes prontos na pasta de saida. */

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const media = require('./media');
const legenda = require('./legenda');
const momentos = require('./momentos');
const { encontrarCortes, diagnosticarCortes, corteDoTrecho, achatarPalavras, mmss } = require('./score');
const { gerarCopy, gerarGanchoDeTela } = require('./copy');
const { interpretar } = require('./intencao');
const sessoes = require('./sessoes');

const RAIZ = path.join(__dirname, '..');
// Em servidor, tudo que o app grava vai pro volume persistente (DADOS) - senao
// some a cada deploy, porque a imagem do container e descartavel. No PC local
// continua igual a sempre: dentro da propria pasta do projeto.
// as pastas de dados mudam quando a pessoa escolhe outro disco: sempre pergunte ao pastas.js
const pastas = require('./pastas');
const desempenho = require('./desempenho');
const MODELOS = process.env.MODELOS_DIR || path.join(RAIZ, 'modelos');
// Fontes que vem com o programa (usadas no gancho e na legenda queimada)
const FONTES = path.join(RAIZ, 'fontes');

/** A pasta de fontes vista da pasta de trabalho, do jeito que o filtro do ffmpeg aceita. */
function fontsdirRelativo() {
  if (!fs.existsSync(FONTES)) return null;
  const rel = path.relative(pastas.trabalho(), FONTES).split(path.sep).join('/');
  if (!/[:\s']/.test(rel)) return rel;
  // Outro disco ("D:...") ou caminho com espaco - como no programa instalado,
  // com os dados em Videos: leva uma copia das fontes pra dentro da pasta de
  // trabalho. Se nem isso der, cai na fonte do sistema.
  try {
    const copia = path.join(pastas.trabalho(), 'fontes');
    fs.mkdirSync(copia, { recursive: true });
    for (const nome of fs.readdirSync(FONTES)) {
      const destino = path.join(copia, nome);
      if (!fs.existsSync(destino)) fs.copyFileSync(path.join(FONTES, nome), destino);
    }
    return 'fontes';
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------- python

/**
 * Qual Python roda a transcricao. O instalar.bat cria um Python so do
 * programa na pasta "ambiente" - ele vem primeiro. Sem ele, nao basta achar
 * "um" Python: quem ja tinha outro instalado ficava com o faster-whisper num
 * e o programa chamando o outro ("faster-whisper nao instalado"). Entao cada
 * candidato e testado e vale o primeiro que consegue carregar o faster-whisper.
 */
let pythonEscolhido = null;

function acharPython() {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
  if (pythonEscolhido) return pythonEscolhido;

  const tentativas = [];
  if (process.platform === 'win32') {
    tentativas.push(path.join(RAIZ, 'ambiente', 'Scripts', 'python.exe'));
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const programas = process.env.ProgramFiles || 'C:\\Program Files';
    for (const v of ['312', '311', '310', '313', '314']) {
      tentativas.push(path.join(local, 'Programs', 'Python', 'Python' + v, 'python.exe'));
      tentativas.push(path.join(programas, 'Python' + v, 'python.exe'));
      tentativas.push(path.join('C:\\', 'Python' + v, 'python.exe'));
    }
  } else {
    tentativas.push(path.join(RAIZ, 'ambiente', 'bin', 'python'));
  }
  const existentes = tentativas.filter((t) => fs.existsSync(t));
  // e os do PATH, por ultimo ('python' sozinho nao existe no Debian)
  existentes.push(process.platform === 'win32' ? 'python' : 'python3');

  const { spawnSync } = require('child_process');
  for (const py of existentes) {
    const r = spawnSync(py, ['-c', 'import faster_whisper'], { windowsHide: true, timeout: 60000 });
    if (r.status === 0) { pythonEscolhido = py; return py; }
  }
  // nenhum carrega: devolve o primeiro, e o transcrever.py explica o motivo
  return existentes[0];
}

// ---------------------------------------------------------------- utilidades

function limparNome(s) {
  return String(s || 'clipe')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'clipe';
}

function assinaturaDoArquivo(arquivo) {
  const st = fs.statSync(arquivo);
  return crypto.createHash('sha1')
    .update(arquivo + '|' + st.size + '|' + Math.round(st.mtimeMs))
    .digest('hex').slice(0, 16);
}

// Um corte so, com o trecho inteiro: o TikTok aceita ate 10 minutos.
const MAX_CORTE_UNICO = 600;

/**
 * Confere o trecho marcado na tela: dentro do video e com pelo menos 3s.
 * Trecho errado vira erro na hora - melhor que ouvir o video inteiro e so
 * depois descobrir que nao da.
 * @returns {object|null} { inicio, fim }, ou null se nao veio trecho nenhum
 */
function conferirTrecho(t, duracaoVideo, modo) {
  if (!t) return null;
  const limite = Number(duracaoVideo) || Infinity;
  const inicio = Math.max(0, Math.min(Number(t.inicio), limite));
  const fim = Math.max(0, Math.min(Number(t.fim), limite));
  if (!isFinite(inicio) || !isFinite(fim) || fim - inicio < 3) {
    throw new Error('O trecho marcado é curto demais: precisa de pelo menos 3 segundos.');
  }
  if (modo === 'exato' && fim - inicio > MAX_CORTE_UNICO) {
    throw new Error('Um corte só pode ter até 10 minutos. Marque um trecho menor.');
  }
  return { inicio: Math.round(inicio * 100) / 100, fim: Math.round(fim * 100) / 100 };
}

// ---------------------------------------------------------------- transcricao

function transcrever(audio, destinoJson, duracao, modelo, idioma, aoProgredir, aoAvisar) {
  return new Promise((resolve, reject) => {
    const py = acharPython();
    const script = path.join(RAIZ, 'py', 'transcrever.py');
    const p = spawn(py, [
      script,
      '--audio', audio,
      '--saida', destinoJson,
      '--modelo', modelo || 'small',
      '--idioma', idioma || 'pt',
      '--duracao', String(duracao || 0),
    ], {
      windowsHide: true,
      env: Object.assign({}, process.env, {
        PYTHONIOENCODING: 'utf-8',
        HF_HOME: process.env.HF_HOME || MODELOS,
        // Em container, os.cpus() enxerga os nucleos do HOST, nao a cota da
        // maquina (cgroup). Numa VM de 2 vCPU rodando num host de 48 nucleos
        // isso pediria 46 threads: contexto trocando o tempo todo e a
        // transcricao fica MAIS LENTA do que com poucas threads. NUM_THREADS
        // deixa o dono do servidor fixar o numero certo.
        // modo leve usa metade dos nucleos; total, quase todos
        OMP_NUM_THREADS: process.env.NUM_THREADS || String(desempenho.nucleos()),
        NUM_THREADS: process.env.NUM_THREADS || String(desempenho.nucleos()),
        USAR_GPU: desempenho.usarCudaNaTranscricao() ? '1' : '0',
      }),
    });
    desempenho.aliviar(p);

    let resto = '';
    let erroFinal = '';

    p.stdout.setEncoding('utf8');

    p.stdout.on('data', (d) => {
      resto += d.toString();
      const linhas = resto.split(/\r?\n/);
      resto = linhas.pop();
      for (const linha of linhas) {
        const t = linha.trim();
        if (!t.startsWith('{')) continue;
        let ev;
        try { ev = JSON.parse(t); } catch (_) { continue; }
        if (ev.tipo === 'progresso' && aoProgredir) aoProgredir(ev.pct, ev.msg);
        if (ev.tipo === 'erro') erroFinal = ev.msg;
        if (ev.tipo === 'aviso' && aoAvisar) aoAvisar(ev.msg);
      }
    });

    p.stderr.setEncoding('utf8');

    p.stderr.on('data', (d) => {
      const t = d.toString();
      if (/error|Error|Traceback/.test(t)) erroFinal = erroFinal || t.split(/\r?\n/).slice(-6).join('\n');
    });

    p.on('error', (e) => reject(new Error('Nao consegui rodar o Python: ' + e.message)));
    p.on('close', (code) => {
      if (code === 0 && fs.existsSync(destinoJson)) resolve(JSON.parse(fs.readFileSync(destinoJson, 'utf8')));
      else reject(new Error(erroFinal || 'A transcricao falhou (codigo ' + code + ').'));
    });
  });
}

// ---------------------------------------------------------------- principal

/**
 * Tudo que vem antes de escolher corte: abrir o video, separar o audio,
 * transcrever, medir a energia e achar os picos. Cada passo fica em cache na
 * pasta trabalho, entao rodar o mesmo video de novo - ou pedir mais cortes
 * dele - pula direto pra parte rapida.
 *
 * @returns {Promise<object>} { info, assinatura, wav, jsonTranscricao, transcricao, energia, picos }
 */
async function prepararAnalise(video, opcoes, emitir, avisar) {
  fs.mkdirSync(pastas.trabalho(), { recursive: true });

  // ---- 1. inspecionar
  emitir(1, 'lendo', 'Abrindo o video...');
  await media.garantirFfmpeg();
  const info = await media.inspecionar(video);
  if (!info.temAudio) throw new Error('Esse video nao tem faixa de audio - sem audio nao da pra transcrever.');
  // Curto (um corte que ja vem pronto) vira
  // um corte so, inteiro, no processar. Abaixo disso nao cabe nem o gancho.
  if (info.duracao < 8) throw new Error('Video curto demais (' + Math.round(info.duracao) + 's). Preciso de pelo menos 8 segundos.');

  avisar({
    tipo: 'info',
    duracao: info.duracao,
    duracaoTexto: mmss(info.duracao),
    largura: info.largura,
    altura: info.altura,
    arquivo: path.basename(video),
  });

  const assinatura = assinaturaDoArquivo(video);
  const wav = path.join(pastas.trabalho(), assinatura + '.wav');
  // o v3 no nome invalida o cache quando a gente muda como transcreve; o idioma
  // tambem entra: trocar de lingua tem que transcrever de novo, nao reaproveitar
  const idiomaCache = /^[a-z]{2}$/.test(String(opcoes.idioma || '')) ? opcoes.idioma : 'pt';
  const jsonTranscricao = path.join(pastas.trabalho(), assinatura + '-' + (opcoes.modelo || 'small') + '-' + idiomaCache + '-v3.json');

  // ---- 2. audio
  if (!fs.existsSync(wav)) {
    emitir(2, 'audio', 'Separando o audio do video...');
    await media.extrairAudio(video, wav, info.duracao, (frac) => {
      emitir(2 + frac * 5, 'audio', 'Separando o audio... ' + Math.round(frac * 100) + '%');
    });
  } else {
    emitir(7, 'audio', 'Audio ja estava pronto de uma rodada anterior.');
  }

  // ---- 3. transcricao (a parte demorada)
  let transcricao;
  if (fs.existsSync(jsonTranscricao)) {
    emitir(60, 'transcricao', 'Transcricao ja existia - reaproveitando.');
    transcricao = JSON.parse(fs.readFileSync(jsonTranscricao, 'utf8'));
  } else {
    emitir(8, 'transcricao', 'Comecando a ouvir o video inteiro...');
    transcricao = await transcrever(
      wav, jsonTranscricao, info.duracao, opcoes.modelo, opcoes.idioma,
      (pct, msg) => {
        // o python vai de 2 a 94; aqui isso vira 8 a 60
        const p = 8 + (Math.max(0, Math.min(94, pct)) / 94) * 52;
        emitir(p, 'transcricao', msg);
      },
      (msg) => avisar({ tipo: 'aviso', msg })
    );
  }

  // ---- 4. energia do audio
  emitir(61, 'analise', 'Medindo a energia da fala...');
  let energia = [];
  try { energia = media.energiaPorSegundo(wav); } catch (_) { energia = []; }

  // ---- 4b. picos de reacao e mudanca de imagem
  // Em video de abertura de carta ou sorteio, o que prende nao esta na frase:
  // esta no instante da revelacao. Sem isso o sistema so enxerga argumento.
  // Varrer a imagem do video inteiro leva minutos e so depende do arquivo,
  // entao o resultado fica guardado junto da transcricao.
  let picos = [];
  if (opcoes.detectarMomentos !== false) {
    const usarVideo = opcoes.olharImagem !== false;
    const jsonPicos = path.join(pastas.trabalho(), assinatura + '-picos' + (usarVideo ? '' : '-voz') + '.json');

    if (fs.existsSync(jsonPicos)) {
      emitir(64, 'analise', 'Os momentos de reacao ja estavam medidos - reaproveitando.');
      try { picos = JSON.parse(fs.readFileSync(jsonPicos, 'utf8')); } catch (_) { picos = []; }
    } else {
      emitir(62, 'analise', 'Procurando os momentos de reacao...');
      try {
        const { ffmpeg } = await media.garantirFfmpeg();
        picos = await momentos.detectar({
          wav,
          video,
          ffmpeg,
          duracao: info.duracao,
          usarVideo: usarVideo,
          aoProgredir: (frac) => emitir(62 + frac * 2, 'analise',
            'Procurando os momentos de reacao... ' + Math.round(frac * 100) + '%'),
        });
        // Lista vazia nao entra no cache: pode ter sido uma falha passageira do ffmpeg
        if (picos.length) {
          try { fs.writeFileSync(jsonPicos, JSON.stringify(picos), 'utf8'); } catch (_) {}
        }
      } catch (e) {
        avisar({ tipo: 'aviso', msg: 'Nao consegui analisar os picos (' + e.message + ').' });
      }
    }

    if (picos.length) {
      avisar({ tipo: 'aviso', msg: 'Achei ' + picos.length + ' momentos de pico no video.' });
    }
  }

  return { info, assinatura, wav, jsonTranscricao, transcricao, energia, picos };
}

/**
 * @param {object} opcoes  { video, formato, legendar, quantidade, minDur, maxDur, modelo, idioma }
 * @param {function} avisar  (evento) => void
 */
async function processar(opcoes, avisar) {
  const video = opcoes.video;
  if (!fs.existsSync(video)) throw new Error('Nao achei esse arquivo: ' + video);
  conferirTrecho(opcoes.trecho, Infinity, opcoes.modoTrecho);

  // O perfil de corte tem a sua pasta e as suas regras. O id fica gravado
  // nas opcoes (e dai no sessao.json): editar e extrair mais depois seguem as
  // mesmas regras de quando o projeto nasceu.
  const sessao = sessoes.pegar(opcoes.sessao);
  opcoes.sessao = sessao.id;
  if (sessao.formatos && sessao.formatos.indexOf(opcoes.formato) < 0) {
    opcoes.formato = sessao.formatoPadrao;
  }
  const raiz = sessoes.pastaDeSaida(sessao, pastas.saida());
  fs.mkdirSync(raiz, { recursive: true });

  const emitir = (pct, etapa, msg) => avisar({ tipo: 'progresso', pct: Math.round(pct * 10) / 10, etapa, msg });
  const { info, assinatura, jsonTranscricao, transcricao, energia, picos } =
    await prepararAnalise(video, opcoes, emitir, avisar);

  // A descricao escrita manda no perfil, a nao ser que a pessoa tenha
  // escolhido um explicitamente na tela.
  const intencao = interpretar(opcoes.descricao);
  const perfilFinal = opcoes.perfil && opcoes.perfil !== "auto" ? opcoes.perfil : intencao.perfil;
  if (intencao.resumo) avisar({ tipo: "aviso", msg: "Procurando: " + intencao.resumo });

  // Um trecho marcado na tela manda em tudo: ou vira um corte so, do jeito
  // que a pessoa marcou, ou limita onde procurar os melhores.
  let trecho = conferirTrecho(opcoes.trecho, info.duracao, opcoes.modoTrecho);
  // Video do tamanho de um corte nao tem o que escolher: vira um corte so,
  // do comeco ao fim, e ganha gancho como qualquer outro.
  if (!trecho && info.duracao <= (opcoes.maxDur || 62) + 5) {
    trecho = { inicio: 0, fim: Math.round(info.duracao * 100) / 100 };
    opcoes.modoTrecho = 'exato';
    avisar({ tipo: 'aviso', msg: 'O vídeo já tem o tamanho de um corte: vai sair inteiro, num corte só.' });
  }
  const exato = !!trecho && opcoes.modoTrecho === 'exato';
  opcoes.trecho = trecho;

  // ---- 5. escolher os melhores momentos
  let cortes;
  if (exato) {
    emitir(64, 'analise', 'Montando o corte de ' + mmss(trecho.inicio) + ' a ' + mmss(trecho.fim) + '...');
    cortes = [corteDoTrecho(transcricao, energia, trecho, { momentos: picos, perfil: perfilFinal, intencao: intencao, sessao: sessao.id })];
  } else {
    emitir(64, 'analise', trecho
      ? 'Procurando os melhores momentos entre ' + mmss(trecho.inicio) + ' e ' + mmss(trecho.fim) + '...'
      : 'Procurando os melhores momentos...');
    cortes = encontrarCortes(transcricao, energia, {
      quantidade: opcoes.quantidade || 8,
      minDur: opcoes.minDur || 28,
      maxDur: opcoes.maxDur || 62,
      momentos: picos,
      perfil: perfilFinal,
      intencao: intencao,
      trecho: trecho,
      sessao: sessao.id,
    });
  }

  if (!cortes.length) {
    throw new Error(trecho
      ? 'Entre ' + mmss(trecho.inicio) + ' e ' + mmss(trecho.fim) + ' não coube nenhum corte de ' +
        (opcoes.minDur || 28) + ' a ' + (opcoes.maxDur || 62) + 's que comece e termine numa frase inteira. ' +
        'Aumente o trecho, escolha cortes curtos ou peça um corte só com o trecho inteiro.'
      : 'Nao consegui montar nenhum corte. O video pode ter pouca fala.');
  }


  // Pediu 12 e sairam 3? A pessoa merece saber por que, na hora, em vez de
  // achar que o programa quebrou.
  const pedidos = opcoes.quantidade || 8;
  let recado = null;
  if (!exato && cortes.length < pedidos) {
    recado = explicarPoucos(cortes.length, pedidos,
      diagnosticarCortes(transcricao, info.duracao, opcoes), opcoes);
    avisar({ tipo: 'aviso', msg: recado.titulo });
  }

  cortes = ordenarCortes(cortes, opcoes.ordem);

  titular(cortes, video, sessao);
  avisar({ tipo: 'cortes', cortes: cortes.map(semPalavras) });

  // ---- 6. gerar os arquivos
  const nomeBase = limparNome(path.basename(video, path.extname(video)));
  const carimbo = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const pastaSaida = path.join(raiz, nomeBase + '_' + carimbo);
  fs.mkdirSync(pastaSaida, { recursive: true });

  const vertical = opcoes.formato !== 'original';
  const prontos = await gerarClipes(cortes, {
    video: video,
    assinatura: assinatura,
    pastaSaida: pastaSaida,
    opcoes: opcoes,
    avisar: avisar,
    emitir: emitir,
  });

  // Guarda o que um "refazer" precisa saber. Sem isso, mudar o gancho ou
  // esticar dois segundos de um clipe obrigaria a transcrever o video de novo.
  gravarSessao(pastaSaida, {
    video: video,
    assinatura: assinatura,
    transcricao: jsonTranscricao,
    duracaoVideo: info.duracao,
    opcoes: opcoes,
    clipes: prontos,
  });

  // ---- 7. relatorio
  const relatorio = {
    videoOriginal: video,
    duracaoOriginal: info.duracao,
    gerado: new Date().toISOString(),
    sessao: sessao.id,
    formato: opcoes.formato,
    legendado: !!(opcoes.legendar && vertical),
    clipes: prontos,
  };
  fs.writeFileSync(path.join(pastaSaida, 'relatorio.json'), JSON.stringify(relatorio, null, 2), 'utf8');
  fs.writeFileSync(path.join(pastaSaida, 'RELATORIO.txt'), textoDoRelatorio(relatorio), 'utf8');

  emitir(100, 'pronto', 'Tudo pronto! ' + prontos.length + (prontos.length === 1 ? ' clipe' : ' clipes') + ' na pasta de saida.');
  avisar({ tipo: 'fim', pasta: pastaSaida, clipes: prontos, recado });

  return { pasta: pastaSaida, clipes: prontos, recado };
}

/**
 * Onde a legenda fica na vertical, em pixels a partir de baixo (tela de 1920).
 * No split, ela precisa cair sobre o gameplay - se ficar colada no rodape
 * some atras da barra de progresso do TikTok.
 */
function margemDaLegenda(opcoes, formatoEfetivo) {
  const formato = formatoEfetivo || opcoes.formato;
  // Se o clipe caiu pra vertical porque nao tinha webcam, a legenda nao pode
  // ficar na altura que faria sentido no split - ela ficaria no meio da tela.
  if (opcoes.margemLegenda && formato === opcoes.formato) {
    return Math.max(60, Math.min(1400, opcoes.margemLegenda));
  }
  return formato === 'split' ? 430 : 300;
}

/**
 * Ordem em que os clipes saem. O padrao e por nota: o clipe-01 e sempre o de
 * maior chance de viralizar, entao da pra comecar a postar antes mesmo de
 * terminar de gerar o resto.
 */
function ordenarCortes(cortes, ordem) {
  const lista = cortes.slice();

  if (ordem === 'tempo') lista.sort((a, b) => a.inicio - b.inicio);
  else lista.sort((a, b) => (b.nota - a.nota) || (a.inicio - b.inicio));

  lista.forEach((c, i) => { c.numero = i + 1; });
  return lista;
}

function semPalavras(c) {
  const copia = Object.assign({}, c);
  delete copia.palavras;
  return copia;
}

/** A copy do post: titulo que promete algo, sempre baseado no que foi dito. */
/**
 * Canal e titulo do video, guardados junto dele quando foi baixado por link
 * (<video>.cortador.json). Video do PC nao tem: fica so o nome do arquivo.
 */
function contextoDoVideo(video) {
  const nome = path.basename(video, path.extname(video)).replace(/s*[[^]]+]s*$/, '');
  let info = {};
  try { info = JSON.parse(fs.readFileSync(video + '.cortador.json', 'utf8')) || {}; } catch (_) {}
  return { texto: [info.titulo, nome].filter(Boolean).join(' · '), canal: info.canal || '' };
}

function titular(cortes, video, sessao, nome) {
  const contexto = contextoDoVideo(video);
  // titulos ja usados nessa leva: dois cortes da mesma live nao saem com o mesmo titulo
  contexto.evitar = new Set();
  for (const c of cortes) {
    // o gancho da tela (gerado depois, no render) usa o mesmo contexto
    c.contextoJogo = { texto: contexto.texto, canal: contexto.canal };
    const cp = gerarCopy(c, contexto, sessao, nome);
    contexto.evitar.add(String(cp.titulo).toLowerCase());
    c.titulo = cp.titulo;
    c.titulos = cp.titulos;
    // A legenda do post vai junto do clipe, pronta pra colar
    c.hashtags = cp.hashtags;
    c.legendaPost = cp.legenda;
  }
}

/**
 * Gera os arquivos de uma leva de cortes, um de cada vez, avisando a janela a
 * cada clipe pronto. A barra vai de 68 a 98 - o comeco dela e da analise.
 * O numero do arquivo vem do proprio corte: numa leva extra ele continua de
 * onde a anterior parou, em vez de sobrescrever o clipe-01.
 *
 * @param {object} ctx  { video, assinatura, pastaSaida, opcoes, avisar, emitir }
 */
async function gerarClipes(cortes, ctx) {
  const vertical = ctx.opcoes.formato !== 'original';
  const prontos = [];

  for (let i = 0; i < cortes.length; i++) {
    const c = cortes[i];
    // O gancho fica guardado no clipe: e o texto que a pessoa vai querer
    // reescrever depois, quando bater o olho no resultado e pensar em algo melhor.
    // ganchoFixo: o gancho escrito a mao pra um trecho marcado, no lugar do gerado
    c.gancho = ctx.opcoes.textoGancho === false ? null
      : (ctx.opcoes.ganchoFixo || gerarGanchoDeTela(c, ctx.opcoes.sessao));

    // A nota entra no nome: assim o ranking aparece na pasta do Windows tambem
    const base = 'clipe-' + String(c.numero).padStart(2, '0') +
                 '-nota' + c.nota + '-' + limparNome(c.titulo);

    const p0 = 68 + (i / cortes.length) * 30;
    const p1 = 68 + ((i + 1) / cortes.length) * 30;
    const rotuloEtapa = 'clipe ' + (i + 1) + ' de ' + cortes.length;
    ctx.emitir(p0, 'cortando', 'Gerando o ' + rotuloEtapa + '...');

    const pronto = await renderizarClipe({
      video: ctx.video,
      assinatura: ctx.assinatura,
      pastaSaida: ctx.pastaSaida,
      base: base,
      opcoes: ctx.opcoes,
      vertical: vertical,
      avisar: ctx.avisar,
      aoProgredir: (frac, msg) => ctx.emitir(p0 + (p1 - p0) * frac, 'cortando', msg),
      rotulo: rotuloEtapa,
    }, c);

    prontos.push(pronto);
    ctx.avisar({ tipo: 'clipe-pronto', clipe: pronto });
  }
  return prontos;
}

function textoDoRelatorio(r) {
  const linhas = [];
  linhas.push('CORTES GERADOS');
  linhas.push('='.repeat(70));
  linhas.push('Video: ' + path.basename(r.videoOriginal));
  linhas.push('Duracao original: ' + mmss(r.duracaoOriginal));
  if (r.sessao) linhas.push('Perfil: ' + sessoes.pegar(r.sessao).nome);
  linhas.push('Formato: ' + r.formato + (r.legendado ? ' com legenda queimada' : ''));
  linhas.push('Gerado em: ' + new Date(r.gerado).toLocaleString('pt-BR'));
  linhas.push('');

  for (const c of r.clipes) {
    linhas.push('-'.repeat(70));
    linhas.push('CLIPE ' + c.numero + '  |  nota de engajamento: ' + c.nota + '/100 (' + c.rotulo.texto + ')');
    linhas.push('Titulo sugerido: ' + c.titulo);
    linhas.push('No video original: ' + c.inicioTexto + ' ate ' + c.fimTexto + '  (' + c.duracao + 's)');
    linhas.push('Arquivo: ' + c.nomeArquivo);
    if (c.leva > 1) linhas.push('Extraido depois, na ' + c.leva + 'a leva de cortes');
    if (c.hashtags && c.hashtags.length) linhas.push('Hashtags: ' + c.hashtags.map((t) => '#' + t).join(' '));
    else if (c.tags && c.tags.length) linhas.push('Hashtags: ' + c.tags.map((t) => '#' + t).join(' '));
    linhas.push('Por que pontuou: ' + c.motivos.map((m) => m.fator + ' (' + (m.pontos > 0 ? '+' : '') + m.pontos + ')').join(', '));
    linhas.push('');
    linhas.push('Transcricao:');
    linhas.push(quebrar(c.texto, 68));
    linhas.push('');
  }
  return linhas.join('\n');
}

function quebrar(texto, largura) {
  const palavras = String(texto).split(/\s+/);
  const linhas = [];
  let atual = '';
  for (const p of palavras) {
    if ((atual + ' ' + p).trim().length > largura) { linhas.push(atual.trim()); atual = p; }
    else atual += ' ' + p;
  }
  if (atual.trim()) linhas.push(atual.trim());
  return linhas.join('\n');
}


/**
 * Vira o diagnostico em frase de gente.
 * @returns {object} { titulo, detalhe, sugestao }
 */
function explicarPoucos(sairam, pedidos, d, opcoes) {
  // com trecho marcado, a conta e so dele
  const oQue = opcoes.trecho ? 'trecho' : 'vídeo';
  const titulo = 'Você pediu ' + pedidos + ' cortes e saíram ' + sairam +
                 ' — é o que esse ' + oQue + ' dá.';

  const partes = [];
  const pct = d.duracao ? Math.round((d.falado / d.duracao) * 100) : 0;
  partes.push('O ' + oQue + ' tem ' + mmss(d.duracao) + ', mas só ' + mmss(d.falado) +
              ' dele tem alguém falando (' + pct + '%)' +
              (d.blocos > 1 ? ', divididos em ' + d.blocos + ' trechos separados por música ou ação' : '') + '.');
  partes.push('Cada corte precisa começar e terminar numa frase inteira, ' +
              'então o que sobra pra cortar é isso — não a duração do vídeo.');

  let sugestao = null;
  const minAtual = opcoes.minDur || 28;
  const maxAtual = opcoes.maxDur || 62;
  if (d.tetoCurto > d.teto) {
    sugestao = 'Com cortes mais curtos (' + d.minCurto + ' a ' + d.maxCurto +
               's) dava pra tirar até ' + d.tetoCurto + ' desse mesmo ' + oQue + ', ' +
               'em vez de ' + d.teto + ' com os ' + minAtual + ' a ' + maxAtual + 's de agora.';
  } else if (sairam >= d.teto) {
    sugestao = 'Não dá pra tirar mais sem repetir trecho: ' + d.teto +
               ' é o máximo que cabe sem dois cortes mostrarem a mesma coisa.';
  }

  return { titulo, detalhe: partes.join(' '), sugestao };
}

// ---------------------------------------------------------------- um clipe

/**
 * Gera UM clipe: confere o enquadramento, monta a legenda, corta e faz a
 * miniatura. Vive separado do laco principal porque o "refazer" usa exatamente
 * o mesmo caminho - so muda o corte que entra.
 *
 * @param {object} ctx  { video, assinatura, pastaSaida, base, opcoes, vertical,
 *                        avisar, aoProgredir, rotulo }
 * @param {object} c    o corte: { inicio, duracao, palavras, gancho, ... }
 */
async function renderizarClipe(ctx, c) {
  const opcoes = ctx.opcoes || {};
  const avisar = ctx.avisar || (() => {});
  const aoProgredir = ctx.aoProgredir || (() => {});
  const rotulo = ctx.rotulo || 'clipe';
  const mp4 = path.join(ctx.pastaSaida, ctx.base + '.mp4');

  // O layout do video muda ao longo da gravacao: as vezes e webcam + gameplay,
  // as vezes o streamer poe a cara em tela cheia. Aplicar o split nesse segundo
  // caso recorta o rosto em dois pedacos empilhados. Entao a gente confere
  // trecho a trecho se a janelinha da webcam esta mesmo ali.
  let formatoDoClipe = opcoes.formato || 'vertical';
  let observacao = null;

  // Quando ele poe a cara em tela cheia, nao existe webcam separada pra
  // recortar: o rosto JA e o video inteiro. Manter o split ali empilha dois
  // pedacos do proprio rosto e ainda desenha uma linha no meio dele. Nesses
  // trechos o certo e o oposto - foco so na cara, sem divisao nenhuma.
  if (formatoDoClipe === 'split' && opcoes.detectarWebcam !== false &&
      opcoes.recorte && opcoes.recorte.topo) {
    aoProgredir(0, 'Conferindo o enquadramento do ' + rotulo + '...');
    const d = await media.detectarWebcam(ctx.video, c.inicio, c.duracao, opcoes.recorte.topo);

    if (!d.temWebcam) {
      formatoDoClipe = opcoes.formatoSemWebcam || 'vertical';
      observacao = 'Aqui aparece so a cara dele - foquei no rosto, sem a divisao.';
      avisar({ tipo: 'aviso', msg: 'No ' + rotulo + ' so aparece a cara dele: foquei no rosto, sem divisao.' });
    } else if (d.misto) {
      observacao = 'O layout muda no meio desse trecho - confira o resultado.';
    }
  }

  // .ass fica na pasta trabalho e o ffmpeg roda com cwd la:
  // caminho curto e sem espaco evita problema de escape no filtro
  //
  // Legenda palavra-a-palavra e gancho na tela sao dois recursos separados
  // pra quem usa o programa - desligar um nao pode apagar o outro.
  const querLegenda = !!opcoes.legendar;
  const gancho = c.gancho || null;

  // texto fixo que a pessoa escreveu (meio da tela, em cima ou embaixo)
  const textoFixo = legenda.temTextoFixo(opcoes.textoFixo) ? opcoes.textoFixo : null;

  let arquivoAss = null;
  if ((querLegenda || gancho || textoFixo) && ctx.vertical) {
    arquivoAss = 'leg-' + ctx.assinatura + '-' + limparNome(ctx.base) + '.ass';
    legenda.gerarAss(c.palavras || [], c.inicio, path.join(pastas.trabalho(), arquivoAss), {
      tamanho: opcoes.tamanhoLegenda || 78,
      margemBaixo: margemDaLegenda(opcoes, formatoDoClipe),
      incluirPalavras: querLegenda,
      // O gancho da TELA e diferente do titulo do post: ele precisa criar
      // lacuna em 2 linhas, nao resumir o trecho.
      gancho: gancho,
      duracaoGancho: opcoes.duracaoGancho || 4,
      margemGancho: formatoDoClipe === 'split' ? 660 : 180,
      posicaoGancho: opcoes.posicaoGancho === 'meio' ? 'meio' : 'topo',
      textoFixo: textoFixo,
      alturaDivisao: legenda.alturaDaDivisao(formatoDoClipe, opcoes.recorte),
    });
  }

  await media.cortarClipe({
    video: ctx.video,
    inicio: c.inicio,
    duracao: c.duracao,
    destino: mp4,
    formato: formatoDoClipe,
    recorte: opcoes.recorte,
    qualidade: opcoes.qualidade || 'maxima',
    arquivoAss,
    // chamariz: 3s da carta na frente do corte (vem no proprio corte, porque
    // o instante da revelacao muda de clipe pra clipe)
    teaser: c.teaser || null,
    fontsdir: arquivoAss ? fontsdirRelativo() : null,
    pastaTrabalho: pastas.trabalho(),
    aoProgredir: (frac) => aoProgredir(frac,
      'Gerando o ' + rotulo + '... ' + Math.round(frac * 100) + '%'),
  });

  // legenda solta, pra editar depois
  legenda.gerarSrt(c.palavras || [], c.inicio, path.join(ctx.pastaSaida, ctx.base + '.srt'));

  const miniatura = path.join(ctx.pastaSaida, ctx.base + '.jpg');
  await media.gerarMiniatura(ctx.video, c.inicio + c.duracao / 2, miniatura, ctx.vertical);

  if (arquivoAss) { try { fs.unlinkSync(path.join(pastas.trabalho(), arquivoAss)); } catch (_) {} }

  return Object.assign(semPalavras(c), {
    arquivo: mp4,
    nomeArquivo: path.basename(mp4),
    base: ctx.base,
    formatoUsado: formatoDoClipe,
    observacao,
    miniatura: fs.existsSync(miniatura) ? miniatura : null,
    tamanhoMb: Math.round((fs.statSync(mp4).size / 1048576) * 10) / 10,
  });
}

// ---------------------------------------------------------------- refazer

const ARQUIVO_SESSAO = 'sessao.json';

function gravarSessao(pasta, dados) {
  try {
    fs.writeFileSync(path.join(pasta, ARQUIVO_SESSAO), JSON.stringify(dados, null, 2), 'utf8');
  } catch (_) {}
}

function lerSessao(pasta) {
  const arquivo = path.join(pasta, ARQUIVO_SESSAO);
  if (!fs.existsSync(arquivo)) {
    throw new Error('Essa pasta e de uma versao antiga do programa e nao guarda o que preciso pra refazer. Gere os cortes de novo.');
  }
  return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
}

/**
 * Refaz um clipe que ja existe com outro gancho e/ou outro comeco e fim.
 * Nao transcreve nada de novo: pega as palavras da transcricao guardada e
 * recorta o pedaco novo. Por isso leva segundos, nao minutos.
 *
 * @param {object} pedido  { pasta, numero, inicio, duracao, gancho }
 */
/**
 * De onde sai um clipe pra ser refeito. Clipe da live tem o PROPRIO original
 * (a versao deitada, com folga antes e depois) e a propria fala, guardados na
 * pasta do projeto - o buffer da live ja foi apagado. Clipe de video gravado
 * usa o video e a transcricao do projeto.
 * @returns {object} { video, transcricao, duracao, assinatura, zero }
 *   zero = em que segundo da live comeca o original (so clipe ao vivo)
 */
function fonteDoClipe(pasta, sessao, clipe) {
  const f = clipe && clipe.fonte;
  if (f && f.video) {
    // so o nome do arquivo: se a pasta mudar de lugar, continua achando
    const video = path.join(pasta, path.basename(f.video));
    return {
      video,
      transcricao: f.transcricao ? path.join(pasta, path.basename(f.transcricao)) : null,
      duracao: Number(f.duracao) || 0,
      assinatura: fs.existsSync(video) ? assinaturaDoArquivo(video) : 'clipe',
      zero: f.zeroNaLive == null ? null : Number(f.zeroNaLive),
    };
  }
  return {
    video: sessao.video,
    transcricao: sessao.transcricao,
    duracao: Number(sessao.duracaoVideo) || 0,
    assinatura: sessao.assinatura,
    zero: null,
  };
}

/**
 * Aplica o que a pessoa corrigiu na legenda: { "<inicio em centesimos>": "texto" }.
 * Texto vazio tira a palavra da legenda.
 */
/**
 * A chave de cada palavra: o inicio em centesimos. O Whisper as vezes da o
 * MESMO inicio pra duas palavras seguidas (16% delas nos testes) - ai a segunda
 * vira "123_2", a terceira "123_3"... senao corrigir uma mudava as duas.
 * Conta sobre a transcricao INTEIRA, igual a janela do editor.
 */
function chavesDasPalavras(todas) {
  const vistas = new Map();
  return todas.map((p) => {
    const cs = Math.round(Math.round(p.inicio * 100) / 100 * 100);
    const n = (vistas.get(cs) || 0) + 1;
    vistas.set(cs, n);
    return n === 1 ? String(cs) : cs + '_' + n;
  });
}

function aplicarEdicoes(palavras, edicoes, chaves) {
  if (!edicoes || typeof edicoes !== 'object') return palavras;
  chaves = chaves || chavesDasPalavras(palavras);
  const saida = [];
  for (let i = 0; i < palavras.length; i++) {
    const p = palavras[i];
    const chave = chaves[i];
    if (!Object.prototype.hasOwnProperty.call(edicoes, chave)) { saida.push(p); continue; }
    const texto = String(edicoes[chave] || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (texto) saida.push(Object.assign({}, p, { texto }));
  }
  return saida;
}

/**
 * Clipe da live guarda o enquadramento e o texto de quando saiu (a pessoa pode
 * ter mudado o formato no meio da live): refazer usa os dele, nao os do fim.
 */
function doClipeDaLive(clipe) {
  if (!clipe || !clipe.fonte) return {};
  const o = {};
  if (clipe.formatoUsado) o.formato = clipe.formatoUsado;
  if (clipe.recorte) o.recorte = clipe.recorte;
  if (clipe.textoFixo !== undefined) o.textoFixo = clipe.textoFixo;
  return o;
}

async function refazerClipe(pedido, avisar) {
  avisar = avisar || (() => {});
  const emitir = (pct, msg) => avisar({ tipo: 'progresso', pct: Math.round(pct), etapa: 'cortando', msg });

  const sessao = lerSessao(pedido.pasta);
  const antigo = (sessao.clipes || []).find((c) => c.numero === Number(pedido.numero));
  if (!antigo) throw new Error('Nao achei o clipe ' + pedido.numero + ' nessa pasta.');
  const fonte = fonteDoClipe(pedido.pasta, sessao, antigo);
  if (!fonte.video || !fs.existsSync(fonte.video)) {
    throw new Error('O video original saiu do lugar: ' + fonte.video);
  }

  emitir(4, 'Preparando o clipe ' + antigo.numero + '...');
  await media.garantirFfmpeg();

  // Onde o clipe comeca e termina agora. O minimo e 3s porque abaixo disso
  // nao cabe nem o gancho; o maximo e o que sobra ate o fim do video.
  const limite = fonte.duracao || Infinity;
  let inicio = pedido.inicio == null ? antigo.inicio : Number(pedido.inicio);
  let duracao = pedido.duracao == null ? antigo.duracao : Number(pedido.duracao);
  if (!isFinite(inicio)) inicio = antigo.inicio;
  if (!isFinite(duracao)) duracao = antigo.duracao;
  inicio = Math.max(0, Math.min(inicio, Math.max(0, limite - 3)));
  duracao = Math.max(3, Math.min(duracao, limite - inicio));
  inicio = Math.round(inicio * 100) / 100;
  duracao = Math.round(duracao * 10) / 10;

  // O que a pessoa corrigiu na legenda vale daqui pra frente (fica no clipe)
  const edicoes = pedido.edicoes && typeof pedido.edicoes === 'object' ? pedido.edicoes : (antigo.edicoesLegenda || null);
  // Legenda palavra por palavra neste clipe: o que a pessoa marcou no editor,
  // ou o que ja valia pra ele, ou o do projeto
  const legendar = typeof pedido.legendar === 'boolean' ? pedido.legendar
    : (typeof antigo.legendar === 'boolean' ? antigo.legendar : !!(sessao.opcoes || {}).legendar);

  // As palavras do trecho novo saem da transcricao que ja esta no disco.
  let palavras = [];
  let texto = antigo.texto;
  if (fonte.transcricao && fs.existsSync(fonte.transcricao)) {
    const t = JSON.parse(fs.readFileSync(fonte.transcricao, 'utf8'));
    const todas = achatarPalavras(t);
    const chaves = chavesDasPalavras(todas);
    const dentro = [], chavesDentro = [];
    todas.forEach((p, i) => { if (p.fim > inicio && p.inicio < inicio + duracao) { dentro.push(p); chavesDentro.push(chaves[i]); } });
    palavras = aplicarEdicoes(dentro, edicoes, chavesDentro);
    texto = palavras.map((p) => p.texto).join(' ').replace(/\s+/g, ' ').trim() || antigo.texto;
  } else if (legendar) {
    avisar({ tipo: 'aviso', msg: 'A fala desse clipe ainda não foi ouvida: refiz o vídeo, mas sem legenda.' });
  }

  // undefined = nao mexeu no gancho; string vazia = quer sem gancho nenhum
  const gancho = pedido.gancho === undefined
    ? (antigo.gancho || null)
    : (String(pedido.gancho).trim() || null);

  const corte = Object.assign({}, antigo, {
    inicio: inicio,
    duracao: duracao,
    fim: Math.round((inicio + duracao) * 100) / 100,
    // clipe da live mostra o horario da live, nao o do arquivo original
    inicioTexto: mmss((fonte.zero || 0) + inicio),
    fimTexto: mmss((fonte.zero || 0) + inicio + duracao),
    palavras: palavras,
    texto: texto,
    gancho: gancho,
    teaser: pedido.teaser === undefined ? antigo.teaser : pedido.teaser,
    legendar: legendar,
    edicoesLegenda: edicoes || undefined,
    editado: true,
  });

  const pronto = await renderizarClipe({
    video: fonte.video,
    assinatura: fonte.assinatura,
    pastaSaida: pedido.pasta,
    base: antigo.base || path.basename(antigo.nomeArquivo, '.mp4'),
    opcoes: Object.assign({}, sessao.opcoes || {}, doClipeDaLive(antigo), { legendar: legendar }),
    vertical: (antigo.fonte && antigo.formatoUsado ? antigo.formatoUsado : (sessao.opcoes || {}).formato) !== 'original',
    avisar: avisar,
    aoProgredir: (frac, msg) => emitir(8 + frac * 88, msg),
    rotulo: 'clipe ' + antigo.numero,
  }, corte);

  // Guarda o clipe novo no lugar do antigo, pra um proximo ajuste partir daqui
  sessao.clipes = (sessao.clipes || []).map((c) => (c.numero === pronto.numero ? pronto : c));
  gravarSessao(pedido.pasta, sessao);
  regravarRelatorio(pedido.pasta, sessao);

  emitir(100, 'Clipe ' + pronto.numero + ' refeito.');
  avisar({ tipo: 'clipe-refeito', clipe: pronto });
  return pronto;
}

/** Mantem o RELATORIO.txt e o relatorio.json de acordo com o que foi refeito. */
function regravarRelatorio(pasta, sessao) {
  const arquivo = path.join(pasta, 'relatorio.json');
  if (!fs.existsSync(arquivo)) return;
  try {
    const r = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    r.clipes = sessao.clipes;
    fs.writeFileSync(arquivo, JSON.stringify(r, null, 2), 'utf8');
    fs.writeFileSync(path.join(pasta, 'RELATORIO.txt'), textoDoRelatorio(r), 'utf8');
  } catch (_) {}
}

// ---------------------------------------------------------------- mais cortes

/**
 * Tira mais cortes de um projeto que ja existe, so de trecho que ainda nao
 * virou clipe. Reaproveita a transcricao e os picos guardados, entao costuma
 * pular direto pra geracao. Os clipes novos entram na mesma pasta, com a
 * numeracao continuando de onde parou.
 *
 * Com um trecho, a busca fica so dentro dele - ou, no modo "exato", o trecho
 * inteiro vira um corte do jeito que foi marcado.
 *
 * @param {object} pedido  { pasta, quantidade, minDur, maxDur, trecho, modo }
 */
async function extrairMais(pedido, avisar) {
  avisar = avisar || (() => {});
  const emitir = (pct, etapa, msg) => avisar({ tipo: 'progresso', pct: Math.round(pct * 10) / 10, etapa, msg });

  const sessao = lerSessao(pedido.pasta);
  if (!fs.existsSync(sessao.video)) {
    throw new Error('O video original saiu do lugar: ' + sessao.video);
  }

  // Mesmo enquadramento, gancho e legenda do projeto. So a quantidade, a
  // duracao e o trecho mudam nessa leva. O trecho de uma rodada anterior nao
  // vale aqui: "mais cortes" e do video todo, a nao ser que venha outro.
  const opcoes = Object.assign({}, sessao.opcoes || {});
  delete opcoes.trecho;
  delete opcoes.modoTrecho;
  delete opcoes.animacao; // projeto antigo, de quando existia a animacao por cima
  const quantidade = Math.max(1, Math.min(20, Math.round(Number(pedido.quantidade) || opcoes.quantidade || 6)));
  const minDur = Number(pedido.minDur) || opcoes.minDur || 28;
  const maxDur = Math.max(minDur + 5, Number(pedido.maxDur) || opcoes.maxDur || 62);
  Object.assign(opcoes, { quantidade, minDur, maxDur });

  const trecho = conferirTrecho(pedido.trecho, sessao.duracaoVideo, pedido.modo);
  const exato = !!trecho && pedido.modo === 'exato';

  const { info, assinatura, transcricao, energia, picos } =
    await prepararAnalise(sessao.video, opcoes, emitir, avisar);

  const existentes = sessao.clipes || [];
  const evitar = existentes.map((c) => ({ inicio: c.inicio, fim: c.inicio + c.duracao }));

  const intencao = interpretar(opcoes.descricao);
  const perfil = opcoes.perfil && opcoes.perfil !== 'auto' ? opcoes.perfil : intencao.perfil;
  // o perfil do projeto - nao confundir com o sessao.json
  const daSessao = sessoes.pegar(opcoes.sessao);

  // A IA fica de fora aqui de proposito: ela le o video inteiro e escolheria
  // de novo os mesmos momentos que ja viraram corte.
  let cortes;
  if (exato) {
    // Marcado na mao sai do jeito que foi marcado, mesmo encostando num corte que ja existe
    emitir(64, 'analise', 'Montando o corte de ' + mmss(trecho.inicio) + ' a ' + mmss(trecho.fim) + '...');
    cortes = [corteDoTrecho(transcricao, energia, trecho, { momentos: picos, perfil: perfil, intencao: intencao, sessao: daSessao.id })];
  } else {
    emitir(64, 'analise', trecho
      ? 'Procurando cortes novos entre ' + mmss(trecho.inicio) + ' e ' + mmss(trecho.fim) + '...'
      : 'Procurando trechos que ainda nao viraram corte...');
    cortes = encontrarCortes(transcricao, energia, {
      quantidade: quantidade,
      minDur: minDur,
      maxDur: maxDur,
      momentos: picos,
      perfil: perfil,
      intencao: intencao,
      evitar: evitar,
      trecho: trecho,
      sessao: daSessao.id,
    });
  }

  let recado = null;
  if (!exato && cortes.length < quantidade) {
    recado = explicarPoucosNovos(cortes.length, quantidade, existentes.length,
      diagnosticarCortes(transcricao, info.duracao, { minDur, maxDur, evitar, trecho }), minDur, trecho);
    avisar({ tipo: 'aviso', msg: recado.titulo });
  }

  if (!cortes.length) {
    emitir(100, 'pronto', 'Nenhum trecho novo pra cortar.');
    avisar({ tipo: 'fim', pasta: pedido.pasta, clipes: [], recado });
    return { pasta: pedido.pasta, clipes: [], recado };
  }

  // clipe-13, clipe-14... - nenhum arquivo novo pode sobrescrever um que ja existe
  cortes = ordenarCortes(cortes, opcoes.ordem);
  const ultimo = existentes.reduce((m, c) => Math.max(m, Number(c.numero) || 0), 0);
  const leva = existentes.reduce((m, c) => Math.max(m, c.leva || 1), 1) + 1;
  cortes.forEach((c) => { c.numero += ultimo; c.leva = leva; });

  titular(cortes, sessao.video, daSessao);
  avisar({ tipo: 'cortes', cortes: cortes.map(semPalavras) });

  const novos = await gerarClipes(cortes, {
    video: sessao.video,
    assinatura: assinatura,
    pastaSaida: pedido.pasta,
    opcoes: opcoes,
    avisar: avisar,
    emitir: emitir,
  });

  sessao.clipes = existentes.concat(novos);
  gravarSessao(pedido.pasta, sessao);
  regravarRelatorio(pedido.pasta, sessao);

  emitir(100, 'pronto', novos.length + (novos.length === 1 ? ' corte novo' : ' cortes novos') + ' na pasta do projeto.');
  avisar({ tipo: 'fim', pasta: pedido.pasta, clipes: novos, recado });
  return { pasta: pedido.pasta, clipes: novos, recado };
}

/** O explicarPoucos de quem ja tem cortes e pediu mais. */
function explicarPoucosNovos(sairam, pedidos, jaTinha, d, minAtual, trecho) {
  const onde = trecho ? 'entre ' + mmss(trecho.inicio) + ' e ' + mmss(trecho.fim) : 'nesse vídeo';
  const titulo = sairam
    ? 'Você pediu ' + pedidos + ' cortes novos e saíram ' + sairam + ' — é o que sobrou ' + onde + ' sem repetir trecho.'
    : 'Não sobrou trecho novo pra cortar ' + onde + ' com essa duração.';
  const detalhe = 'Os ' + jaTinha + ' cortes que já existem ficam de fora: nenhum corte novo repete ' +
    'a fala deles, e cada um ainda precisa começar e terminar numa frase inteira.';

  let sugestao = null;
  if (d.tetoCurto > sairam && minAtual > d.minCurto) {
    sugestao = 'Com cortes mais curtos (' + d.minCurto + ' a ' + d.maxCurto + 's) ainda cabem até ' +
               d.tetoCurto + ' trechos novos ' + onde + '.';
  } else if (!sairam) {
    sugestao = trecho
      ? 'Aumente o trecho, ou peça um corte só com o trecho inteiro.'
      : 'Esse vídeo já rendeu tudo o que tinha de fala.';
  }
  return { titulo, detalhe, sugestao };
}

module.exports = { chavesDasPalavras, processar, refazerClipe, extrairMais, assinaturaDoArquivo, transcrever, fontsdirRelativo, acharPython, fonteDoClipe };
