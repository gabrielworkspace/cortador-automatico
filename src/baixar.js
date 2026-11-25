'use strict';
/** Baixa o video direto do YouTube (ou de qualquer link que o yt-dlp entenda). */

try { require('dns').setDefaultResultOrder('ipv4first'); } catch (_) {}

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
// Em servidor os videos baixados vao pro volume persistente (DADOS); no PC
// continuam dentro da propria pasta do projeto, como sempre foi.
const pastas = require('./pastas'); // a pasta de videos baixados muda quando a pessoa escolhe outro disco

// Mesma historia do ffmpeg: o winget instala mas o PATH so vale em processo
// novo. Da pra apontar um binario proprio pela variavel YTDLP_PATH.
// Copia reserva baixada pelo proprio programa quando o yt-dlp some (o
// antivirus costuma apagar o yt-dlp.exe achando que e virus).
const PASTA_RESERVA = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'CortadorAutomatico', 'bin');
const YTDLP_RESERVA = path.join(PASTA_RESERVA, 'yt-dlp.exe');
const URL_YTDLP = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';

function acharYtDlp() {
  if (process.platform !== 'win32') {
    return [process.env.YTDLP_PATH, 'yt-dlp', '/opt/venv/bin/yt-dlp', '/usr/local/bin/yt-dlp'].filter(Boolean);
  }

  // o que vem com o instalador primeiro, mas sem desistir se ele sumiu
  const candidatos = [process.env.YTDLP_PATH, path.join(RAIZ, 'runtime', 'yt-dlp.exe'), path.join(RAIZ, '..', 'runtime', 'yt-dlp.exe'), YTDLP_RESERVA, 'yt-dlp.exe'].filter(Boolean);
  const base = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const dir of fs.readdirSync(base)) {
      if (!/yt-dlp/i.test(dir)) continue;
      const raiz = path.join(base, dir);
      for (const nome of fs.readdirSync(raiz)) {
        if (/^yt-dlp.*\.exe$/i.test(nome)) candidatos.push(path.join(raiz, nome));
      }
    }
  } catch (_) { /* pasta do winget pode nao existir */ }
  candidatos.push(path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WindowsApps', 'yt-dlp.exe'));
  return candidatos;
}

let YTDLP = null;

function testar(cmd) {
  return new Promise((resolve) => {
    const p = spawn(cmd, ['--version'], { windowsHide: true });
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });
}

/** Baixa o yt-dlp.exe oficial (GitHub do yt-dlp) pra pasta reserva. */
async function baixarYtDlpReserva() {
  fs.mkdirSync(PASTA_RESERVA, { recursive: true });
  const r = await fetch(URL_YTDLP, { redirect: 'follow', signal: AbortSignal.timeout(900000) }); // 15 min: cabe ate internet bem lenta
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const dados = Buffer.from(await r.arrayBuffer());
  if (dados.length < 1000000) throw new Error('arquivo incompleto');
  const tmp = YTDLP_RESERVA + '.baixando';
  fs.writeFileSync(tmp, dados);
  fs.renameSync(tmp, YTDLP_RESERVA);
}

let baixandoReserva = null;

async function garantirYtDlp() {
  if (YTDLP && (YTDLP === 'yt-dlp' || YTDLP === 'yt-dlp.exe' || fs.existsSync(YTDLP))) return YTDLP;
  YTDLP = null;
  for (const c of acharYtDlp()) {
    if (await testar(c)) { YTDLP = c; return YTDLP; }
  }
  if (process.platform === 'win32') {
    // nao achou em lugar nenhum: baixa de novo sozinho, uma vez so
    try {
      if (!baixandoReserva) baixandoReserva = baixarYtDlpReserva().finally(() => { baixandoReserva = null; });
      await baixandoReserva;
      if (await testar(YTDLP_RESERVA)) { YTDLP = YTDLP_RESERVA; return YTDLP; }
    } catch (_) { /* sem internet ou bloqueado: cai na mensagem abaixo */ }
    throw new Error('O yt-dlp (a peça que baixa os vídeos) sumiu e não consegui baixar de novo. ' +
      'Quase sempre é o antivírus que apagou: libere a pasta do Cortador Automático no antivírus e instale de novo ' +
      '(baixe o instalador em gabrielworkspace.github.io/cortador-automatico).');
  }
  throw new Error('Não encontrei o yt-dlp. Instale com: pip install yt-dlp');
}

/** Aceita link do YouTube em qualquer formato, e tambem de outros sites. */
function pareceLink(texto) {
  return /^https?:\/\/[^\s]+$/i.test(String(texto || '').trim());
}

/**
 * Consulta JSON nas APIs da Kick passando pela impressao digital TLS do Windows
 * (System32\curl.exe usa Schannel, que o Cloudflare da Kick aceita em ~200ms),
 * com fallback pra IPv6 puro e fetch nativo.
 */
async function consultarJsonKick(apiUrl) {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  if (process.platform === 'win32') {
    const curlSys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'curl.exe');
    if (fs.existsSync(curlSys)) {
      for (const flagRede of [['-4'], []]) {
        const res = await new Promise((resolve) => {
          execFile(curlSys, flagRede.concat(['-s', '-L', '-m', '10', '-A', ua, '-H', 'Accept: application/json', apiUrl]),
            { windowsHide: true, timeout: 12000, maxBuffer: 4 * 1024 * 1024 },
            (err, stdout) => {
              if (err || !stdout) return resolve(null);
              try {
                const j = JSON.parse(String(stdout).trim());
                if (j && typeof j === 'object' && !j.message?.includes?.('blocked')) return resolve(j);
              } catch (_) {}
              resolve(null);
            });
        });
        if (res) return res;
      }
    }
  }
  try {
    const r = await fetch(apiUrl, {
      headers: { 'User-Agent': ua, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) return await r.json();
  } catch (_) {}
  return null;
}

/**
 * A Kick tem dois formatos de link pro mesmo video (kick.com/canal/videos/uuid
 * e kick.com/video/uuid), e o extrator [kick:vod] do yt-dlp costuma tomar
 * NOT_FOUND na API da Kick. A API publica /api/v1/video/<uuid> devolve o
 * endereco direto do .m3u8 (source), o titulo e o canal.
 */
async function inspecionarVodKick(url) {
  const u = String(url || '').trim();
  const m = /^https?:\/\/(?:www\.)?kick\.com\/(?:[^/]+\/videos|video)\/([0-9a-fA-F-]{20,})/i.exec(u);
  if (!m) return null;
  const uuid = m[1];
  const j = await consultarJsonKick('https://kick.com/api/v1/video/' + uuid);
  if (!j || typeof j !== 'object') return null;
  const canal = (j.livestream && j.livestream.channel && (j.livestream.channel.user?.username || j.livestream.channel.slug)) ||
                (j.channel && j.channel.slug) || null;
  const slugCanal = (j.livestream && j.livestream.channel && j.livestream.channel.slug) ||
                    (j.channel && j.channel.slug) || null;
  const titulo = (j.livestream && j.livestream.session_title) || j.slug || 'Live da Kick';
  const durBruta = Number((j.livestream && j.livestream.duration) || j.duration || 0);
  // API da Kick devolve duracao em milissegundos (ex: 7200000 = 2h)
  const duracao = durBruta > 86400 ? Math.round(durBruta / 1000) : durBruta;
  const thumbBruta = (j.livestream && j.livestream.thumbnail) || j.thumbnail || null;
  const thumbnail = typeof thumbBruta === 'string' ? thumbBruta : (thumbBruta && (thumbBruta.src || thumbBruta.url)) || null;
  return { uuid, canal: canal || slugCanal, slugCanal, titulo, duracao, thumbnail, source: j.source || null };
}

async function normalizarUrl(url) {
  const u = String(url || '').trim();
  const m = /^https?:\/\/(?:www\.)?kick\.com\/video\/([0-9a-fA-F-]{20,})/.exec(u);
  if (!m) return u;

  const info = await inspecionarVodKick(u);
  const slug = info && (info.slugCanal || info.canal);
  return slug ? 'https://kick.com/' + slug + '/videos/' + m[1] : u;
}

function limparNome(s) {
  return String(s || 'video')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .replace(/\s+/g, '-').replace(/-+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 60) || 'video';
}

/**
 * Titulo e duracao antes de baixar. Tenta os mesmos caminhos do download:
 * de nada adianta o download saber furar o Cloudflare se a consulta que vem
 * antes dele morre na porta.
 */
async function espiar(url) {
  const kickVod = await inspecionarVodKick(url);
  if (kickVod && kickVod.source) {
    let duracao = kickVod.duracao || 0;
    if (!duracao) {
      try {
        const pl = await lerPlaylist(kickVod.source);
        duracao = Math.round(pl.duracao || 0);
      } catch (_) {}
    }
    return {
      titulo: kickVod.titulo,
      duracao,
      aoVivo: false,
      canal: kickVod.canal || '',
      thumbnail: kickVod.thumbnail || '',
      resolucoes: [1080, 720, 480],
      largura: 1920,
      altura: 1080,
    };
  }
  url = await normalizarUrl(url);
  const todas = estrategiasPara(url);
  // as 3 primeiras e, se precisar, o login do navegador (YouTube pedindo login)
  const tentativas = todas.slice(0, 3).concat(todas.filter((e, i) => i >= 3 && e.login));
  let ultimo = null;
  for (const e of tentativas) {
    try { return await espiarUma(url, e.args || [], false); }
    catch (err) {
      // Rede somente IPv6 (ex: 5G / CGNAT sem rota IPv4): tenta sem --force-ipv4
      if (/Sem conexao|demorou demais|network|unreachable/i.test(err.message)) {
        try { return await espiarUma(url, e.args || [], true); } catch (err2) { ultimo = err2; continue; }
      }
      ultimo = err;
      if (semJeito(err.message)) throw err;
    }
  }
  throw ultimo || new Error('Nao consegui ler esse link.');
}

function espiarUma(url, extras, semForcarIpv4) {
  return garantirYtDlp().then((bin) => new Promise((resolve, reject) => {
    const baseArgs = ['--no-warnings', '--socket-timeout', '15', '--dump-single-json', '--no-playlist'];
    if (!semForcarIpv4) baseArgs.push('--force-ipv4');
    const p = spawn(bin, baseArgs.concat(extras, [url]), { windowsHide: true });
    let saida = '';
    let erro = '';
    let estourou = false;
    // Nunca deixa a tela "buscando" pra sempre: se o site nao responder, desiste e explica.
    const relogio = setTimeout(() => { estourou = true; try { p.kill(); } catch (_) {} }, 45000);
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d) => { saida += d.toString(); });
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', (d) => { erro += d.toString(); });
    p.on('error', (e) => { clearTimeout(relogio); reject(e); });
    p.on('close', (code) => {
      clearTimeout(relogio);
      if (estourou) return reject(new Error('O site demorou demais pra responder. Confira sua internet e tente de novo.'));
      if (code !== 0) return reject(new Error(mensagemDeErro(erro)));
      try {
        const j = JSON.parse(saida);
        const thumbs = Array.isArray(j.thumbnails) ? j.thumbnails.filter((t) => t && /^https?:\/\//i.test(t.url || '')) : [];
        const thumb = j.thumbnail || (thumbs.length ? thumbs[thumbs.length - 1].url : '');
        const alts = new Set();
        for (const f of (j.formats || [])) {
          const h = Number(f && f.height);
          if (h >= 360) alts.add(h);
        }
        const maxAlt = Math.max(Number(j.height || 0), ...alts, 0);
        const padroes = [2160, 1440, 1080, 720, 480].filter((h) => !maxAlt || h <= maxAlt + 40);
        resolve({
          titulo: j.title || 'video',
          duracao: Number(j.duration || 0),
          // live acontecendo agora (o mesmo pedido ja responde, sem consultar de novo)
          aoVivo: j.is_live === true || j.live_status === 'is_live',
          canal: j.uploader || j.channel || '',
          thumbnail: thumb || '',
          resolucoes: padroes.length ? padroes : [1080, 720, 480],
          largura: j.width || 0,
          altura: j.height || 0,
        });
      } catch (e) { reject(new Error('Nao consegui ler os dados desse link.')); }
    });
  }));
}

/** Traduz o erro do yt-dlp pra algo que ajude quem esta na frente da tela. */
function mensagemDeErro(bruto) {
  const t = String(bruto || '');
  if (/private video/i.test(t)) return 'Esse video e privado.';
  if (/members-only|join this channel/i.test(t)) return 'Esse video e so para membros do canal.';
  if (/sign in to confirm|not a bot|cookies/i.test(t)) {
    return 'O YouTube pediu pra confirmar que não é um robô. Abra o YouTube no Firefox, Edge ou Chrome, entre na sua conta e tente de novo: o programa usa esse login só pra baixar, aqui no seu PC. Se não der, baixe o vídeo por fora e use "Arquivo do PC".';
  }
  if (/video unavailable|not available/i.test(t)) return 'Esse video esta indisponivel.';
  if (/age.?restrict/i.test(t)) return 'Esse video tem restricao de idade.';
  if (/unsupported url|no video/i.test(t)) return 'Nao reconheci esse link como um video.';
  // 404 no extrator generico quase sempre e link no formato que o site nao expoe
  if (/HTTP Error 404/i.test(t)) {
    return 'Esse link nao levou a nenhum video. Copie o endereco direto da barra do navegador, ' +
           'com o video aberto (na Kick fica assim: kick.com/canal/videos/...).';
  }
  if (/HTTP Error 4\d\d/i.test(t)) return 'O site recusou o download desse video.';
  // Texto exato: as regras de nova tentativa (IPv6) e semJeito procuram "Sem conexao" sem acento
  if (/urlopen error|getaddrinfo|network/i.test(t)) return 'Sem conexao com a internet.';
  if (/timed out|Read timed out|Connection reset|Connection aborted|Remote end closed|IncompleteRead|10054|10060|SSL/i.test(t)) {
    return 'A internet caiu ou ficou lenta no meio do download. Tente de novo: ele continua de onde parou.';
  }

  const ultima = t.split(/\r?\n/).filter((l) => /ERROR/i.test(l)).pop();
  return ultima ? ultima.replace(/^ERROR:\s*/i, '').slice(0, 200) : 'O download falhou.';
}

/**
 * Baixa o video.
 * @param {string} url
 * @param {object} opcoes  { limiteAltura }  1080 por padrao; 0 = melhor que existir
 * @param {function} aoProgredir  (fracao 0..1, mensagem)
 * @returns {Promise<string>} caminho do arquivo baixado
 */
/**
 * O YouTube muda o jeito de servir video toda hora, e o yt-dlp so acompanha se
 * estiver atualizado. Foi exatamente isso que quebrou aqui: uma versao de dois
 * meses atras tomava 403 em tudo. Entao, quando o download falha por bloqueio,
 * a gente atualiza sozinho e tenta de novo antes de dar erro pro usuario.
 */
function pareceDesatualizado(msg) {
  return /403|forbidden|recusou|nao consegui ler|precisa ser recarregad|reloaded|format is not available|formato/i.test(String(msg));
}

function atualizarYtDlp(bin) {
  // '-U' so funciona no binario standalone (pyinstaller) do Windows. Instalado
  // via pip num venv Linux ele sempre falha, e o processo roda como usuario
  // sem permissao de escrever no proprio venv de qualquer forma. Em servidor
  // quem atualiza o yt-dlp e o rebuild da imagem, nao o processo em producao.
  if (process.platform !== 'win32') return Promise.resolve(false);

  return new Promise((resolve) => {
    const p = spawn(bin, ['-U'], { windowsHide: true });
    let saida = '';
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d) => { saida += d.toString(); });
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', (d) => { saida += d.toString(); });
    p.on('error', () => resolve(false));
    p.on('close', () => resolve(/Updated yt-dlp|is up to date/i.test(saida)));
  });
}

/**
 * Cada video do YouTube responde melhor a um caminho diferente, e o que
 * funciona hoje pode ser bloqueado amanha. Entao em vez de uma tentativa so,
 * a gente percorre uma fila de estrategias ate alguma entregar o arquivo.
 */
// Quando o YouTube pede "confirme que nao e um robo", outro cliente ou o login
// que a pessoa ja tem no navegador quase sempre resolve. Os cookies so sao lidos
// aqui no PC pelo yt-dlp, pra esse download - nao vao pra lugar nenhum.
const LOGIN_DO_NAVEGADOR = [
  { nome: 'com o login do seu Firefox', args: ['--cookies-from-browser', 'firefox'], login: true },
  { nome: 'com o login do seu Edge', args: ['--cookies-from-browser', 'edge'], login: true, soWindows: true },
  { nome: 'com o login do seu Chrome', args: ['--cookies-from-browser', 'chrome'], login: true, soWindows: true },
  { nome: 'com o login do seu Brave', args: ['--cookies-from-browser', 'brave'], login: true, soWindows: true },
].filter((e) => process.platform === 'win32' || !e.soWindows);

const ESTRATEGIAS_YOUTUBE = [
  { nome: 'normal', args: [] },
  { nome: 'cliente padrao', args: ['--extractor-args', 'youtube:player_client=default'] },
  { nome: 'cliente da TV', args: ['--extractor-args', 'youtube:player_client=tv,tv_embedded'] },
  { nome: 'cliente do Safari', args: ['--extractor-args', 'youtube:player_client=web_safari,mweb'] },
  { nome: 'cliente do celular', args: ['--extractor-args', 'youtube:player_client=android_vr'] },
].concat(LOGIN_DO_NAVEGADOR, [
  { nome: 'qualquer formato', args: [], formatoLivre: true },
]);

/**
 * Kick, Twitch e afins ficam atras de Cloudflare, que barra pela impressao
 * digital da conexao. O --impersonate faz o yt-dlp se apresentar como um
 * navegador de verdade; os cookies do navegador resolvem o que exige login.
 */
const ESTRATEGIAS_GERAIS_BASE = [
  { nome: 'normal', args: [] },
  { nome: 'fingindo ser o Chrome', args: ['--impersonate', 'chrome'] },
  { nome: 'fingindo ser o Edge', args: ['--impersonate', 'edge'] },
  { nome: 'com os cookies do seu Chrome', args: ['--cookies-from-browser', 'chrome'], soWindows: true },
  { nome: 'com os cookies do seu Edge', args: ['--cookies-from-browser', 'edge'], soWindows: true },
  { nome: 'qualquer formato', args: ['--impersonate', 'chrome'], formatoLivre: true },
];

// Num servidor Linux nao existe perfil de Chrome/Edge instalado - essas duas
// tentativas sempre falhariam, so gastando tempo antes da que funciona de verdade.
const ESTRATEGIAS_GERAIS = process.platform === 'win32'
  ? ESTRATEGIAS_GERAIS_BASE
  : ESTRATEGIAS_GERAIS_BASE.filter((e) => !e.soWindows);

function estrategiasPara(url) {
  return /youtube\.com|youtu\.be/i.test(String(url)) ? ESTRATEGIAS_YOUTUBE : ESTRATEGIAS_GERAIS;
}

/** Nao adianta insistir quando o motivo nao muda com outra tentativa. */
function semJeito(msg) {
  return /privado|so para membros|restricao de idade|indisponivel|nao reconheci|Sem conexao/i.test(String(msg));
}

async function baixar(url, opcoes, aoProgredir) {
  opcoes = opcoes || {};
  const kickVod = await inspecionarVodKick(url);
  if (kickVod && kickVod.source) {
    // Baixa direto do .m3u8 da Kick (contorna o NOT_FOUND do extrator kick:vod do yt-dlp)
    const nomeBase = limparNome(kickVod.titulo) + ' [' + kickVod.uuid.slice(0, 8) + ']';
    return tentarBaixar(kickVod.source, Object.assign({}, opcoes, { nomeArquivo: nomeBase }), aoProgredir, { nome: 'Kick direto', args: [], formatoLivre: true });
  }
  url = await normalizarUrl(url);
  let ultimoErro = null;
  let jaAtualizou = false;

  const estrategias = estrategiasPara(url);
  for (let i = 0; i < estrategias.length; i++) {
    const e = estrategias[i];
    try {
      if (i > 0 && aoProgredir) {
        aoProgredir(0, 'Recusado. Tentando ' + e.nome + '...');
      }
      return await tentarBaixar(url, opcoes, aoProgredir, e, false);
    } catch (err) {
      if (/Sem conexao|network|unreachable/i.test(err.message)) {
        try { return await tentarBaixar(url, opcoes, aoProgredir, e, true); } catch (errIpv6) { err = errIpv6; }
      }
      ultimoErro = err;
      if (semJeito(err.message)) throw err;   // insistir nao vai mudar nada

      // Na primeira recusa, atualiza o baixador: quase sempre e isso.
      if (!jaAtualizou && estrategias === ESTRATEGIAS_YOUTUBE) {
        jaAtualizou = true;
        if (aoProgredir) aoProgredir(0, 'Atualizando o baixador...');
        try { await atualizarYtDlp(await garantirYtDlp()); } catch (_) {}
      }
    }
  }

  // Guarda o erro cru num log: a mensagem amigavel some da tela, mas quando
  // um video especifico nao baixa, o motivo tecnico esta aqui pra investigar.
  try {
    const pastaTrabalho = pastas.trabalho();
    fs.mkdirSync(pastaTrabalho, { recursive: true });
    fs.appendFileSync(
      path.join(pastaTrabalho, 'erros-download.log'),
      '\n=== ' + new Date().toISOString() + ' ===\n' +
      'link: ' + url + '\n' +
      'todas as ' + estrategias.length + ' tentativas falharam\n' +
      'ultimo erro: ' + ((ultimoErro && ultimoErro.bruto) || (ultimoErro && ultimoErro.message) || '?') + '\n',
      'utf8'
    );
  } catch (_) { /* log e diagnostico, nao pode derrubar nada */ }

  const base = (ultimoErro && ultimoErro.message) || 'O download falhou.';
  throw new Error(base + ' Tentei ' + estrategias.length + ' caminhos diferentes. Baixe o arquivo por fora e use "Arraste um vídeo do seu PC".');
}

async function tentarBaixar(url, opcoes, aoProgredir, estrategia, semForcarIpv4) {
  opcoes = opcoes || {};
  estrategia = estrategia || { args: [] };
  const bin = await garantirYtDlp();
  fs.mkdirSync(pastas.baixados(), { recursive: true });

  const limite = opcoes.limiteAltura === 0 ? null : (opcoes.limiteAltura || 1080);

  // Pede H.264 (avc1) na frente de tudo por dois motivos: o YouTube costuma
  // devolver 403 nos formatos AV1 mais novos, e o ffmpeg processa H.264 bem
  // mais rapido na hora de cortar - que e o que a gente faz logo depois.
  const alt = limite ? '[height<=' + limite + ']' : '';
  const formato = estrategia.formatoLivre
    ? (limite ? 'b' + alt + '/bv*' + alt + '+ba/b/bv*+ba' : 'b/bv*+ba')
    : [
        'bv*[vcodec^=avc1]' + alt + '+ba[acodec^=mp4a]',
        'bv*[vcodec^=avc1]' + alt + '+ba',
        'bv*' + alt + '+ba',
        'b' + alt,
        'bv*+ba/b',
      ].join('/');

  const modelo = path.join(pastas.baixados(), (opcoes.nomeArquivo ? opcoes.nomeArquivo : '%(title).60B [%(id)s]') + '.%(ext)s');

  return new Promise((resolve, reject) => {
    const args = [
      '--no-warnings', '--no-playlist', '--newline',
      ...(semForcarIpv4 ? [] : ['--force-ipv4']),
      '--socket-timeout', '20',
      ...(estrategia.args || []),
      '--retries', '10', '--fragment-retries', '15',
      '--retry-sleep', 'linear=1::4',
      '--concurrent-fragments', '4',
      '--continue',                      // retoma de onde parou se a internet oscilar
      '-f', formato,
      '--merge-output-format', 'mp4',
      '--postprocessor-args', 'Merger+ffmpeg:-avoid_negative_ts make_zero -movflags +faststart',
      '--restrict-filenames',            // sem acento e sem espaco: menos dor de cabeca depois
      '-o', modelo,
      '--progress',
      url,
    ];

    if (aoProgredir) aoProgredir(0.01, 'Conectando ao servidor do vídeo...', { fase: 'conectando' });
    const p = spawn(bin, args, { windowsHide: true });
    let caminho = '';
    let erro = '';
    const restos = { out: '', err: '' };

    function processar(texto, qual) {
      restos[qual] += texto;
      const linhas = restos[qual].split(/\r?\n/);
      restos[qual] = linhas.pop();

      for (const linha of linhas) {
        const t = linha.trim();
        if (!t) continue;

        const juntou = /\[Merger\]\s+Merging formats into\s+"(.+?)"/i.exec(t);
        if (juntou) { caminho = juntou[1]; }

        const destino = /\[download\]\s+Destination:\s+(.+\.(?:mp4|mkv|webm|mov))\s*$/i.exec(t);
        if (destino && !caminho) { caminho = destino[1].trim(); }

        const jaTinha = /\[download\]\s+(.+\.(?:mp4|mkv|webm|mov))\s+has already been downloaded/i.exec(t);
        if (jaTinha) { caminho = jaTinha[1].trim(); }

        const m = /\[download\]\s+([\d.]+)%/.exec(t);
        if (m && aoProgredir) {
          const frac = Math.min(0.96, Number(m[1]) / 100);
          const vel = (/at\s+([\d.]+\s*[A-Za-z]+\/s)/.exec(t) || [])[1] || '';
          const total = (/of\s+~?([\d.]+\s*[A-Za-z]+)/.exec(t) || [])[1] || '';
          const eta = (/ETA\s+([\d:]+)/.exec(t) || [])[1] || '';
          aoProgredir(frac, 'Baixando... ' + Math.round(frac * 100) + '%' +
            (total ? ' de ' + total : '') + (vel ? '  ·  ' + vel : '') + (eta && eta !== '00:00' ? '  ·  faltam ' + eta : ''),
            { fase: 'baixando', vel, total, eta });
        } else if (/\[Merger\]|\[ffmpeg\]/i.test(t) && aoProgredir) {
          aoProgredir(0.98, 'Sincronizando vídeo e áudio em alta definição...', { fase: 'sincronizando' });
        }
      }
    }

    p.stdout.setEncoding('utf8');

    p.stdout.on('data', (d) => processar(d.toString(), 'out'));
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', (d) => {
      const t = d.toString();
      erro += t;
      processar(t, 'err');
    });
    p.on('error', (e) => reject(new Error('Nao consegui rodar o yt-dlp: ' + e.message)));

    p.on('close', (code) => {
      if (code !== 0) {
        const e = new Error(mensagemDeErro(erro));
        e.bruto = erro
          .split(String.fromCharCode(10))
          .filter(function (l) { return (/ERROR|WARNING/i).test(l); })
          .slice(-4).join(" | ");
        return reject(e);
      }

      if (caminho && fs.existsSync(caminho)) return resolve(caminho);

      // Rede de seguranca: pega o arquivo de video mais novo da pasta
      try {
        const recente = fs.readdirSync(pastas.baixados())
          .filter((f) => /\.(mp4|mkv|webm|mov)$/i.test(f))
          .map((f) => ({ f, t: fs.statSync(path.join(pastas.baixados(), f)).mtimeMs }))
          .sort((a, b) => b.t - a.t)[0];
        if (recente) return resolve(path.join(pastas.baixados(), recente.f));
      } catch (_) { /* cai no erro abaixo */ }

      reject(new Error('O download terminou mas nao achei o arquivo.'));
    });
  });
}

// ---------------------------------------------------------------- replay HLS (.m3u8)

/**
 * Replay de live (.m3u8) vem como playlist HLS: uma lista de pedacos
 * .ts de ~16s. O yt-dlp baixa a live inteira rapido, mas nao sabe pegar so um
 * pedaco sem passar tudo pelo ffmpeg - e live de venda tem 3, 10 horas.
 * Aqui a gente mesmo baixa so os pedacos que interessam, varios ao mesmo
 * tempo, e vai entregando em ordem pro ffmpeg juntar num mp4.
 */
function ehHls(url) {
  return /^https?:\/\/\S+\.m3u8(?:[?#]\S*)?$/i.test(String(url || '').trim());
}

function pedir(url, tentativasDeRedirecionar) {
  const mod = /^http:/i.test(url) ? require('http') : require('https');
  return new Promise((resolve, reject) => {
    const req = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (tentativasDeRedirecionar || 0) < 5) {
        res.resume();
        return resolve(pedir(new URL(res.headers.location, url).toString(), (tentativasDeRedirecionar || 0) + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        const e = new Error('HTTP ' + res.statusCode);
        e.status = res.statusCode;
        return reject(e);
      }
      const pedacos = [];
      res.on('data', (d) => pedacos.push(d));
      res.on('end', () => resolve(Buffer.concat(pedacos)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('demorou demais pra responder')));
    req.on('error', reject);
  });
}

/** Um pedaco com insistencia: numa live de 600 pedacos, algum sempre soluça. */
async function pedirComInsistencia(url) {
  let ultimo = null;
  for (let i = 0; i < 5; i++) {
    try { return await pedir(url); }
    catch (e) {
      ultimo = e;
      if (e.status === 403 || e.status === 404) break; // link vencido ou apagado
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw ultimo;
}

/**
 * Le a playlist. Se for a playlist "mestre" (uma por qualidade), segue a de
 * maior qualidade.
 * @returns {Promise<object>} { segmentos: [{ url, inicio, duracao }], duracao, simples }
 */
async function lerPlaylist(url, profundidade) {
  const texto = (await pedirComInsistencia(url)).toString('utf8');
  if (!/^#EXTM3U/.test(texto.trim())) throw new Error('Esse link não é uma playlist de vídeo (.m3u8).');
  const linhas = texto.split(/\r?\n/).map((l) => l.trim());

  if (linhas.some((l) => /^#EXT-X-STREAM-INF/i.test(l)) && (profundidade || 0) < 3) {
    let melhor = null;
    for (let i = 0; i < linhas.length; i++) {
      const m = /^#EXT-X-STREAM-INF:.*?BANDWIDTH=(\d+)/i.exec(linhas[i]);
      const alvo = linhas[i + 1];
      if (m && alvo && !alvo.startsWith('#') && (!melhor || Number(m[1]) > melhor.banda)) {
        melhor = { banda: Number(m[1]), url: new URL(alvo, url).toString() };
      }
    }
    if (melhor) return lerPlaylist(melhor.url, (profundidade || 0) + 1);
  }

  const segmentos = [];
  let t = 0;
  let dur = null;
  for (const l of linhas) {
    const m = /^#EXTINF:([\d.]+)/i.exec(l);
    if (m) { dur = Number(m[1]); continue; }
    if (!l || l.startsWith('#')) continue;
    const d = dur || 0;
    segmentos.push({ url: new URL(l, url).toString(), inicio: t, duracao: d });
    t += d;
    dur = null;
  }
  if (!segmentos.length) throw new Error('Essa playlist está vazia.');

  // Pedaco criptografado ou em fMP4 nao da pra emendar byte a byte - ai o
  // ffmpeg le a playlist direto (mais lento, mas certo).
  const simples = !linhas.some((l) => /^#EXT-X-KEY:(?!.*METHOD=NONE)/i.test(l) || /^#EXT-X-MAP/i.test(l));
  return { segmentos, duracao: t, simples };
}

async function espiarHls(url) {
  const pl = await lerPlaylist(url);
  return { titulo: 'Replay de live (.m3u8)', duracao: pl.duracao, canal: '', largura: 0, altura: 0 };
}

function nomeDeArquivo(s) {
  return String(s || 'replay')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 _-]/g, ' ')
    .trim().replace(/\s+/g, '_').replace(/_+/g, '_')
    .slice(0, 80) || 'replay';
}

/** 3725 vira "1h02" - vai no nome do arquivo de um pedaco da live. */
function horaCurta(s) {
  const m = Math.floor(s / 60);
  return Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0');
}

/**
 * Baixa um replay HLS inteiro, ou so de `inicio` ate `fim` (em segundos). O
 * pedaco sai alinhado nos pedacos da playlist: pode comecar uns segundos antes
 * e terminar uns depois do que foi pedido, nunca menos.
 *
 * @param {object} opcoes  { inicio, fim, nome }
 * @returns {Promise<string>} caminho do mp4
 */
async function baixarHls(url, opcoes, aoProgredir) {
  opcoes = opcoes || {};
  const avisar = aoProgredir || (() => {});
  avisar(0, 'Lendo a playlist do replay...');

  const pl = await lerPlaylist(url);
  const pedido = opcoes.inicio != null || opcoes.fim != null;
  const ini = Math.max(0, Number(opcoes.inicio) || 0);
  const fim = Math.min(pl.duracao, Number(opcoes.fim) || pl.duracao);
  if (fim - ini < 3) throw new Error('O pedaço pedido é curto demais (ou passa do fim da live, que tem ' + horaCurta(pl.duracao) + ').');

  const segs = pl.segmentos.filter((s) => s.inicio + s.duracao > ini && s.inicio < fim);
  const deVerdade = { inicio: segs[0].inicio, fim: segs[segs.length - 1].inicio + segs[segs.length - 1].duracao };
  const inteiro = !pedido || (deVerdade.inicio <= 0 && deVerdade.fim >= pl.duracao - 1);

  fs.mkdirSync(pastas.baixados(), { recursive: true });
  const base = nomeDeArquivo(opcoes.nome || 'replay') +
    (inteiro ? '' : '_' + horaCurta(deVerdade.inicio) + '-' + horaCurta(deVerdade.fim));
  const destino = path.join(pastas.baixados(), base + '.mp4');

  // Mesma live, mesmo pedaco: ja esta no disco, nao baixa de novo
  if (fs.existsSync(destino) && fs.statSync(destino).size > 0) {
    avisar(1, 'Esse pedaço já estava baixado.');
    return destino;
  }

  const { ffmpeg } = await require('./media').garantirFfmpeg();
  const temp = destino.replace(/\.mp4$/, '.baixando.mp4');

  if (!pl.simples) {
    // Plano B: o ffmpeg le a playlist direto. Um pedaco por vez - mais lento.
    avisar(0, 'Baixando pelo ffmpeg (esse replay não dá pra baixar em paralelo)...');
    await ffmpegDeHls(ffmpeg, url, inteiro ? null : deVerdade, temp, avisar);
  } else {
    await baixarPedacos(ffmpeg, segs, temp, avisar);
  }

  fs.renameSync(temp, destino);
  avisar(1, 'Baixado.');
  return destino;
}

/**
 * Baixa os pedacos .ts em paralelo e vai escrevendo em ordem na entrada do
 * ffmpeg, que junta num mp4 sem recodificar. Nada de arquivo temporario do
 * tamanho da live: no maximo uns 12 pedacos ficam na memoria esperando a vez.
 */
function baixarPedacos(ffmpeg, segs, destino, avisar) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, [
      '-y', '-v', 'error', '-fflags', '+genpts+discardcorrupt', '-f', 'mpegts', '-i', 'pipe:0',
      '-map', '0:v:0?', '-map', '0:a:0?', '-c', 'copy',
      '-bsf:a', 'aac_adtstoasc', '-avoid_negative_ts', 'make_zero',
      '-movflags', '+faststart', destino,
    ], { windowsHide: true });

    let erroFfmpeg = '';
    let falhou = null;
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', (d) => { erroFfmpeg = (erroFfmpeg + d.toString()).slice(-4000); });
    p.stdin.on('error', () => {}); // o ffmpeg morrendo aparece no close, nao aqui
    p.on('error', (e) => { falhou = falhou || e; reject(e); });
    p.on('close', (code) => {
      if (falhou) { try { fs.unlinkSync(destino); } catch (_) {} return reject(falhou); }
      if (code === 0) return resolve();
      try { fs.unlinkSync(destino); } catch (_) {}
      reject(new Error('Não consegui juntar o vídeo: ' + (erroFfmpeg.trim().split(/\r?\n/).pop() || 'ffmpeg ' + code)));
    });

    const total = segs.length;
    const prontos = new Map(); // indice -> Buffer, esperando a vez de ser escrito
    let proximoPedir = 0;
    let proximoEscrever = 0;
    let emVoo = 0;
    let bytes = 0;
    const comeco = Date.now();
    const PARALELO = 8;
    const MAX_ESPERANDO = 12;

    function mostrar() {
      const frac = proximoEscrever / total;
      const mb = bytes / 1048576;
      const estimado = proximoEscrever ? (mb / proximoEscrever) * total : 0;
      const seg = (Date.now() - comeco) / 1000;
      const vel = seg > 1 ? mb / seg : 0;
      const velTxt = vel ? vel.toFixed(1).replace('.', ',') + ' MB/s' : '';
      const restSeg = vel > 0.1 && estimado > mb ? Math.round((estimado - mb) / vel) : 0;
      const eta = restSeg > 0 ? Math.floor(restSeg / 60) + ':' + String(restSeg % 60).padStart(2, '0') : '';
      avisar(Math.min(0.99, frac), 'Baixando a live... ' + Math.round(frac * 100) + '%' +
        (estimado ? ' · ' + gb(mb) + ' de ~' + gb(estimado) : '') +
        (velTxt ? ' · ' + velTxt : ''),
        { fase: 'baixando', vel: velTxt, total: estimado ? '~' + gb(estimado) : '', eta });
    }

    function desistir(e) {
      if (falhou) return;
      falhou = e;
      try { p.stdin.destroy(); } catch (_) {}
      try { p.kill(); } catch (_) {}
    }

    let escrevendo = false;
    async function escrever() {
      if (escrevendo || falhou) return;
      escrevendo = true;
      try {
        while (prontos.has(proximoEscrever)) {
          const buf = prontos.get(proximoEscrever);
          prontos.delete(proximoEscrever);
          proximoEscrever++;
          if (!p.stdin.write(buf)) await new Promise((r) => p.stdin.once('drain', r));
          mostrar();
          pedirMais();
        }
        if (proximoEscrever === total) p.stdin.end();
      } catch (e) { desistir(e); }
      escrevendo = false;
      if (prontos.has(proximoEscrever)) escrever();
    }

    function pedirMais() {
      while (!falhou && emVoo < PARALELO && proximoPedir < total &&
             proximoPedir - proximoEscrever < MAX_ESPERANDO) {
        const i = proximoPedir++;
        emVoo++;
        pedirComInsistencia(segs[i].url).then((buf) => {
          emVoo--;
          bytes += buf.length;
          prontos.set(i, buf);
          escrever();
        }, (e) => {
          emVoo--;
          desistir(new Error(e.status === 403 || e.status === 404
            ? 'O replay saiu do ar ou o link venceu (' + e.message + '). Confira a planilha.'
            : 'A internet caiu no meio do download (' + e.message + '). Tente de novo.'));
        });
      }
    }

    mostrar();
    pedirMais();
  });
}

function gb(mb) {
  return mb >= 1024 ? (mb / 1024).toFixed(1).replace('.', ',') + ' GB' : Math.round(mb) + ' MB';
}

function ffmpegDeHls(ffmpeg, url, trecho, destino, avisar) {
  const dur = trecho ? trecho.fim - trecho.inicio : 0;
  return require('./media').rodar(ffmpeg, [
    '-y', '-v', 'error',
    ...(trecho ? ['-ss', String(trecho.inicio)] : []),
    '-i', url,
    ...(trecho ? ['-t', String(dur)] : []),
    '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-avoid_negative_ts', 'make_zero',
    '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', destino,
  ], {
    aoProgredir: (s) => { if (dur) avisar(Math.min(0.99, s / dur), 'Baixando... ' + Math.round((s / dur) * 100) + '%'); },
  });
}

module.exports = { baixar, espiar, garantirYtDlp, pareceLink, ehHls, espiarHls, baixarHls, consultarJsonKick };
