'use strict';
/**
 * Clipar live AO VIVO: o programa fica ligado na live, guarda os ultimos
 * minutos em pedacos de 4s (como um DVR) e corta na hora - quando a pessoa
 * aperta "CLIPAR AGORA" ou quando ele mesmo percebe que algo aconteceu.
 *
 * O objetivo e postar PRIMEIRO. Por isso nada aqui transcreve a live inteira:
 *   1. gravacao: yt-dlp acha o endereco da live, o ffmpeg grava em pedacos
 *      sem recodificar (-c copy) - o momento ja esta no disco quando acontece;
 *   2. deteccao: sinais leves e rapidos - o chat (Twitch/Kick) explodindo e o
 *      volume do streamer subindo de repente (grito, risada, susto). Tudo
 *      roda aqui no PC: nenhuma API, chave ou servico pago. O chat e lido
 *      do mesmo jeito que a pagina da live mostra pra qualquer visitante;
 *   3. corte: junta os pedacos do trecho e ja sai em 9:16, com preset rapido;
 *   4. depois do clipe pronto, transcreve SO ele (modelo pequeno) pra sugerir
 *      titulo e legenda do post - o clipe ja aparece antes disso.
 *
 * Uma live por vez: o clipador acompanha um streamer, e duas gravacoes +
 * render dividindo o mesmo processador atrasariam as duas.
 */

try { require('dns').setDefaultResultOrder('ipv4first'); } catch (_) { }

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const media = require('./media');
const baixador = require('./baixar');
const sessoes = require('./sessoes');
const legenda = require('./legenda');
const { gerarCopy, gerarSeoPlataformas, gerarGanchoDeTela } = require('./copy');
const { transcrever, fontsdirRelativo } = require('./pipeline');
const pastas = require('./pastas');

const DUR_PEDACO = 4;
// Folga que o original de cada clipe guarda antes e depois do corte: e o
// quanto da pra "ir e voltar" no editor depois que a live passou.
const MARGEM_EDICAO = 10;

// Quanto o nivel (0-100) precisa passar pra virar clipe automatico
const LIMIAR = { alta: 42, media: 56, baixa: 72 };

// ---------------------------------------------------------------- utilidades

function plataformaDe(url) {
  const u = String(url || '');
  if (/twitch\.tv/i.test(u)) return 'twitch';
  if (/kick\.com/i.test(u)) return 'kick';
  if (/youtube\.com|youtu\.be/i.test(u)) return 'youtube';
  return 'outra';
}

/** O nome do canal no link (twitch.tv/gaules -> gaules). Video gravado nao tem. */
function canalDoLink(url) {
  const u = String(url || '');
  let m = /twitch\.tv\/([A-Za-z0-9_]{2,})\/?(?:[?#].*)?$/i.exec(u);
  if (m && !/^(videos|directory|p|settings)$/i.test(m[1])) return m[1].toLowerCase();
  m = /kick\.com\/([A-Za-z0-9_-]{2,})\/?(?:[?#].*)?$/i.exec(u);
  if (m && !/^(video|videos|categories|browse)$/i.test(m[1])) return m[1].toLowerCase();
  return null;
}

/** Aceita "gaules" ou "twitch gaules"? Nao - so link. Mas completa o https. */
function normalizarLink(url) {
  let u = String(url || '').trim();
  if (u && !/^https?:\/\//i.test(u) && /^(www\.)?(twitch\.tv|kick\.com|youtube\.com|youtu\.be)\//i.test(u)) {
    u = 'https://' + u;
  }
  return u;
}

function hms(s) {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + ss : m + ':' + ss;
}

function limparNome(s) {
  return String(s || 'live')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .replace(/\s+/g, '-').replace(/-+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 40) || 'live';
}

function mediana(lista) {
  if (!lista.length) return 0;
  const o = lista.slice().sort((a, b) => a - b);
  return o[Math.floor(o.length / 2)];
}

const limitar = (v, a, b) => Math.max(a, Math.min(b, v));

function rotuloDoNivel(n) {
  if (n >= 82) return { texto: 'Altissimo', cor: 'otimo' };
  if (n >= 68) return { texto: 'Alto', cor: 'bom' };
  if (n >= 54) return { texto: 'Medio', cor: 'medio' };
  return { texto: 'Baixo', cor: 'fraco' };
}

// ---------------------------------------------------------------- o link

/**
 * Pergunta pro yt-dlp se o link esta ao vivo e, se estiver, o endereco da
 * transmissao (.m3u8). Ate 1080p: acima disso o render fica lento e o
 * TikTok recomprime tudo pra 1080 de qualquer jeito.
 */
// Formato com imagem e som juntos, pro caminho em que o yt-dlp entrega a live
const FORMATO_UNICO = 'b[height<=1080][fps<=60]/b[height<=1080]/b';

/** O erro do ffmpeg/yt-dlp em frase de gente, pra aparecer na tela. */
function motivoDaFalha(bruto) {
  const t = String(bruto || '');
  if (/403|forbidden/i.test(t)) return 'o site recusou a conexão (403)';
  if (/404|not found/i.test(t)) return 'o endereço da live expirou (404)';
  if (/timed? ?out|timeout/i.test(t)) return 'a conexão demorou demais';
  if (/getaddrinfo|resolve|network|connection (refused|reset)/i.test(t)) return 'sem conexão com a internet ou com o site';
  if (/not currently live|offline/i.test(t)) return 'o canal saiu do ar';
  const linha = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop();
  return linha ? linha.replace(/^\[[^\]]+\]\s*/, '').slice(0, 120) : 'motivo desconhecido';
}

async function resolverAoVivoKick(url) {
  const slug = canalDoLink(url);
  if (!slug) return null;
  try {
    const j = await baixador.consultarJsonKick('https://kick.com/api/v2/channels/' + encodeURIComponent(slug));
    if (!j || typeof j !== 'object') return null;
    if (!j.livestream || !j.livestream.is_live) return { aoVivo: false, offline: true };
    if (!j.playback_url) return null;
    return {
      aoVivo: true,
      canal: (j.user && j.user.username) || j.slug || slug,
      titulo: j.livestream.session_title || null,
      m3u8: j.playback_url,
      audio: null,
      salaChat: (j.chatroom && j.chatroom.id) || null,
    };
  } catch (_) {
    return null;
  }
}

async function resolverAoVivo(url) {
  // Kick: a API publica responde em ~200ms com o playback_url direto, evitando
  // lentidao ou bloqueio do extrator do yt-dlp. Se falhar, cai pro yt-dlp.
  if (plataformaDe(url) === 'kick') {
    const k = await resolverAoVivoKick(url);
    if (k) return k;
    let ultimoKick = null;
    for (const e of [[], ['--impersonate', 'chrome'], ['--impersonate', 'edge']]) {
      try { return await resolverAoVivoUma(url, e, false); }
      catch (err) {
        if (/network|unreachable|getaddrinfo|urlopen/i.test(err.message)) {
          try { return await resolverAoVivoUma(url, e, true); } catch (err2) { ultimoKick = err2; continue; }
        }
        ultimoKick = err;
      }
    }
    throw ultimoKick || new Error('Não consegui conectar nessa live da Kick.');
  }
  // YouTube pedindo "confirme que nao e um robo": tenta de novo com o login do navegador
  const extras = [[]].concat(/youtube\.com|youtu\.be/i.test(String(url))
    ? [['--cookies-from-browser', 'firefox'], ['--cookies-from-browser', 'edge'], ['--cookies-from-browser', 'chrome']]
    : []);
  let ultimo = null;
  for (const e of extras) {
    try { return await resolverAoVivoUma(url, e, false); }
    catch (err) {
      if (/network|unreachable|getaddrinfo|urlopen/i.test(err.message)) {
        try { return await resolverAoVivoUma(url, e, true); } catch (err2) { err = err2; }
      }
      ultimo = err;
      // Navegador nao instalado ou cookies ilegiveis (ex: "could not find firefox
      // cookies database"): nao e o erro da live, so pula pro proximo navegador.
      if (e.length && /cookie|browser|firefox|chrome|edge|decrypt|DPAPI|keyring|profile/i.test(err.message)) continue;
      if (!/sign in|not a bot|confirm/i.test(err.message)) throw err;
    }
  }
  throw new Error('O YouTube pediu pra confirmar que não é um robô. Abra o YouTube no Firefox, Edge ou Chrome, entre na sua conta e tente de novo.');
}

async function resolverAoVivoUma(url, extras, semForcarIpv4) {
  const bin = await baixador.garantirYtDlp();
  return new Promise((resolve, reject) => {
    const p = spawn(bin, [
      '--no-warnings', '--no-playlist', '--socket-timeout', '15',
      ...(semForcarIpv4 ? [] : ['--force-ipv4']),
      // Prefere H.264 (avc1) pra garantir compatibilidade com .ts e evitar
      // segmentos fMP4/HEVC/VP9 sem cabecalho que falham na captura da webcam.
      '-f', 'b[vcodec^=avc1][height<=1080][fps<=60]/b[height<=1080][fps<=60]/bv*[vcodec^=avc1][height<=1080][fps<=60]+ba/bv*[height<=1080][fps<=60]+ba/b[height<=1080]/bv*[height<=1080]+ba/b/bv*+ba',
      '--print', '%(is_live)s\t%(uploader)s\t%(title)s',
      '--print', 'urls',
    ].concat(extras || [], [url]), { windowsHide: true });
    let saida = '';
    let erro = '';
    const relogio = setTimeout(() => { try { p.kill(); } catch (_) { } }, 60000);
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d) => { saida += d.toString(); });
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', (d) => { erro += d.toString(); });
    p.on('error', (e) => { clearTimeout(relogio); reject(e); });
    p.on('close', (code) => {
      clearTimeout(relogio);
      if (code !== 0) {
        if (/not currently live|is offline|offline|not live|will begin|premieres? in|live event will begin/i.test(erro)) {
          return resolve({ aoVivo: false, offline: true });
        }
        const linha = erro.split(/\r?\n/).filter((l) => /ERROR/i.test(l)).pop() || 'Nao consegui abrir esse link.';
        return reject(new Error(linha.replace(/^ERROR:\s*/i, '').slice(0, 220)));
      }
      const linhas = saida.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const [ehLive, canal, titulo] = (linhas[0] || '').split('\t');
      const enderecos = linhas.slice(1).filter((l) => /^https?:\/\//.test(l));
      const m3u8 = enderecos[0] || null;
      const audio = enderecos[1] || null;
      resolve({
        aoVivo: ehLive === 'True',
        canal: canal && canal !== 'NA' ? canal : null,
        titulo: titulo && titulo !== 'NA' ? titulo : null,
        m3u8,
        audio,
      });
    });
  });
}

/**
 * O que a janela pergunta quando a pessoa cola um link: e live acontecendo
 * agora, canal offline, ou video gravado (VOD)?
 */
async function checarLink(bruto) {
  const url = normalizarLink(bruto);
  if (!baixador.pareceLink(url)) throw new Error('Isso não parece um link.');
  const plataforma = plataformaDe(url);
  const canal = canalDoLink(url);

  // Link de VOD (twitch.tv/videos/..., kick.com/canal/videos/..., youtube
  // watch de video ja publicado) nunca e ao vivo - nem pergunta.
  const pareceVod = /twitch\.tv\/videos\/|kick\.com\/[^/]+\/videos\/|kick\.com\/video\/|clips\.twitch|\/clip\//i.test(url);
  // Link de UM video do YouTube (watch, youtu.be, shorts, live/ID): uma consulta so
  // responde se e live e qual e o video. Antes eram duas seguidas (uns 12s parado).
  if (/youtube\.com\/(watch|shorts\/|live\/)|youtu\.be\//i.test(url)) {
    const info = await baixador.espiar(url);
    if (info.aoVivo) return { url, plataforma, tipo: 'aovivo', canal: info.canal || canal, titulo: info.titulo };
    return { url, plataforma, tipo: 'video', canal: info.canal || canal, titulo: info.titulo, duracao: info.duracao, thumbnail: info.thumbnail || '', resolucoes: info.resolucoes || [1080, 720, 480] };
  }
  if (!pareceVod) {
    try {
      const r = await resolverAoVivo(url);
      if (r.aoVivo) return { url, plataforma, tipo: 'aovivo', canal: r.canal || canal, titulo: r.titulo };
      if (r.offline) return { url, plataforma, tipo: 'offline', canal };
    } catch (e) {
      // canal sem live e sem video: o erro do yt-dlp e a melhor explicacao
      if (canal) throw e;
    }
  }
  const info = await baixador.espiar(url);
  return { url, plataforma, tipo: 'video', canal: info.canal || canal, titulo: info.titulo, duracao: info.duracao, thumbnail: info.thumbnail || '', resolucoes: info.resolucoes || [1080, 720, 480] };
}

// ---------------------------------------------------------------- chat

const HYPE = /\b(kekw|lul|lmao|omegalul|pog|pogchamp|poggers|pogu|w+|clip|clipa|clipem|clipou|monka\w*|pepelaugh|icant|kkkk+|kkk|ksksk\w*|hahaha\w*|rsrs\w*|caralho|carai|mds|meu deus|nossa|eita|wtf|omg|gg|insano|absurdo)\b|\?{3,}|!{3,}/i;

/**
 * Chat da Twitch: IRC por WebSocket, como convidado anonimo (justinfan) -
 * le o chat publico, nao manda nada e nao precisa de conta.
 */
function chatTwitch(canal, aoMsg, aoStatus) {
  let ws = null;
  let fechado = false;
  const conectar = () => {
    if (fechado) return;
    try { ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443'); } catch (e) { aoStatus('sem chat'); return; }
    ws.onopen = () => {
      ws.send('PASS SCHMOOPIIE');
      ws.send('NICK justinfan' + Math.floor(10000 + Math.random() * 80000));
      ws.send('JOIN #' + canal.toLowerCase());
      aoStatus('conectado');
    };
    ws.onmessage = (e) => {
      for (const l of String(e.data).split('\r\n')) {
        if (!l) continue;
        if (l.startsWith('PING')) { try { ws.send('PONG :tmi.twitch.tv'); } catch (_) { } continue; }
        const i = l.indexOf(' PRIVMSG #');
        if (i < 0) continue;
        const j = l.indexOf(' :', i);
        aoMsg(j > 0 ? l.slice(j + 2) : '');
      }
    };
    ws.onclose = () => { if (!fechado) { aoStatus('reconectando'); setTimeout(conectar, 3000); } };
    ws.onerror = () => { };
  };
  conectar();
  return () => { fechado = true; try { ws && ws.close(); } catch (_) { } };
}

/**
 * Chat da Kick: o mesmo canal publico (Pusher) que a pagina da Kick usa pra
 * mostrar o chat. A chave do Pusher muda de tempos em tempos - da pra trocar
 * pela variavel KICK_PUSHER_KEY. Se nao conectar, a deteccao segue so pelo
 * volume e a janela avisa.
 */
const CHAVES_KICK = (process.env.KICK_PUSHER_KEY ? [process.env.KICK_PUSHER_KEY] : [])
  .concat(['32cbd69e4b950bf97679', 'eb1d5f283081a78b932c']);

function chatKick(slug, salaInicial, aoMsg, aoStatus) {
  let ws = null;
  let fechado = false;
  let chaveIdx = 0;
  let sala = salaInicial || null;

  const conectar = () => {
    if (fechado || !sala) return;
    if (chaveIdx >= CHAVES_KICK.length) { aoStatus('sem chat'); return; }
    const chave = CHAVES_KICK[chaveIdx];
    try {
      ws = new WebSocket('wss://ws-us2.pusher.com/app/' + chave + '?protocol=7&client=js&version=8.4.0&flash=false');
    } catch (e) { aoStatus('sem chat'); return; }
    let deuCerto = false;
    ws.onmessage = (e) => {
      let j;
      try { j = JSON.parse(e.data); } catch (_) { return; }
      if (j.event === 'pusher:connection_established') {
        ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: 'chatrooms.' + sala + '.v2' } }));
      } else if (j.event === 'pusher_internal:subscription_succeeded') {
        deuCerto = true;
        aoStatus('conectado');
      } else if (j.event === 'pusher:error') {
        chaveIdx++;
        try { ws.close(); } catch (_) { }
      } else if (/ChatMessageEvent/.test(j.event || '')) {
        let d = j.data;
        try { d = typeof d === 'string' ? JSON.parse(d) : d; } catch (_) { d = {}; }
        aoMsg((d && d.content) || '');
      } else if (j.event === 'pusher:ping') {
        try { ws.send(JSON.stringify({ event: 'pusher:pong', data: {} })); } catch (_) { }
      }
    };
    ws.onclose = () => {
      if (fechado) return;
      if (!deuCerto && chaveIdx >= CHAVES_KICK.length) { aoStatus('sem chat'); return; }
      aoStatus('reconectando');
      setTimeout(conectar, 3000);
    };
    ws.onerror = () => { };
  };

  if (sala) {
    conectar();
  } else {
    baixador.consultarJsonKick('https://kick.com/api/v2/channels/' + encodeURIComponent(slug))
      .then((j) => { sala = j && j.chatroom && j.chatroom.id; if (sala) conectar(); else aoStatus('sem chat'); })
      .catch(() => aoStatus('sem chat'));
  }

  return () => { fechado = true; try { ws && ws.close(); } catch (_) { } };
}

// ---------------------------------------------------------------- a sessao

class SessaoAoVivo {
  /**
   * @param {object} o  { url, formato, recorte, duracao, auto, sensibilidade,
   *                      bufferMin, salvarOriginal, sugerirTitulo }
   * @param {function} emitir  manda um evento pra janela
   */
  constructor(o, emitir) {
    this.url = normalizarLink(o.url);
    this.plataforma = plataformaDe(this.url);
    this.canal = canalDoLink(this.url);
    this.formato = ['split', 'vertical', 'foco', 'blur', 'original'].includes(o.formato) ? o.formato : 'vertical';
    this.recorte = o.recorte || null;
    this.duracao = limitar(Number(o.duracao) || 30, 10, 120);
    this.auto = o.auto !== false;
    this.sensibilidade = LIMIAR[o.sensibilidade] ? o.sensibilidade : 'media';
    this.bufferMin = limitar(Number(o.bufferMin) || 20, 3, 120);
    this.salvarOriginal = o.salvarOriginal !== false;
    this.sugerirTitulo = o.sugerirTitulo !== false;
    // o chat publico da live: sem conta e sem chave, mas da pra desligar
    this.lerChat = o.lerChat !== false;
    this.idioma = /^[a-z]{2}$|^auto$/.test(String(o.idioma || '')) ? o.idioma : 'pt';
    // texto fixo na tela de todo clipe: { texto, posicao, duracao, cor, tamanho }
    this.textoFixo = o.textoFixo || null;
    // gancho de 4s, legenda dinamica palavra por palavra e fonte escolhida
    this.textoGancho = o.textoGancho !== false;
    this.legendar = !!o.legendar;
    this.fonteLegenda = String(o.fonteLegenda || 'tiktok');
    // Diretor IA Pro na live: refina inicio/fim pela conversa e cria titulo + gancho + SEO
    this.usarIaPro = !!o.usarIaPro;
    this.salaChat = null;
    // "preparar": conecta e ja guarda a live, mas so clipa depois que a pessoa
    // marcar webcam/foco/texto e apertar "Comecar a clipar"
    this.clipando = !o.preparar;
    this.emitir = emitir;

    this.id = Date.now().toString(36);
    this.dir = path.join(pastas.aoVivo(), this.id);
    this.estado = 'conectando';
    this.chatStatus = o.lerChat === false ? 'desligado' : (this.plataforma === 'youtube' ? 'sem chat' : 'conectando');
    this.titulo = null;
    this.inicio = Date.now();

    this.pedacos = [];       // { nome, arquivo, t0, dur, travas }
    this.lidosPorRodada = 0;
    this.rodada = 0;
    this.proxNumero = 0;
    this.total = 0;          // segundos gravados (linha do tempo da sessao)
    this.ancora = null;      // { wall, t }: o fim do pedaco mais novo e quando chegou

    this.audio = [];         // { t, db } a cada meio segundo
    this.chat = [];          // { w (ms), peso }
    this.historicoChat = []; // taxa a cada segundo, pra linha de base
    this.ultimoGatilho = -Infinity;
    this.pendente = null;    // gatilho esperando o resto do trecho ser gravado

    this.fila = [];          // clipes pra renderizar
    this.renderizando = false;
    this.originais = [];     // clipes esperando o original com folga (pra editar)
    this.fazendoOriginal = false;
    this.clipes = [];
    this.parado = false;
  }

  async iniciar() {
    fs.mkdirSync(this.dir, { recursive: true });
    this.status('conectando', 'Procurando a live...');
    const r = await resolverAoVivo(this.url);
    if (!r.aoVivo || !r.m3u8) {
      throw new Error(r.offline
        ? 'Esse canal não está ao vivo agora. Pra live que já acabou, use o modo "Vídeo gravado" com o link do VOD.'
        : 'Esse link não é de uma live acontecendo agora.');
    }
    this.titulo = r.titulo;
    this.canal = this.canal || limparNome(r.canal || 'live').toLowerCase();
    this.nomeCanal = r.canal || this.canal;
    this.salaChat = r.salaChat || null;

    const perfil = sessoes.pegar();
    const d = new Date();
    const dois = (n) => String(n).padStart(2, '0');
    const carimbo = d.getFullYear() + '-' + dois(d.getMonth() + 1) + '-' + dois(d.getDate()) + '_' + dois(d.getHours()) + 'h' + dois(d.getMinutes());
    this.pasta = path.join(sessoes.pastaDeSaida(perfil, pastas.saida()), limparNome(this.nomeCanal) + '_ao-vivo_' + carimbo);
    fs.mkdirSync(this.pasta, { recursive: true });

    this.gravar(r.m3u8, r.audio);
    this.ligarChat();
    this.relogio = setInterval(() => this.tique(), 1000);
  }

  status(estado, msg) {
    this.estado = estado;
    this.emitir(Object.assign({ tipo: 'estado', msg: msg || null }, this.resumo()));
  }

  resumo() {
    return {
      estado: this.estado,
      url: this.url,
      plataforma: this.plataforma,
      canal: this.nomeCanal || this.canal,
      titulo: this.titulo,
      chat: this.chatStatus,
      gravado: Math.round(this.total),
      buffer: Math.round(this.pedacos.reduce((s, p) => s + p.dur, 0)),
      desde: this.inicio,
      auto: this.auto,
      sensibilidade: this.sensibilidade,
      duracao: this.duracao,
      formato: this.formato,
      pasta: this.pasta || null,
      quantidade: this.clipes.length,
      clipando: this.clipando,
      usarIaPro: !!this.usarIaPro,
      iaLiveExpiraEm: this.iaLiveExpiraEm || null,
      textoFixo: this.textoFixo,
      textoGancho: this.textoGancho !== false,
      legendar: !!this.legendar,
      fonteLegenda: this.fonteLegenda || 'tiktok',
      // o pedaco mais novo: e dele que sai a imagem pra marcar webcam e foco
      ultimoPedaco: this.ultimoPedaco(),
      // por que ainda nao tem imagem (a tela de preparo mostra)
      problema: this.ultimoProblema || null,
      viaYtDlp: !!this.viaYtDlp,
    };
  }

  // ------------------------------------------------------------ gravacao

  async gravar(m3u8, audio) {
    // Leitura nativa de HLS em Node.js:
    // - Twitch e Kick (Amazon IVS) usam playlist .m3u8 de segmentos .ts de 2s.
    //   Passar isso pro ffmpeg com -reconnect_streamed fazia o ffmpeg travar em
    //   loop no EOF do texto da playlist sem gravar nada.
    // - YouTube Live entrega video e audio em duas playlists .m3u8 separadas
    //   (com 1h de DVR): casar os segmentos pelo mesmo #EXT-X-MEDIA-SEQUENCE na
    //   borda ao vivo elimina o atraso de 5s no audio e o atraso de video.
    if (!this.viaYtDlp) {
      if (!audio && (this.plataforma === 'twitch' || this.plataforma === 'kick' || /\.m3u8(?:[?#]|$)/i.test(m3u8))) {
        return this.gravarHls(m3u8);
      }
      if (audio && this.plataforma === 'youtube') {
        return this.gravarYoutubeHls(m3u8, audio);
      }
    }
    const { ffmpeg } = await media.garantirFfmpeg();
    this.rodada++;
    this.lidosPorRodada = 0;
    const csv = path.join(this.dir, 'lista-' + this.rodada + '.csv');
    this.csvAtual = csv;
    const pedacosAntes = this.pedacos.length;
    this.ultimoPedacoEm = Date.now();

    // Segundo caminho: o proprio yt-dlp baixa a live e entrega pro ffmpeg.
    let yt = null;
    let entrada = ['-i', m3u8];
    if (this.viaYtDlp) {
      const bin = await baixador.garantirYtDlp();
      yt = spawn(bin, ['--no-warnings', '--force-ipv4', '--no-part', '--hls-use-mpegts', '-f', FORMATO_UNICO, '-o', '-', this.url], { windowsHide: true });
      yt.stderr.setEncoding('utf8');
      yt.stderr.on('data', (d) => { this.erroYt = (String(this.erroYt || '') + d.toString()).slice(-600); });
      yt.on('error', () => { });
      this.procYt = yt;
      entrada = ['-i', 'pipe:0'];
      audio = null;
    }
    const args = [
      '-hide_banner', '-loglevel', 'error',
    ].concat(this.viaYtDlp ? [] : ['-reconnect', '1', '-reconnect_delay_max', '5'])
      .concat(audio ? ['-copyts', '-start_at_zero'] : [])
      .concat(entrada).concat(audio ? [
        '-reconnect', '1', '-reconnect_delay_max', '5',
        '-i', audio, '-map', '0:v:0', '-map', '1:a:0',
      ] : ['-map', '0:v:0', '-map', '0:a:0?']).concat([
        '-c', 'copy',
        '-f', 'segment', '-segment_time', String(DUR_PEDACO), '-reset_timestamps', '1',
        '-segment_start_number', String(this.proxNumero),
        '-segment_list', csv, '-segment_list_type', 'csv',
        path.join(this.dir, 'p%07d.ts'),
      ]);
    this.proc = spawn(ffmpeg, args, { windowsHide: true });
    if (yt) { yt.stdout.pipe(this.proc.stdin); this.proc.stdin.on('error', () => { }); }
    let erro = '';
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (d) => { erro = (erro + d.toString()).slice(-800); });
    this.proc.on('close', () => {
      this.proc = null;
      if (yt) { try { yt.kill(); } catch (_) { } this.procYt = null; }
      this.lerLista(); // o ultimo pedaco
      if (this.parado) return;

      // Caiu sem gravar nada: e recusa, nao queda. Diz o motivo na tela e,
      // na segunda vez, troca pro caminho pelo yt-dlp.
      if (this.pedacos.length === pedacosAntes) {
        this.falhasSeguidas = (this.falhasSeguidas || 0) + 1;
        this.ultimoProblema = motivoDaFalha(erro + ' ' + (yt ? this.erroYt || '' : ''));
        if (this.falhasSeguidas >= 2 && !this.viaYtDlp) {
          this.viaYtDlp = true;
          this.emitir({ tipo: 'aviso', msg: 'Não consegui gravar direto (' + this.ultimoProblema + '). Tentando gravar pelo yt-dlp...' });
        } else {
          this.emitir({ tipo: 'aviso', msg: 'A gravação não começou: ' + this.ultimoProblema + '. Tentando de novo...' });
        }
      } else {
        this.falhasSeguidas = 0;
      }
      this.status('reconectando', this.ultimoProblema && this.falhasSeguidas ? 'Tentando de novo: ' + this.ultimoProblema : 'A transmissão caiu. Reconectando...');
      setTimeout(() => this.reconectar(), 3000);
    });
    this.status('gravando', 'Gravando a live.');
  }

  /** Se o endereco for uma Master Playlist (#EXT-X-STREAM-INF), escolhe a melhor variante <= 1080p. */
  async resolverPlaylistMestre(url) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) return url;
      const texto = await r.text();
      if (!/#EXT-X-STREAM-INF/i.test(texto)) return url;
      const linhas = texto.split(/\r?\n/).map((l) => l.trim());
      const variantes = [];
      for (let i = 0; i < linhas.length; i++) {
        if (!/^#EXT-X-STREAM-INF:/i.test(linhas[i])) continue;
        const alvo = linhas[i + 1];
        if (!alvo || alvo.startsWith('#')) continue;
        const banda = Number((/BANDWIDTH=(\d+)/i.exec(linhas[i]) || [])[1] || 0);
        const res = /RESOLUTION=\d+x(\d+)/i.exec(linhas[i]);
        const altura = res ? Number(res[1]) : 0;
        const avc = /CODECS="[^"]*avc1/i.test(linhas[i]) ? 1 : 0;
        variantes.push({ url: new URL(alvo, url).href, banda, altura, avc });
      }
      if (!variantes.length) return url;
      const ate1080 = variantes.filter((v) => !v.altura || v.altura <= 1080);
      const pool = ate1080.length ? ate1080 : variantes;
      pool.sort((a, b) => (b.avc - a.avc) || (b.altura - a.altura) || (b.banda - a.banda));
      return pool[0].url;
    } catch (_) {
      return url;
    }
  }

  /**
   * Le a playlist HLS direto, pedaco por pedaco (Twitch, Kick e outros HLS).
   * - Comeca na borda ao vivo (ultimos 2 pedacos), evitando video atrasado.
   * - Na Twitch, pula os segmentos de anuncio ("Amazon|...") automaticamente.
   * - Suporta #EXT-X-MAP (fMP4) colando o cabecalho init em cada segmento.
   * - Grava em .part e renomeia atomicamente pra nunca corromper a captura da webcam.
   */
  async gravarHls(m3u8) {
    const rodada = ++this.rodada;
    const { ffmpeg } = await media.garantirFfmpeg();
    this.status('gravando', 'Gravando a live.');
    const mediaUrl = await this.resolverPlaylistMestre(m3u8);
    if (this.parado || rodada !== this.rodada) return;

    let ultimoSeq = -1;
    let falhas = 0;
    let emAnuncio = false;
    let initMapUrl = null;
    let initMapBuf = null;

    const passo = async () => {
      if (this.parado || rodada !== this.rodada) return;
      try {
        const r = await fetch(mediaUrl, { signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw new Error('playlist ' + r.status);
        const texto = await r.text();
        if (/#EXT-X-ENDLIST/.test(texto) && !/#EXTINF/.test(texto)) throw new Error('fim');

        const mapMatch = /#EXT-X-MAP:[^\r\n]*URI="([^"]+)"/i.exec(texto);
        if (mapMatch) {
          const uMap = new URL(mapMatch[1], mediaUrl).href;
          if (uMap !== initMapUrl) {
            const rm = await fetch(uMap, { signal: AbortSignal.timeout(10000) });
            if (rm.ok) { initMapBuf = Buffer.from(await rm.arrayBuffer()); initMapUrl = uMap; }
          }
        }

        let seq = Number((/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(texto) || [])[1] || 0);
        let inf = null;
        let novos = [];
        for (const linha of texto.split(/\r?\n/)) {
          if (linha.startsWith('#EXTINF:')) {
            const m = /#EXTINF:([\d.]+),?(.*)$/.exec(linha);
            inf = { dur: Number(m && m[1]) || 2, titulo: (m && m[2] || '').trim() };
          } else if (linha && !linha.startsWith('#')) {
            const ehAnuncio = this.plataforma === 'twitch' && !!inf && !!inf.titulo && inf.titulo !== 'live';
            if (inf && seq > ultimoSeq) novos.push({ seq, url: new URL(linha, mediaUrl).href, dur: inf.dur, anuncio: ehAnuncio });
            seq++;
            inf = null;
          }
        }

        // Primeira leitura: pula segmentos antigos e comeca na borda ao vivo
        if (ultimoSeq === -1 && novos.length > 2) {
          ultimoSeq = novos[novos.length - 3].seq;
          novos = novos.slice(-2);
        }

        for (const s of novos) {
          if (this.parado || rodada !== this.rodada) return;
          ultimoSeq = s.seq;
          if (s.anuncio) {
            if (!emAnuncio) {
              emAnuncio = true;
              this.emitir({ tipo: 'aviso', msg: 'A Twitch está passando anúncio: esse pedaço é pulado (nenhum clipe sai com anúncio).' });
            }
            continue;
          }
          if (emAnuncio) { emAnuncio = false; this.emitir({ tipo: 'aviso', msg: 'Anúncio acabou, voltou a gravar a live.' }); }
          const resp = await fetch(s.url, { signal: AbortSignal.timeout(15000) });
          if (!resp.ok) continue;
          let buf = Buffer.from(await resp.arrayBuffer());
          if (buf.length < 512) continue;
          if (initMapBuf) buf = Buffer.concat([initMapBuf, buf]);
          const num = this.proxNumero++;
          const nome = 'p' + String(num).padStart(7, '0') + '.ts';
          const arquivo = path.join(this.dir, nome);
          const tmpRaw = path.join(this.dir, 'raw-' + num + (initMapBuf ? '.mp4' : '.ts'));
          const tmp = arquivo + '.part';
          try {
            fs.writeFileSync(tmpRaw, buf);
            // Normaliza cada segmento (inclusive fMP4 #EXT-X-MAP e saltos de anuncio da Twitch)
            // para MPEG-TS com PTS iniciando em zero: evita que o concat trave apos os 3 primeiros segundos.
            await media.rodar(ffmpeg, [
              '-y', '-hide_banner', '-loglevel', 'error',
              '-fflags', '+genpts+discardcorrupt',
              '-i', tmpRaw,
              '-map', '0:v:0', '-map', '0:a:0?',
              '-c', 'copy', '-avoid_negative_ts', 'make_zero',
              '-f', 'mpegts', tmp,
            ]);
            if (fs.existsSync(tmp) && fs.statSync(tmp).size > 512) {
              fs.renameSync(tmp, arquivo);
              this.adicionarPedaco(nome, arquivo, s.dur);
            }
          } catch (_) {
            // Segmento corrompido isolado: ignora sem derrubar a gravacao
          } finally {
            try { if (fs.existsSync(tmpRaw)) fs.unlinkSync(tmpRaw); } catch (_) { }
            try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) { }
          }
        }
        falhas = 0;
      } catch (e) {
        if (++falhas >= 5 || /fim/.test(e.message)) {
          if (rodada !== this.rodada || this.parado) return;
          this.status('reconectando', 'A transmissão caiu. Reconectando...');
          this.timerHls = setTimeout(() => this.reconectar(), 3000);
          return;
        }
      }
      if (!this.parado && rodada === this.rodada) this.timerHls = setTimeout(passo, 1500);
    };
    passo();
  }

  /**
   * YouTube Live: video (.ts) e audio (.aac ADTS) vem em duas playlists .m3u8
   * separadas com 1h de DVR. Baixar em paralelo casando o mesmo numero de
   * sequencia (#EXT-X-MEDIA-SEQUENCE) na borda ao vivo garante 0s de atraso
   * entre audio e video e evita ficar preso na janela DVR antiga.
   */
  async gravarYoutubeHls(m3u8Video, m3u8Audio) {
    const rodada = ++this.rodada;
    const { ffmpeg } = await media.garantirFfmpeg();
    this.status('gravando', 'Gravando a live.');
    const [urlV, urlA] = await Promise.all([
      this.resolverPlaylistMestre(m3u8Video),
      this.resolverPlaylistMestre(m3u8Audio),
    ]);
    if (this.parado || rodada !== this.rodada) return;

    let ultimoSeq = -1;
    let falhas = 0;

    const parsear = (texto, base) => {
      let seq = Number((/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(texto) || [])[1] || 0);
      let dur = 5;
      const mapa = new Map();
      for (const l of texto.split(/\r?\n/)) {
        if (l.startsWith('#EXTINF:')) dur = Number((/#EXTINF:([\d.]+)/.exec(l) || [])[1]) || 5;
        else if (l && !l.startsWith('#')) { mapa.set(seq++, { url: new URL(l.trim(), base).href, dur }); }
      }
      return mapa;
    };

    const passo = async () => {
      if (this.parado || rodada !== this.rodada) return;
      try {
        const [rv, ra] = await Promise.all([
          fetch(urlV, { signal: AbortSignal.timeout(10000) }),
          fetch(urlA, { signal: AbortSignal.timeout(10000) }),
        ]);
        if (!rv.ok || !ra.ok) throw new Error('playlist ' + rv.status + '/' + ra.status);
        const [tv, ta] = await Promise.all([rv.text(), ra.text()]);
        if (/#EXT-X-ENDLIST/.test(tv) && !/#EXTINF/.test(tv)) throw new Error('fim');

        const mapV = parsear(tv, urlV);
        const mapA = parsear(ta, urlA);
        let comuns = [];
        for (const [seq, sv] of mapV.entries()) {
          if (seq > ultimoSeq && mapA.has(seq)) comuns.push({ seq, v: sv, a: mapA.get(seq) });
        }
        comuns.sort((a, b) => a.seq - b.seq);

        // Primeira leitura: pula a janela DVR de 1h e comeca na borda ao vivo
        if (ultimoSeq === -1 && comuns.length > 2) {
          ultimoSeq = comuns[comuns.length - 3].seq;
          comuns = comuns.slice(-2);
        }

        for (const par of comuns) {
          if (this.parado || rodada !== this.rodada) return;
          ultimoSeq = par.seq;
          const [respV, respA] = await Promise.all([
            fetch(par.v.url, { signal: AbortSignal.timeout(15000) }),
            fetch(par.a.url, { signal: AbortSignal.timeout(15000) }),
          ]);
          if (!respV.ok || !respA.ok) continue;
          const [bv, ba] = await Promise.all([
            respV.arrayBuffer().then(Buffer.from),
            respA.arrayBuffer().then(Buffer.from),
          ]);
          if (bv.length < 512 || ba.length < 128) continue;

          const num = this.proxNumero++;
          const nome = 'p' + String(num).padStart(7, '0') + '.ts';
          const arquivo = path.join(this.dir, nome);
          const tmpV = path.join(this.dir, 'v-' + num + '.ts');
          const tmpA = path.join(this.dir, 'a-' + num + '.aac');
          const tmpOut = arquivo + '.part';
          try {
            fs.writeFileSync(tmpV, bv);
            fs.writeFileSync(tmpA, ba);
            await media.rodar(ffmpeg, [
              '-y', '-hide_banner', '-loglevel', 'error',
              '-fflags', '+genpts+discardcorrupt',
              '-i', tmpV, '-i', tmpA,
              '-map', '0:v:0', '-map', '1:a:0',
              '-c', 'copy', '-avoid_negative_ts', 'make_zero',
              '-f', 'mpegts', tmpOut,
            ]);
            if (fs.existsSync(tmpOut) && fs.statSync(tmpOut).size > 512) {
              fs.renameSync(tmpOut, arquivo);
              this.adicionarPedaco(nome, arquivo, par.v.dur);
            }
          } finally {
            try { fs.unlinkSync(tmpV); } catch (_) { }
            try { fs.unlinkSync(tmpA); } catch (_) { }
            try { if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut); } catch (_) { }
          }
        }
        falhas = 0;
      } catch (e) {
        if (++falhas >= 5 || /fim/.test(e.message)) {
          if (rodada !== this.rodada || this.parado) return;
          this.status('reconectando', 'A transmissão caiu. Reconectando...');
          this.timerHls = setTimeout(() => this.reconectar(), 3000);
          return;
        }
      }
      if (!this.parado && rodada === this.rodada) this.timerHls = setTimeout(passo, 2000);
    };
    passo();
  }

  async reconectar(manual) {
    if (this.parado) return;
    if (this.reconectando && !manual) return;
    clearTimeout(this.timerReconexao);
    this.timerReconexao = null;
    clearTimeout(this.timerHls);
    this.timerHls = null;
    this.rodada++;
    if (this.proc) { try { this.proc.kill(); } catch (_) {} this.proc = null; }
    if (this.procYt) { try { this.procYt.kill(); } catch (_) {} this.procYt = null; }

    this.reconectando = true;
    this.status('reconectando', manual ? 'Reconectando à live agora...' : 'Conexão com a live caiu. Reconectando automaticamente...');
    try {
      const r = await resolverAoVivo(this.url);
      if (this.parado) return;
      if (!r.aoVivo || !r.m3u8) {
        this.tentativasOffline = (this.tentativasOffline || 0) + 1;
        if (!manual && this.tentativasOffline < 3) {
          this.emitir({ tipo: 'aviso', msg: 'Live oscilou (' + this.tentativasOffline + '/3). Tentando reconectar em 8s...' });
          this.reconectando = false;
          this.timerReconexao = setTimeout(() => this.reconectar(false), 8000);
          return;
        }
        this.reconectando = false;
        this.status('encerrada', 'A live parece ter acabado. Os clipes feitos estão salvos (se voltar, clique em Reconectar).');
        return this.parar(true);
      }
      this.tentativasOffline = 0;
      this.ultimoPedacoEm = Date.now();
      this.reconectando = false;
      this.emitir({ tipo: 'aviso', msg: '✅ Conexão com a live restabelecida! Voltando a gravar.' });
      this.gravar(r.m3u8, r.audio);
      if (this.lerChat && this.chatStatus !== 'conectado') {
        if (this.fecharChat) { try { this.fecharChat(); } catch (_) {} this.fecharChat = null; }
        this.ligarChat();
      }
    } catch (e) {
      this.reconectando = false;
      if (this.parado) return;
      this.emitir({ tipo: 'aviso', msg: 'Sem conexão para reconectar (' + e.message + '). Tentando de novo em 6s...' });
      this.timerReconexao = setTimeout(() => this.reconectar(false), 6000);
    }
  }

  forcarReconexao() {
    this.tentativasOffline = 0;
    return this.reconectar(true);
  }

  /** Le os pedacos que o ffmpeg ja fechou (o csv so lista pedaco completo). */
  lerLista() {
    let texto;
    try { texto = fs.readFileSync(this.csvAtual, 'utf8'); } catch (_) { return; }
    const linhas = texto.split(/\r?\n/).filter(Boolean);
    const novas = linhas.slice(this.lidosPorRodada);
    this.lidosPorRodada = linhas.length;
    for (const l of novas) {
      const [nome, ini, fim] = l.split(',');
      const dur = Math.max(0.1, Number(fim) - Number(ini));
      if (!isFinite(dur)) continue;
      const n = Number((/(\d+)\.ts$/.exec(nome) || [])[1]);
      if (isFinite(n)) this.proxNumero = n + 1;
      this.adicionarPedaco(nome, path.join(this.dir, nome), dur);
    }
  }

  adicionarPedaco(nome, arquivo, dur) {
    const p = { nome, arquivo, t0: this.total, dur, travas: 0 };
    this.pedacos.push(p);
    this.total += dur;
    this.ancora = { wall: Date.now(), t: this.total };
    this.ultimoPedacoEm = Date.now();
    this.ultimoProblema = null;
    this.medirAudio(p);
  }

  /** Volume a cada meio segundo, em dB - o pico de grito/risada aparece aqui. */
  async medirAudio(p) {
    const { ffmpeg } = await media.garantirFfmpeg();
    const s = await new Promise((res) => {
      const proc = spawn(ffmpeg, ['-hide_banner', '-i', p.arquivo,
        '-af', 'aresample=8000,asetnsamples=4000:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level',
        '-f', 'null', '-'], { windowsHide: true });
      let t = '';
      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (d) => { t += d.toString(); });
      proc.on('close', () => res(t));
      proc.on('error', () => res(''));
    });
    const vals = [...s.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map((m) => (m[1] === '-inf' ? -90 : Number(m[1])));
    vals.forEach((db, i) => this.audio.push({ t: p.t0 + i * 0.5, db: isFinite(db) ? Math.max(-90, db) : -90 }));
    // so os ultimos 6 minutos importam pra linha de base
    const corte = this.total - 360;
    while (this.audio.length && this.audio[0].t < corte) this.audio.shift();
  }

  // ------------------------------------------------------------ chat

  ligarChat() {
    if (!this.lerChat) return;
    const aoMsg = (texto) => this.chat.push({ w: Date.now(), peso: HYPE.test(texto) ? 2 : 1 });
    const aoStatus = (s) => {
      if (s === this.chatStatus) return;
      this.chatStatus = s;
      if (s === 'sem chat') {
        this.emitir({ tipo: 'aviso', msg: 'Não consegui ler o chat dessa live: a detecção automática vai usar só o volume do streamer.' });
      }
      this.emitir(Object.assign({ tipo: 'estado' }, this.resumo()));
    };
    if (this.plataforma === 'twitch' && this.canal) this.fecharChat = chatTwitch(this.canal, aoMsg, aoStatus);
    else if (this.plataforma === 'kick' && this.canal) this.fecharChat = chatKick(this.canal, this.salaChat, aoMsg, aoStatus);
    else this.chatStatus = 'sem chat';
  }

  /** "Agora" na linha do tempo da gravacao. */
  agora() {
    if (!this.ancora) return 0;
    return this.ancora.t + (Date.now() - this.ancora.wall) / 1000;
  }

  // ------------------------------------------------------------ o relogio

  tique() {
    if (this.parado) return;
    this.lerLista();
    this.proximoOriginal();
    this.limparBuffer();

    // Cao de guarda: detecta trava silenciosa tanto no FFmpeg quanto no HLS nativo.
    // 35s sem nenhum pedaco novo durante gravacao = reconecta automaticamente.
    if (this.estado === 'gravando' && !this.reconectando && this.ultimoPedacoEm && Date.now() - this.ultimoPedacoEm > 35000) {
      this.ultimoPedacoEm = Date.now();
      this.emitir({ tipo: 'aviso', msg: 'Sinal da live congelou por 35s. Reconectando automaticamente...' });
      this.reconectar(false);
    }

    const nivel = this.medirNivel();
    if (nivel) {
      this.emitir(Object.assign({ tipo: 'nivel' }, nivel, { gravado: Math.round(this.total) }));
      if (this.clipando && this.auto && !this.pendente && nivel.nivel >= LIMIAR[this.sensibilidade] &&
        this.agora() - this.ultimoGatilho > Math.max(26, this.duracao * 0.8)) {
        this.disparar(nivel);
      }
    }

    // o gatilho espera o "depois" do lance (+ margem pra achar pausa) ser gravado pra cortar
    if (this.pendente && this.total >= this.pendente.fim + 1.5) {
      const p = this.pendente;
      this.pendente = null;
      this.enfileirar(p);
    }
  }

  medirNivel() {
    if (this.total < 24) return null;
    const agoraW = Date.now();

    // chat: mensagens (com peso) nos ultimos 5s, contra a mediana dos ultimos 5 min
    let cur = 0;
    while (this.chat.length && this.chat[0].w < agoraW - 300000) this.chat.shift();
    for (let i = this.chat.length - 1; i >= 0 && this.chat[i].w >= agoraW - 5000; i--) cur += this.chat[i].peso;
    this.historicoChat.push(cur);
    if (this.historicoChat.length > 300) this.historicoChat.shift();
    const baseChat = mediana(this.historicoChat);
    const temChat = this.chatStatus === 'conectado' && this.historicoChat.length >= 16;
    const razao = (cur + 1) / (baseChat + 1);
    const notaChat = temChat && cur >= 3 ? limitar((razao - 1.45) / 2.0, 0, 1) : 0;

    // audio adaptativo a prova de compressor/limiter do OBS:
    // Streamers usam limiter que trava o volume maximo perto de -6 dB, entao um
    // delta fixo de +12 dB quase nunca acontecia em 1h de live. Medir o desvio
    // padrao (dinamica propria do microfone dele) + o salto contra os 18s anteriores
    // detecta risadas, sustos e reacoes reais mesmo em live comprimida.
    const fim = this.total;
    const validos = this.audio.filter((a) => a.db > -75);
    const recentes = this.audio.filter((a) => a.t >= fim - 4).map((a) => a.db).sort((a, b) => b - a);
    const antes18s = this.audio.filter((a) => a.t >= fim - 22 && a.t < fim - 4 && a.db > -75).map((a) => a.db);
    const base = validos.length ? mediana(validos.map((a) => a.db)) : -30;
    const baseCurta = antes18s.length >= 6 ? mediana(antes18s) : base;

    // Desvio medio robusto (MAD * 1.4826) da fala normal do streamer, com piso de 1.7 dB
    const desvios = validos.map((a) => Math.abs(a.db - base));
    const desvioDb = Math.max(1.7, Math.min(5.5, (mediana(desvios) || 2.0) * 1.4826));

    // Exige pelo menos 1s sustentado (2o maior valor na janela de 4s) pra ignorar esbarrao no mic
    const pico = recentes.length >= 2 ? recentes[1] : (recentes.length ? recentes[0] : -90);
    const delta = this.audio.length >= 28 && recentes.length ? Math.max(0, pico - base) : null;
    const saltoCurto = delta == null ? 0 : Math.max(0, pico - baseCurta);

    let notaAudio = 0;
    if (delta != null && pico > -46) {
      const zGlobal = delta / desvioDb;             // ~1.8 = animou, ~2.5 = reacao forte, ~3.3 = grito/explosao
      const zSalto = saltoCurto / desvioDb;         // subida subita apos tensao/silencio
      const zCombinado = Math.max(zGlobal, zGlobal * 0.65 + zSalto * 0.50);
      notaAudio = limitar((zCombinado - 1.25) / 1.95, 0, 1);
    }

    // Combina chat + voz sem penalizar lives sem chat (ex: YouTube ou chat quieto)
    const junto = temChat ? Math.min(1, 0.58 * notaChat + 0.58 * notaAudio) : notaAudio;
    const n = Math.round(100 * limitar(Math.max(junto, notaChat * 0.92, notaAudio * 0.96), 0, 1));

    return {
      nivel: n,
      chat: cur,
      chatBase: Math.round(baseChat * 10) / 10,
      razaoChat: Math.round(razao * 10) / 10,
      deltaDb: delta == null ? null : Math.round(delta * 10) / 10,
      notaChat, notaAudio,
    };
  }

  disparar(nivel) {
    // o pico: o chat reage uns 3s depois do lance; o grito e na hora
    const t = this.agora() - (nivel.notaChat >= nivel.notaAudio ? 3 : 1);
    // Arco viral: climax nos ~76% finais do corte e fecho curto (4s a 9s) logo apos a reacao
    const depois = limitar(this.duracao * 0.24, 4, 9);
    const antes = this.duracao - depois;
    const motivos = [];
    if (nivel.notaChat > 0) motivos.push({ fator: 'Chat explodiu (' + nivel.razaoChat + 'x o normal)', pontos: Math.round(nivel.notaChat * 50) });
    if (nivel.notaAudio > 0) motivos.push({ fator: 'Pico de volume (+' + nivel.deltaDb + ' dB)', pontos: Math.round(nivel.notaAudio * 50) });
    this.ultimoGatilho = t;
    this.pendente = {
      origem: 'auto',
      pico: t,
      inicio: Math.max(0, t - antes),
      fim: t + depois,
      nota: nivel.nivel,
      motivos,
    };
    // trava os pedacos que vao ser usados (com margem pro ajuste de pausa), pro buffer nao apagar
    this.travar({ inicio: Math.max(0, this.pendente.inicio - 3), fim: this.pendente.fim + 3 }, 1);
    this.emitir({ tipo: 'gatilho', origem: 'auto', motivos, nivel: nivel.nivel, emSegundos: Math.max(0, Math.round(this.pendente.fim + 1.5 - this.total)) });
  }

  /**
   * Ajusta o inicio e o fim do corte ao vivo pras pausas naturais de respiracao
   * medidas em this.audio (a cada 0.5s), evitando cortar palavras pela metade.
   */
  ajustarBordasPeloAudio(pedido) {
    if (!this.audio || this.audio.length < 8) return { inicio: pedido.inicio, fim: pedido.fim };
    const minBuf = this.pedacos.length ? this.pedacos[0].t0 : 0;
    const maxBuf = this.total;

    const acharVale = (alvo, de, ate) => {
      const cand = this.audio.filter((a) => a.t >= de && a.t <= ate);
      if (!cand.length) return alvo;
      let melhor = cand[0];
      let menorCusto = Infinity;
      for (const a of cand) {
        const custo = a.db + Math.abs(a.t - alvo) * 1.6;
        if (custo < menorCusto) { menorCusto = custo; melhor = a; }
      }
      return melhor.t;
    };

    const iniMin = Math.max(minBuf, pedido.inicio - 2.5);
    const iniMax = Math.min(pedido.fim - 5, pedido.inicio + 2.5);
    const inicio = iniMax > iniMin ? acharVale(pedido.inicio, iniMin, iniMax) + 0.1 : pedido.inicio;

    const minFim = pedido.pico ? Math.max(inicio + 5, pedido.pico + 3.5) : inicio + 5;
    const fimMin = Math.max(minFim, pedido.fim - 2.0);
    const fimMax = Math.min(maxBuf, pedido.fim + 2.5);
    const fim = fimMax > fimMin ? acharVale(pedido.fim, fimMin, fimMax) + 0.2 : Math.min(maxBuf, pedido.fim);

    return { inicio: Math.max(minBuf, inicio), fim: Math.max(inicio + 4, Math.min(maxBuf, fim)) };
  }

  /** CLIPAR AGORA: os ultimos N segundos que ja estao gravados. */
  cliparAgora(segundos) {
    if (!this.clipando) throw new Error('Termine de configurar e aperte "Começar a clipar".');
    if (this.total < 5) throw new Error('Ainda não deu tempo de gravar nada. Espere alguns segundos.');
    const dur = limitar(Number(segundos) || this.duracao, 5, 180);
    const fim = this.total;
    const pedido = {
      origem: 'manual',
      inicio: Math.max(this.pedacos.length ? this.pedacos[0].t0 : 0, fim - dur),
      fim,
      nota: null,
      motivos: [{ fator: 'Você apertou CLIPAR', pontos: 0 }],
    };
    this.ultimoGatilho = this.agora();
    this.travar(pedido, 1);
    this.enfileirar(pedido, true);
    this.emitir({ tipo: 'gatilho', origem: 'manual', motivos: pedido.motivos, emSegundos: 0 });
  }

  travar(pedido, d) {
    for (const p of this.pedacos) {
      if (p.t0 < pedido.fim + 1 && p.t0 + p.dur > pedido.inicio - 1) p.travas = Math.max(0, p.travas + d);
    }
  }

  limparBuffer() {
    const limite = this.total - this.bufferMin * 60;
    while (this.pedacos.length && this.pedacos[0].t0 + this.pedacos[0].dur < limite && !this.pedacos[0].travas) {
      const p = this.pedacos.shift();
      try { fs.unlinkSync(p.arquivo); } catch (_) { }
    }
  }

  // ------------------------------------------------------------ corte

  enfileirar(pedido, naFrente) {
    if (naFrente) this.fila.unshift(pedido); else this.fila.push(pedido);
    this.proximoRender();
  }

  async proximoRender() {
    if (this.renderizando || !this.fila.length) return;
    this.renderizando = true;
    const pedido = this.fila.shift();
    try {
      await this.renderizar(pedido);
    } catch (e) {
      this.emitir({ tipo: 'aviso', msg: 'Um clipe falhou: ' + (e.message || e) });
    } finally {
      this.travar(pedido.origem === 'auto' ? { inicio: Math.max(0, pedido.inicio - 3), fim: pedido.fim + 3 } : pedido, -1);
      this.renderizando = false;
      this.proximoRender();
    }
  }

  async renderizar(pedidoBruto) {
    const { ffmpeg } = await media.garantirFfmpeg();
    const bordas = pedidoBruto.origem === 'auto' ? this.ajustarBordasPeloAudio(pedidoBruto) : { inicio: pedidoBruto.inicio, fim: pedidoBruto.fim };
    const pedido = Object.assign({}, pedidoBruto, bordas);
    const usados = this.pedacos.filter((p) => p.t0 < pedido.fim && p.t0 + p.dur > pedido.inicio && fs.existsSync(p.arquivo));
    if (!usados.length) throw new Error('esse trecho já saiu do buffer');

    const numero = this.clipes.length + 1;
    const nomeBase = 'clipe-' + String(numero).padStart(2, '0') + '-' + hms(pedido.inicio).replace(/:/g, '-');
    const lista = path.join(this.dir, nomeBase + '.txt');
    fs.writeFileSync(lista, usados.map((p) => "file '" + p.arquivo.replace(/\\/g, '/').replace(/'/g, "'\\''") + "'").join('\n'), 'utf8');

    const zeroJunto = usados[0].t0;
    const fimJunto = usados[usados.length - 1].t0 + usados[usados.length - 1].dur;
    const durJunto = Math.max(1, fimJunto - zeroJunto);
    const deslocamento = Math.max(0, pedido.inicio - zeroJunto);
    const dur = Math.min(pedido.fim, fimJunto) - Math.max(pedido.inicio, zeroJunto);
    const mp4 = path.join(this.pasta, nomeBase + '.mp4');
    const t0 = Date.now();
    this.emitir({ tipo: 'renderizando', numero, origem: pedido.origem });

    const filtro = media.filtroDeFormato(this.formato, this.recorte);
    fs.mkdirSync(pastas.trabalho(), { recursive: true });

    // 1. Junta os pedacos num .mkv continuo (indice exato pra cortar no frame 0 sem atrasar voz)
    const junto = path.join(this.dir, nomeBase + '-junto.mkv');
    await media.rodar(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error',
      '-fflags', '+genpts+discardcorrupt', '-f', 'concat', '-safe', '0', '-i', lista,
      '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-f', 'matroska', junto]);
    try { fs.unlinkSync(lista); } catch (_) { }

    // 2. Transcreve o trecho ANTES de gerar o .mp4 pra que o clipe ja saia na 1a vez com
    //    Gancho 4s queimado + Legenda dinamica na fonte escolhida + SEO (evita regravar .mp4 aberto no Windows!)
    let iniCorte = deslocamento;
    let durCorte = dur;
    let nota = pedido.nota != null ? pedido.nota : 70;
    let tituloFinal = (this.nomeCanal || this.canal || 'Live') + ' ao vivo · ' + hms(pedido.inicio);
    let titulosLista = [];
    let hashtagsLista = /\bgta\b|vice city|leonida/i.test(this.titulo || '') ? ['gta6', 'gtavi', 'gta'] : ['cortes', 'live'];
    let seoFinal = null;
    let ganchoFinal = null;
    let motivosFinais = pedido.motivos;
    let geradoPorIa = false;
    let textoCorte = '';
    let palsCorte = [];
    let legendouDeFato = false;

    const ctxCopy = { texto: this.titulo || '', canal: this.nomeCanal || this.canal || '', evitar: (this.titulosUsados = this.titulosUsados || new Set()) };
    const wavClip = path.join(pastas.trabalho(), 'av-render-' + this.id + '-' + numero + '.wav');
    const jsonClip = path.join(pastas.trabalho(), 'av-render-' + this.id + '-' + numero + '.json');

    let ass = null;
    try {
      let transcricaoJunto = null;
      let todasPalavras = [];
      try {
        await media.extrairAudio(junto, wavClip, durJunto);
        transcricaoJunto = await transcrever(wavClip, jsonClip, durJunto, 'base', this.idioma);
        todasPalavras = (transcricaoJunto.segmentos || []).reduce((acc, s) => acc.concat(s.palavras || []), []);
      } catch (_) { }

      const palsIniciais = todasPalavras.filter((p) => p.fim > iniCorte && p.inicio < iniCorte + durCorte);
      textoCorte = palsIniciais.map((p) => p.texto).join(' ').replace(/\s+/g, ' ').trim();

      if (this.usarIaPro && this.iaLiveExpiraEm && Date.now() >= new Date(this.iaLiveExpiraEm).getTime()) {
        this.definirExpiraIaLive(null);
        this.usarIaPro = false;
        this.emitir({
          tipo: 'pro-esgotado',
          msg: 'Seus 15 minutos grátis do Diretor IA Pro na Live acabaram! Atualize para o Plano Pro para continuar usando IA na live (os próximos cortes seguem no Motor Local).',
        });
        this.emitir(Object.assign({ tipo: 'estado' }, this.resumo()));
      }

      if (this.usarIaPro && transcricaoJunto && textoCorte.length >= 10) {
        try {
          const pro = require('./pro');
          const resIa = await pro.refinarClipeAoVivo(transcricaoJunto, iniCorte, durCorte, durJunto, {
            canal: this.nomeCanal || this.canal || '',
            contexto: this.titulo || 'Live ao vivo',
            sessaoLiveId: this.id,
          });
          if (resIa.liveExpiraEm) this.definirExpiraIaLive(resIa.liveExpiraEm);
          this.emitir({
            tipo: 'pro-estado',
            usouTrial: resIa.usouTrial,
            trialsRestantes: resIa.trialsRestantes,
            liveUsado: resIa.liveUsado,
            liveAtivo: resIa.liveAtivo,
            liveExpiraEm: resIa.liveExpiraEm || this.iaLiveExpiraEm || null,
          });
          if (resIa.corte) {
            const ci = resIa.corte;
            if (isFinite(ci.inicio) && isFinite(ci.duracao) && ci.duracao >= 5) {
              iniCorte = Math.max(0, Math.min(ci.inicio, Math.max(0, durJunto - 5)));
              durCorte = Math.max(5, Math.min(ci.duracao, durJunto - iniCorte));
            }
            tituloFinal = ci.titulo || tituloFinal;
            this.titulosUsados.add(String(tituloFinal).toLowerCase());
            titulosLista = ci.titulosIa || [{ texto: tituloFinal, estilo: 'ia' }];
            hashtagsLista = ci.hashtagsIa || hashtagsLista;
            nota = ci.nota || nota;
            motivosFinais = ci.motivos || motivosFinais;
            geradoPorIa = true;
            if (this.textoGancho !== false) {
              ganchoFinal = (ci.ganchoIa && legenda.semEmojis(ci.ganchoIa).length >= 3 ? ci.ganchoIa : null)
                || gerarGanchoDeTela({ texto: ci.texto || textoCorte, inicio: zeroJunto + iniCorte, contextoJogo: ctxCopy });
            }
            const seoBase = gerarSeoPlataformas({ texto: ci.texto || textoCorte }, tituloFinal, hashtagsLista, ctxCopy);
            const iaSeo = ci.seoIa || {};
            seoFinal = {
              tiktok: (iaSeo.tiktok && String(iaSeo.tiktok).trim()) || seoBase.tiktok,
              shorts: (iaSeo.shorts && String(iaSeo.shorts).trim()) || seoBase.shorts,
              shortsTitulo: seoBase.shortsTitulo,
              reels: (iaSeo.reels && String(iaSeo.reels).trim()) || seoBase.reels,
            };
          }
          if (resIa.usouTrial && !resIa.liveAtivo && Number(resIa.trialsRestantes) <= 0) {
            this.definirExpiraIaLive(null);
            this.usarIaPro = false;
            this.emitir({
              tipo: 'pro-esgotado',
              msg: 'Seu teste grátis do Diretor IA Pro na Live terminou! Atualize o plano para continuar usando IA na live (os próximos cortes seguem no Motor Local).',
            });
            this.emitir(Object.assign({ tipo: 'estado' }, this.resumo()));
          }
        } catch (errIa) {
          if (/teste|grátis|acabaram|usado|402|Atualize o plano|Plano Pro/i.test(errIa.message || '')) {
            this.definirExpiraIaLive(null);
            this.usarIaPro = false;
            this.emitir({
              tipo: 'pro-esgotado',
              msg: errIa.message || 'Seu teste grátis do Diretor IA Pro na Live acabou! Atualize o plano Pro para usar a IA na live (seguindo no Motor Local).',
            });
            this.emitir(Object.assign({ tipo: 'estado' }, this.resumo()));
          } else {
            this.emitir({ tipo: 'aviso', msg: 'IA Pro indisponível neste clipe (' + errIa.message + '). Usando título local.' });
          }
        }
      }

      palsCorte = todasPalavras.filter((p) => p.fim > iniCorte + 0.04 && p.inicio < iniCorte + durCorte);
      textoCorte = palsCorte.map((p) => p.texto).join(' ').replace(/\s+/g, ' ').trim() || textoCorte;

      if (!geradoPorIa && this.sugerirTitulo) {
        try {
          const cp = gerarCopy({ texto: textoCorte, inicio: zeroJunto + iniCorte, tags: [], palavras: palsCorte, motivos: motivosFinais, origem: pedido.origem },
            ctxCopy, sessoes.pegar());
          if (cp && cp.titulo) {
            tituloFinal = cp.titulo;
            titulosLista = cp.titulos;
            hashtagsLista = cp.hashtags;
            seoFinal = cp.seo;
            this.titulosUsados.add(String(cp.titulo).toLowerCase());
          }
        } catch (_) { }
      }

      if (this.textoGancho !== false && !ganchoFinal) {
        ganchoFinal = gerarGanchoDeTela({ texto: textoCorte, inicio: zeroJunto + iniCorte, contextoJogo: ctxCopy }) || 'OLHA ESSE MOMENTO NA LIVE';
      }

      legendouDeFato = !!(this.legendar && palsCorte.length);
      const temFixo = legenda.temTextoFixo(this.textoFixo);
      if (filtro && (ganchoFinal || legendouDeFato || temFixo)) {
        ass = 'aovivo-leg-' + this.id + '-' + numero + '.ass';
        legenda.gerarAss(palsCorte, iniCorte, path.join(pastas.trabalho(), ass), {
          fonte: this.fonteLegenda || 'tiktok',
          incluirPalavras: legendouDeFato,
          gancho: this.textoGancho !== false ? ganchoFinal : null,
          duracaoGancho: 4,
          margemGancho: legenda.margemGanchoIdeal(this.formato, this.recorte, this.textoFixo),
          margemBaixo: this.formato === 'split' ? 430 : 300,
          textoFixo: this.textoFixo,
          alturaDivisao: legenda.alturaDaDivisao(this.formato, this.recorte),
        });
      }
      if (palsCorte.length) {
        try { legenda.gerarSrt(palsCorte, iniCorte, path.join(this.pasta, nomeBase + '.srt')); } catch (_) { }
      }

      let args;
      if (filtro) {
        const fs2 = ass ? filtro.replace(/\[v\]$/, ',subtitles=' + ass + (fontsdirRelativo() ? ':fontsdir=' + fontsdirRelativo() : '') + '[v]') : filtro;
        args = ['-y', '-hide_banner', '-loglevel', 'error', '-ss', iniCorte.toFixed(3),
          '-i', junto, '-t', durCorte.toFixed(3),
          '-filter_complex', fs2, '-map', '[v]', '-map', '0:a?',
          '-fps_mode', 'cfr', '-avoid_negative_ts', 'make_zero',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
          '-af', 'aresample=async=1000:min_hard_comp=0.100000:first_pts=0', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000'];
      } else {
        args = ['-y', '-hide_banner', '-loglevel', 'error', '-ss', iniCorte.toFixed(3), '-i', junto,
          '-t', durCorte.toFixed(3), '-map', '0:v:0', '-map', '0:a?',
          '-fps_mode', 'cfr', '-avoid_negative_ts', 'make_zero',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
          '-af', 'aresample=async=1000:min_hard_comp=0.100000:first_pts=0', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000'];
      }
      args.push('-movflags', '+faststart', mp4);
      await media.rodar(ffmpeg, args, { cwd: pastas.trabalho() });
    } finally {
      try { fs.unlinkSync(junto); } catch (_) { }
      try { if (fs.existsSync(wavClip)) fs.unlinkSync(wavClip); } catch (_) { }
      try { if (fs.existsSync(jsonClip)) fs.unlinkSync(jsonClip); } catch (_) { }
      if (ass) { try { fs.unlinkSync(path.join(pastas.trabalho(), ass)); } catch (_) { } }
    }

    const jpg = path.join(this.pasta, nomeBase + '.jpg');
    try { await media.gerarMiniatura(mp4, Math.min(durCorte / 2, 8), jpg, this.formato !== 'original'); } catch (_) { }

    const inicioRealNaLive = zeroJunto + iniCorte;
    if (!seoFinal) seoFinal = gerarSeoPlataformas({ texto: textoCorte }, tituloFinal, hashtagsLista, { texto: this.titulo || '', canal: this.nomeCanal || this.canal || '' });
    const clipe = {
      numero,
      origem: pedido.origem,
      nota,
      rotulo: rotuloDoNivel(nota),
      titulo: tituloFinal,
      titulos: titulosLista,
      inicio: Math.round(inicioRealNaLive * 10) / 10,
      fim: Math.round((inicioRealNaLive + durCorte) * 10) / 10,
      duracao: Math.round(durCorte * 10) / 10,
      inicioTexto: hms(inicioRealNaLive),
      fimTexto: hms(inicioRealNaLive + durCorte),
      quando: new Date().toISOString(),
      motivos: motivosFinais,
      texto: textoCorte,
      hashtags: hashtagsLista,
      seo: seoFinal,
      legendaPost: (seoFinal && seoFinal.tiktok) || (tituloFinal + '\n\n' + hashtagsLista.map((h) => '#' + h).join(' ')),
      arquivo: mp4,
      nomeArquivo: path.basename(mp4),
      original: null,
      miniatura: fs.existsSync(jpg) ? jpg : null,
      formatoUsado: this.formato,
      recorte: this.recorte || null,
      textoFixo: this.textoFixo || null,
      gancho: this.textoGancho !== false ? ganchoFinal : null,
      legendar: !!this.legendar,
      fonteLegenda: this.fonteLegenda || 'tiktok',
      geradoPorIa: geradoPorIa || undefined,
      tamanhoMb: Math.round((fs.statSync(mp4).size / 1048576) * 10) / 10,
      segundosPraFicarPronto: Math.round((Date.now() - t0) / 100) / 10,
    };
    this.clipes.push(clipe);
    this.gravarRelatorio();
    this.emitir({ tipo: 'clipe', clipe });

    this.agendarOriginal(clipe, inicioRealNaLive);
  }

  // ------------------------------------------------------------ edicao

  /**
   * Pra editar um clipe da live depois (ir, voltar, mexer na legenda), ele
   * precisa de um original proprio: o buffer da live e apagado. Assim que a
   * live gravar a folga depois do lance, monta a versao deitada com 10s antes
   * e 10s depois, transcreve a fala dela e guarda tudo na pasta do projeto.
   * O clipe ja apareceu pronto antes disso - nada aqui atrasa o "postar primeiro".
   */
  agendarOriginal(clipe, inicioNaLive) {
    const job = {
      clipe,
      inicioNaLive,
      inicio: Math.max(0, inicioNaLive - MARGEM_EDICAO),
      fim: inicioNaLive + clipe.duracao + MARGEM_EDICAO,
    };
    this.travar(job, 1);
    this.originais.push(job);
    this.proximoOriginal();
  }

  async proximoOriginal() {
    if (this.fazendoOriginal || !this.originais.length) return;
    const job = this.originais[0];
    // espera a folga depois do lance ser gravada (ou a live parar)
    if (!this.parado && this.total < job.fim) return;
    this.fazendoOriginal = true;
    this.originais.shift();
    const clipe = job.clipe;
    const base = path.basename(clipe.nomeArquivo, '.mp4');
    try {
      const { ffmpeg } = await media.garantirFfmpeg();
      const usados = this.pedacos.filter((p) => p.t0 < job.fim && p.t0 + p.dur > job.inicio && fs.existsSync(p.arquivo));
      if (!usados.length) throw new Error('esse trecho já saiu do buffer');
      const lista = path.join(this.dir, base + '-orig.txt');
      fs.writeFileSync(lista, usados.map((p) => "file '" + p.arquivo.replace(/\\/g, '/').replace(/'/g, "'\\''") + "'").join('\n'), 'utf8');
      const junto = path.join(this.dir, base + '-orig.mkv');
      const original = path.join(this.pasta, base + '-original.mp4');
      try {
        await media.rodar(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error',
          '-fflags', '+genpts+discardcorrupt', '-f', 'concat', '-safe', '0', '-i', lista,
          '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-f', 'matroska', junto]);
        await media.rodar(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', junto,
          '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', original]);
      } finally {
        try { fs.unlinkSync(lista); } catch (_) { }
        try { fs.unlinkSync(junto); } catch (_) { }
      }

      // O original comeca no primeiro pedaco (que sempre abre num quadro-chave):
      // o clipe fica a "offset" segundos dele.
      const zero = usados[0].t0;
      const ultimo = usados[usados.length - 1];
      const offset = Math.round(Math.max(0, job.inicioNaLive - zero) * 100) / 100;
      const durOrig = Math.round((ultimo.t0 + ultimo.dur - zero) * 100) / 100;

      // Transcreve o original com folga (10s antes e 10s depois) ANTES de liberar
      // o botao Editar na janela, pra que o Editor ja abra com todas as palavras!
      fs.mkdirSync(pastas.trabalho(), { recursive: true });
      const wav = path.join(pastas.trabalho(), 'aovivo-' + this.id + '-' + clipe.numero + '.wav');
      const fala = path.join(this.pasta, base + '-fala.json');
      let nomeTransc = null;
      try {
        await media.extrairAudio(original, wav, durOrig);
        await transcrever(wav, fala, durOrig, 'base', this.idioma);
        if (fs.existsSync(fala)) nomeTransc = path.basename(fala);
      } catch (e) {
        if (!/fala nenhuma/i.test(e.message || '')) {
          this.emitir({ tipo: 'aviso', msg: 'Não consegui transcrever a folga do clipe ' + clipe.numero + ' (' + e.message + ').' });
        }
      } finally {
        try { fs.unlinkSync(wav); } catch (_) { }
      }

      clipe.original = original;
      clipe.fonte = {
        video: path.basename(original),
        duracao: durOrig,
        zeroNaLive: Math.round(zero * 100) / 100,
        transcricao: nomeTransc,
      };
      clipe.inicio = offset;
      clipe.fim = Math.round((offset + clipe.duracao) * 100) / 100;
      this.gravarRelatorio();
      this.emitir({ tipo: 'clipe-atualizado', clipe });
    } catch (e) {
      this.emitir({ tipo: 'aviso', msg: 'O clipe ' + clipe.numero + ' está pronto, mas não deu pra preparar a edição dele (' + e.message + ').' });
    } finally {
      this.travar(job, -1);
      this.fazendoOriginal = false;
      this.proximoOriginal();
    }
  }

  gravarRelatorio() {
    const r = {
      nome: (this.nomeCanal || this.canal || 'live') + ' · ao vivo',
      videoOriginal: this.url,
      aoVivo: true,
      plataforma: this.plataforma,
      tituloDaLive: this.titulo,
      duracaoOriginal: Math.round(this.total),
      gerado: new Date(this.inicio).toISOString(),
      sessao: sessoes.pegar().id,
      formato: this.formato,
      clipes: this.clipes,
    };
    try { fs.writeFileSync(path.join(this.pasta, 'relatorio.json'), JSON.stringify(r, null, 2), 'utf8'); } catch (_) { }
    // o que o editor precisa pra refazer um clipe: cada clipe traz o proprio
    // original e enquadramento (campo fonte), entao aqui fica so o geral
    const sessao = {
      aoVivo: true,
      video: null,
      duracaoVideo: 0,
      opcoes: {
        sessao: sessoes.pegar().id, formato: this.formato, recorte: this.recorte, textoFixo: this.textoFixo,
        legendar: !!this.legendar, textoGancho: this.textoGancho !== false, fonteLegenda: this.fonteLegenda || 'tiktok',
        qualidade: 'alta', detectarWebcam: false, idioma: this.idioma,
      },
      clipes: this.clipes,
    };
    try { fs.writeFileSync(path.join(this.pasta, 'sessao.json'), JSON.stringify(sessao, null, 2), 'utf8'); } catch (_) { }
  }

  /** Um clipe refeito no editor passa a valer na lista da live (e no disco). */
  atualizarClipe(novo) {
    const i = this.clipes.findIndex((c) => c.numero === novo.numero);
    if (i < 0) return;
    this.clipes[i] = Object.assign({}, this.clipes[i], novo);
    this.gravarRelatorio();
    this.emitir({ tipo: 'clipe-atualizado', clipe: this.clipes[i] });
  }

  definirExpiraIaLive(expiraIso) {
    clearTimeout(this.timerExpiraIaLive);
    this.timerExpiraIaLive = null;
    this.iaLiveExpiraEm = expiraIso || null;
    if (!expiraIso || this.parado) return;
    const ms = new Date(expiraIso).getTime() - Date.now();
    if (!isFinite(ms)) return;
    this.timerExpiraIaLive = setTimeout(() => {
      if (this.parado || !this.usarIaPro) return;
      this.iaLiveExpiraEm = null;
      this.usarIaPro = false;
      this.emitir({
        tipo: 'pro-esgotado',
        msg: 'Seus 15 minutos grátis do Diretor IA Pro na Live acabaram! Atualize para o Plano Pro para continuar usando IA na live (a gravação segue normalmente no Motor Local).',
      });
      this.emitir(Object.assign({ tipo: 'estado' }, this.resumo()));
    }, Math.max(500, ms));
  }

  ajustar(o) {
    if (o.auto != null) this.auto = !!o.auto;
    if (LIMIAR[o.sensibilidade]) this.sensibilidade = o.sensibilidade;
    if (o.duracao) this.duracao = limitar(Number(o.duracao) || 30, 10, 120);
    if (['split', 'vertical', 'foco', 'blur', 'original'].includes(o.formato)) this.formato = o.formato;
    if (o.recorte) this.recorte = o.recorte;
    if (o.textoFixo !== undefined) this.textoFixo = o.textoFixo;
    if (typeof o.textoGancho === 'boolean') this.textoGancho = o.textoGancho;
    if (typeof o.legendar === 'boolean') this.legendar = o.legendar;
    if (o.fonteLegenda) this.fonteLegenda = String(o.fonteLegenda);
    if (typeof o.usarIaPro === 'boolean') this.usarIaPro = o.usarIaPro;
    if (o.clipando === true && !this.clipando) {
      this.clipando = true;
      // o nivel de antes nao dispara clipe: o automatico comeca agora
      this.ultimoGatilho = this.agora();
    }
    this.emitir(Object.assign({ tipo: 'estado' }, this.resumo()));
  }

  /** Ultimo pedaco gravado - pra mostrar a imagem da live e marcar a webcam. */
  ultimoPedaco() {
    return this.ultimosPedacos(1)[0] || null;
  }

  /** Os N pedacos mais novos que ainda estao no disco, do mais novo pro mais velho. */
  ultimosPedacos(n) {
    const lista = [];
    for (let i = this.pedacos.length - 1; i >= 0 && lista.length < n; i--) {
      if (fs.existsSync(this.pedacos[i].arquivo)) lista.push(this.pedacos[i].arquivo);
    }
    return lista;
  }

  parar(jaEncerrada) {
    if (this.parado) return;
    this.parado = true;
    clearInterval(this.relogio);
    clearTimeout(this.timerHls);
    clearTimeout(this.timerReconexao);
    clearTimeout(this.timerExpiraIaLive);
    if (this.fecharChat) this.fecharChat();
    if (this.proc) { try { this.proc.kill(); } catch (_) { } }
    if (this.procYt) { try { this.procYt.kill(); } catch (_) { } }
    // o que ainda esta na fila termina; depois o buffer (temporario) e apagado
    const limpar = () => {
      // termina os clipes na fila e os originais (pra editar) antes de apagar o buffer
      if (this.renderizando || this.fila.length || this.fazendoOriginal || this.originais.length) {
        this.proximoOriginal();
        return setTimeout(limpar, 2000);
      }
      for (const p of this.pedacos) { try { fs.unlinkSync(p.arquivo); } catch (_) { } }
      try {
        for (const n of fs.readdirSync(this.dir)) fs.unlinkSync(path.join(this.dir, n));
        fs.rmdirSync(this.dir);
      } catch (_) { }
      // conectou e cancelou sem clipar: a pasta do projeto ficou vazia.
      // rmdir so apaga pasta VAZIA - se tiver qualquer clipe, ela fica.
      if (!this.clipes.length && this.pasta) { try { fs.rmdirSync(this.pasta); } catch (_) { } }
    };
    setTimeout(limpar, 1500);
    if (!jaEncerrada) this.status('parado', 'Parou de gravar. Os clipes feitos estão salvos.');
  }
}

/**
 * O buffer e temporario: se o programa fechou no meio de uma live, os pedacos
 * ficaram pra tras. Ao abrir, apaga essas sobras (so .ts/.csv/.txt da pasta
 * ao-vivo - os clipes prontos ficam na pasta de saida, que nunca e tocada).
 */
function limparSobras() {
  let pastas = [];
  try { pastas = fs.readdirSync(pastas.aoVivo(), { withFileTypes: true }).filter((d) => d.isDirectory()); } catch (_) { return; }
  for (const d of pastas) {
    const dir = path.join(pastas.aoVivo(), d.name);
    try {
      for (const n of fs.readdirSync(dir)) {
        if (/\.(ts|mkv|csv|txt)$/i.test(n)) fs.unlinkSync(path.join(dir, n));
      }
      fs.rmdirSync(dir);
    } catch (_) { }
  }
}

module.exports = { SessaoAoVivo, limparSobras, checarLink, resolverAoVivo, plataformaDe, canalDoLink };
