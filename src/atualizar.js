'use strict';
/**
 * Central de Avisos e Auto-Update Obrigatorio por Git (100% gratuita via GitHub).
 *
 * - Sempre que um commit novo entra na branch `main` do GitHub (ou a versao sobe
 *   em docs/comunicados.json), o programa detecta o novo SHA do Git mesmo sem
 *   precisar mudar numero de versao e obriga a atualizacao automatica na tela.
 * - Usa o feed Atom publico do GitHub (/commits/main.atom) sem limite de 60 req/h,
 *   com fallback pra API REST de commits.
 * - Como runtime/ e modelos/ ficam intactos, a atualizacao baixa ~200 KB e
 *   reinicia o servidor sozinho em ~3 segundos.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const ARQ_GIT_REV = path.join(RAIZ, 'git-rev.json');

const URLS_COMUNICADOS = [
  'https://raw.githubusercontent.com/gabrielworkspace/cortador-automatico/main/docs/comunicados.json',
  'https://gabrielworkspace.github.io/cortador-automatico/comunicados.json',
];
const URL_ATOM_COMMITS = 'https://github.com/gabrielworkspace/cortador-automatico/commits/main.atom';
const URL_API_COMMIT = 'https://api.github.com/repos/gabrielworkspace/cortador-automatico/commits/main';
const URL_PACOTE_CODIGO = 'https://codeload.github.com/gabrielworkspace/cortador-automatico/tar.gz/refs/heads/main';
const URL_INSTALADOR = 'https://github.com/gabrielworkspace/cortador-automatico/releases/latest/download/Instalar-Cortador-Automatico.exe';

function versaoLocal() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
    return String(pkg.version || '2.0.0').trim();
  } catch (_) {
    return '2.0.0';
  }
}

function compararVersoes(a, b) {
  const pa = String(a || '0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

function lerShaSalvo() {
  try {
    const j = JSON.parse(fs.readFileSync(ARQ_GIT_REV, 'utf8'));
    return j && /^[0-9a-f]{7,40}$/i.test(j.sha || '') ? String(j.sha).toLowerCase() : '';
  } catch (_) {
    return '';
  }
}

function salvarShaLocal(sha) {
  if (!sha || !/^[0-9a-f]{7,40}$/i.test(sha)) return;
  try {
    fs.writeFileSync(ARQ_GIT_REV, JSON.stringify({ sha: String(sha).toLowerCase(), atualizadoEm: new Date().toISOString() }, null, 2), 'utf8');
  } catch (_) {}
}

function decodificarXml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** Consulta o ultimo commit da branch main no GitHub sem sofrer rate-limit. */
async function consultarUltimoCommitRemoto() {
  const carimbo = Date.now();
  try {
    const r = await fetch(URL_ATOM_COMMITS + '?t=' + carimbo, {
      headers: { Accept: 'application/atom+xml,text/xml', 'Cache-Control': 'no-cache', 'User-Agent': 'CortadorAutomatico-Updater' },
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const xml = await r.text();
      const entry = /<entry>([\s\S]*?)<\/entry>/i.exec(xml);
      if (entry) {
        const bloco = entry[1];
        const mSha = /Commit\/([0-9a-f]{40})/i.exec(bloco);
        const mTit = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(bloco);
        const mData = /<updated>([^<]+)<\/updated>/i.exec(bloco);
        if (mSha) {
          return {
            sha: mSha[1].toLowerCase(),
            mensagem: mTit ? decodificarXml(mTit[1]).slice(0, 140) : '',
            data: mData ? mData[1].trim() : '',
          };
        }
      }
    }
  } catch (_) {}

  try {
    const r2 = await fetch(URL_API_COMMIT, {
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache', 'User-Agent': 'CortadorAutomatico-Updater' },
      signal: AbortSignal.timeout(8000),
    });
    if (r2.ok) {
      const j = await r2.json();
      if (j && j.sha) {
        return {
          sha: String(j.sha).toLowerCase(),
          mensagem: String((j.commit && j.commit.message) || '').split(/\r?\n/)[0].slice(0, 140),
          data: (j.commit && j.commit.committer && j.commit.committer.date) || '',
        };
      }
    }
  } catch (_) {}
  return null;
}

function rodarArquivo(cmd, args, opcoes) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, Object.assign({ windowsHide: true, timeout: 60000 }, opcoes || {}), (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || stdout || err.message || '').toString().trim() || 'falha ao executar ' + cmd));
      resolve(String(stdout || ''));
    });
  });
}

/** Quando a pasta tem .git, confere direto no git quantos commits estamos atras do origin/main. */
async function checarAtrasoGitLocal() {
  if (!fs.existsSync(path.join(RAIZ, '.git'))) return null;
  try {
    await rodarArquivo('git', ['fetch', 'origin', 'main', '--quiet'], { cwd: RAIZ, timeout: 10000 });
    const atrasTxt = await rodarArquivo('git', ['rev-list', '--count', 'HEAD..origin/main'], { cwd: RAIZ, timeout: 5000 });
    const shaHead = (await rodarArquivo('git', ['rev-parse', 'HEAD'], { cwd: RAIZ, timeout: 5000 })).trim().toLowerCase();
    const shaOrig = (await rodarArquivo('git', ['rev-parse', 'origin/main'], { cwd: RAIZ, timeout: 5000 })).trim().toLowerCase();
    return { atras: parseInt(atrasTxt.trim(), 10) || 0, shaLocal: shaHead, shaRemoto: shaOrig };
  } catch (_) {
    return null;
  }
}

function normalizarAviso(a) {
  if (!a || typeof a !== 'object' || !a.ativo) return null;
  const titulo = String(a.titulo || '').trim().slice(0, 120);
  const texto = String(a.texto || '').trim().slice(0, 500);
  if (!titulo && !texto) return null;
  const botaoUrl = /^https:\/\/[^\s]+$/i.test(String(a.botaoUrl || '').trim()) ? String(a.botaoUrl).trim() : '';
  const botaoTexto = botaoUrl ? String(a.botaoTexto || 'Abrir').trim().slice(0, 40) : '';
  const tipo = ['info', 'novidade', 'urgente'].includes(a.tipo) ? a.tipo : 'info';
  return {
    id: String(a.id || (titulo + ':' + texto).slice(0, 40)),
    tipo,
    titulo,
    texto,
    botaoTexto,
    botaoUrl,
    fixo: !!a.fixo,
  };
}

let cache = null;
let cacheEm = 0;

async function checarRemoto(forcar) {
  const atual = versaoLocal();
  if (!forcar && cache && Date.now() - cacheEm < 90 * 1000) {
    return cache;
  }

  const carimbo = Date.now();
  const [dadosComunicados, commitRemoto, estadoGit] = await Promise.all([
    (async () => {
      for (const base of URLS_COMUNICADOS) {
        try {
          const r = await fetch(base + '?t=' + carimbo, {
            headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
            signal: AbortSignal.timeout(8000),
          });
          if (!r.ok) continue;
          const j = await r.json();
          if (j && typeof j === 'object') return { dados: j, local: false };
        } catch (_) {}
      }
      try {
        const arqLocal = path.join(RAIZ, 'docs', 'comunicados.json');
        if (fs.existsSync(arqLocal)) {
          return { dados: JSON.parse(fs.readFileSync(arqLocal, 'utf8')), local: true };
        }
      } catch (_) {}
      return { dados: null, local: true };
    })(),
    consultarUltimoCommitRemoto(),
    checarAtrasoGitLocal(),
  ]);

  const dados = dadosComunicados.dados;
  const veioLocal = dadosComunicados.local;
  const remota = dados ? String(dados.versao || atual).trim() : atual;
  const versaoSubiu = !veioLocal && compararVersoes(remota, atual) > 0;

  let gitNovo = false;
  let shaRemoto = (commitRemoto && commitRemoto.sha) || (estadoGit && estadoGit.shaRemoto) || '';
  let shaLocal = (estadoGit && estadoGit.shaLocal) || lerShaSalvo();

  if (estadoGit) {
    // Pasta com .git: so obriga atualizar se origin/main tiver commits novos que nao temos aqui
    gitNovo = estadoGit.atras > 0;
  } else if (shaRemoto) {
    if (shaLocal) {
      gitNovo = shaLocal !== shaRemoto;
    } else {
      // Instalacao antiga sem git-rev.json (instaladores novos ja gravam git-rev.json no build):
      // forca a atualizacao para garantir as correcoes mais recentes da main.
      gitNovo = true;
    }
  }

  const temAtualizacao = versaoSubiu || gitNovo;
  const resumoBase = dados ? String(dados.resumoVersao || '').trim().slice(0, 240) : '';
  const msgCommit = commitRemoto && commitRemoto.mensagem ? commitRemoto.mensagem : '';
  const resumoFinal = gitNovo && !versaoSubiu && msgCommit
    ? ('Nova atualização no GitHub: ' + msgCommit)
    : (resumoBase || msgCommit || 'Melhorias de desempenho, sincronia e estabilidade.');

  const proApiUrl = dados && /^https:\/\/[^\s/]+/i.test(String(dados.proApiUrl || '').trim())
    ? String(dados.proApiUrl).trim().replace(/\/+$/, '')
    : '';

  const resultado = {
    versaoAtual: atual,
    versaoRemota: remota,
    shaLocal: shaLocal ? shaLocal.slice(0, 7) : '',
    shaRemoto: shaRemoto ? shaRemoto.slice(0, 7) : '',
    temAtualizacao,
    obrigatoria: temAtualizacao,
    motivoAtualizacao: versaoSubiu ? 'versao' : (gitNovo ? 'git' : ''),
    resumoVersao: resumoFinal,
    precisaInstalador: !!(dados && dados.precisaInstalador && versaoSubiu),
    urlInstalador: URL_INSTALADOR,
    proApiUrl,
    aviso: dados ? normalizarAviso(dados.aviso) : null,
    offline: veioLocal && !commitRemoto,
  };
  cache = resultado;
  cacheEm = Date.now();
  return resultado;
}

function acharTar() {
  if (process.platform === 'win32') {
    const sysTar = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'tar.exe');
    if (fs.existsSync(sysTar)) return sysTar;
  }
  return 'tar';
}

async function aplicarAtualizacao() {
  if (fs.existsSync(path.join(RAIZ, '.git'))) {
    const status = (await rodarArquivo('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: RAIZ })).trim();
    if (status) {
      await rodarArquivo('git', ['stash', 'push', '-m', 'cortador-auto-update'], { cwd: RAIZ });
      try {
        await rodarArquivo('git', ['pull', '--rebase', 'origin', 'main'], { cwd: RAIZ });
      } finally {
        try { await rodarArquivo('git', ['stash', 'pop'], { cwd: RAIZ }); } catch (_) {}
      }
    } else {
      await rodarArquivo('git', ['pull', '--ff-only', 'origin', 'main'], { cwd: RAIZ });
    }
    try {
      const novoSha = (await rodarArquivo('git', ['rev-parse', 'HEAD'], { cwd: RAIZ })).trim();
      salvarShaLocal(novoSha);
    } catch (_) {}
    cache = null;
    return {
      ok: true,
      versaoNova: versaoLocal(),
      reiniciando: true,
    };
  }

  const commitInfo = await consultarUltimoCommitRemoto();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortador-upd-'));
  const arquivoTar = path.join(tmpDir, 'pacote.tar.gz');
  const pastaExtraida = path.join(tmpDir, 'extraido');
  fs.mkdirSync(pastaExtraida, { recursive: true });

  try {
    // Baixa exatamente o commit que foi conferido (e nao o que estiver na main no instante do download)
    const shaAlvo = commitInfo && /^[0-9a-f]{40}$/i.test(commitInfo.sha || '') ? commitInfo.sha : '';
    const urlPacote = shaAlvo
      ? 'https://codeload.github.com/gabrielworkspace/cortador-automatico/tar.gz/' + shaAlvo
      : URL_PACOTE_CODIGO + '?t=' + Date.now();
    const r = await fetch(urlPacote, {
      redirect: 'follow',
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) throw new Error('Não consegui baixar a atualização (HTTP ' + r.status + ').');
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length < 20000) throw new Error('O pacote de atualização veio incompleto.');
    fs.writeFileSync(arquivoTar, bytes);

    await rodarArquivo(acharTar(), ['-xzf', arquivoTar, '-C', pastaExtraida]);

    const subpastas = fs.readdirSync(pastaExtraida)
      .map((n) => path.join(pastaExtraida, n))
      .filter((p) => fs.statSync(p).isDirectory());
    const origem = subpastas[0];
    if (!origem ||
        !fs.existsSync(path.join(origem, 'src', 'server.js')) ||
        !fs.existsSync(path.join(origem, 'src', 'ui', 'index.html')) ||
        !fs.existsSync(path.join(origem, 'package.json'))) {
      throw new Error('Os arquivos da atualização não passaram na verificação.');
    }

    for (const dir of ['src', 'py']) {
      const de = path.join(origem, dir);
      if (fs.existsSync(de)) {
        fs.cpSync(de, path.join(RAIZ, dir), { recursive: true, force: true });
      }
    }
    fs.copyFileSync(path.join(origem, 'package.json'), path.join(RAIZ, 'package.json'));
    if (fs.existsSync(path.join(origem, 'LEIA-ME-NOVIDADES.txt'))) {
      fs.copyFileSync(path.join(origem, 'LEIA-ME-NOVIDADES.txt'), path.join(RAIZ, 'LEIA-ME-NOVIDADES.txt'));
    }

    const mDirSha = /([0-9a-f]{40})$/i.exec(path.basename(origem));
    const shaGravado = (mDirSha && mDirSha[1]) || (commitInfo && commitInfo.sha) || '';
    if (shaGravado) salvarShaLocal(shaGravado);

    cache = null;
    return {
      ok: true,
      versaoNova: versaoLocal(),
      shaNovo: shaGravado ? shaGravado.slice(0, 7) : '',
      reiniciando: true,
    };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

module.exports = {
  versaoLocal,
  compararVersoes,
  checarRemoto,
  aplicarAtualizacao,
};
