'use strict';
/**
 * Monta o instalador do Cortador Automatico pra Windows.
 *
 *     node instalador/montar.js
 *
 * Junta numa pasta so (instalador/montagem) tudo que o programa precisa pra
 * rodar num PC que nao tem nada instalado - Node, Python com o faster-whisper,
 * ffmpeg, yt-dlp e o modelo "small" - compila o .exe que abre o programa e
 * gera instalador/dist/Instalar-Cortador-Automatico.exe com o Inno Setup.
 *
 * O que vem da internet (Python embutido, ffmpeg, yt-dlp, Inno Setup) fica
 * guardado em instalador/cache pra proxima vez.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const AQUI = __dirname;
const RAIZ = path.join(AQUI, '..');
const CACHE = path.join(AQUI, 'cache');
const MONTAGEM = path.join(AQUI, 'montagem');
const DIST = path.join(AQUI, 'dist');
const IMAGENS = path.join(AQUI, 'imagens');

const PYTHON_VERSAO = '3.12.10';
const INNO_VERSAO = '6.7.3';
// FFmpeg 8.0.1 usa NVENC API 13.0 (driver NVIDIA 570+/582.xx, incluindo Pascal/GTX 10xx).
// O link movel ffmpeg-release-essentials virou 9.1 (NVENC 13.1, exige driver 610+).
const FFMPEG_VERSAO = '8.0.1';
const DOWNLOADS = {
  'python-embed.zip': 'https://www.python.org/ftp/python/' + PYTHON_VERSAO + '/python-' + PYTHON_VERSAO + '-embed-amd64.zip',
  'ffmpeg-essentials.zip': 'https://github.com/GyanD/codexffmpeg/releases/download/' + FFMPEG_VERSAO + '/ffmpeg-' + FFMPEG_VERSAO + '-essentials_build.zip',
  'yt-dlp.exe': 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
  'innosetup.exe': 'https://github.com/jrsoftware/issrc/releases/download/is-' + INNO_VERSAO.replace(/\./g, '_') + '/innosetup-' + INNO_VERSAO + '.exe',
};

// As mesmas versoes que rodam no PC onde o programa foi feito.
const PACOTES_PY = [
  'faster-whisper==1.2.1', 'ctranslate2==4.8.2', 'av==18.1.0', 'onnxruntime==1.29.0',
  'tokenizers==0.23.1', 'numpy==2.5.2', 'huggingface_hub==1.29.0',
];

// Runtime do Visual C++ que o onnxruntime e o ctranslate2 pedem. Vai do lado do
// python.exe, pra funcionar tambem em PC que nunca instalou o "Visual C++ Redistributable".
const DLLS_VC = ['msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll', 'concrt140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'];

// small: a transcricao dos videos. base: o modo "Rapido" e o titulo dos
// clipes ao vivo. Os dois vao dentro, pra funcionar sem internet.
const MODELOS = ['models--Systran--faster-whisper-small', 'models--Systran--faster-whisper-base'];

// Os do proprio Windows: no Git Bash o tar e o curl do PATH sao outros e nao entendem 'C:'.
const SISTEMA32 = path.join(process.env.WINDIR || 'C:\\Windows', 'System32');
const TAR = path.join(SISTEMA32, 'tar.exe');
const CURL = path.join(SISTEMA32, 'curl.exe');

function passo(msg) { console.log('\n== ' + msg); }

function rodar(cmd, args, opcoes) {
  return execFileSync(cmd, args, Object.assign({ stdio: 'inherit', windowsHide: true }, opcoes));
}

function comecaCom(arquivo, assinatura) {
  const fd = fs.openSync(arquivo, 'r');
  const buf = Buffer.alloc(assinatura.length);
  fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  return buf.toString('latin1') === assinatura;
}

function baixar() {
  passo('Baixando o que falta (fica guardado em instalador/cache)');
  fs.mkdirSync(CACHE, { recursive: true });
  for (const [nome, url] of Object.entries(DOWNLOADS)) {
    const alvo = path.join(CACHE, nome);
    const assinatura = nome.endsWith('.zip') ? 'PK' : 'MZ';
    if (fs.existsSync(alvo) && comecaCom(alvo, assinatura)) { console.log('   ja tenho ' + nome); continue; }
    console.log('   baixando ' + nome);
    rodar(CURL, ['-L', '--fail', '--retry', '3', '-o', alvo, url]);
    if (!comecaCom(alvo, assinatura)) throw new Error(nome + ' veio errado (nao e ' + assinatura + ')');
  }
}

function acharInno() {
  const iscc = path.join(CACHE, 'inno', 'ISCC.exe');
  if (fs.existsSync(iscc)) return iscc;
  passo('Instalando o Inno Setup (so pra esta pasta, modo portatil)');
  rodar(path.join(CACHE, 'innosetup.exe'), [
    '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CURRENTUSER', '/PORTABLE=1',
    '/DIR=' + path.join(CACHE, 'inno'),
  ]);
  if (!fs.existsSync(iscc)) throw new Error('Nao consegui instalar o Inno Setup');
  return iscc;
}

function acharPythonLocal() {
  const candidatos = [
    process.env.PYTHON_BIN,
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe'),
  ].filter(Boolean);
  for (const c of candidatos) if (fs.existsSync(c)) return c;
  throw new Error('Preciso de um Python 3.12 nesta maquina pra baixar as bibliotecas (ou PYTHON_BIN).');
}

function acharCsc() {
  const c = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!fs.existsSync(c)) throw new Error('Nao achei o csc.exe do .NET Framework 4');
  return c;
}

function copiar(de, para, filtro) {
  // dereference: no GitHub Actions o cache do Hugging Face pode guardar os
  // arquivos do modelo como link pra pasta blobs (que nao vai junto) - copia
  // sempre o arquivo de verdade, nunca o link.
  fs.cpSync(de, para, { recursive: true, dereference: true, filter: filtro || (() => true) });
}

const semLixo = (src) => !/[\\/](__pycache__|\.git)([\\/]|$)/.test(src) && !/\.pyc$/.test(src);

function montarApp() {
  passo('Programa (src e py)');
  const app = path.join(MONTAGEM, 'app');
  // So o codigo: o programa nao usa bibliotecas do npm, e a pasta fontes/ do
  // PC tem fonte paga (Burbank) que nao pode ir num instalador publico.
  for (const pasta of ['src', 'py']) copiar(path.join(RAIZ, pasta), path.join(app, pasta), semLixo);
  fs.copyFileSync(path.join(RAIZ, 'package.json'), path.join(app, 'package.json'));
}

function montarNode() {
  passo('Node ' + process.version);
  const destino = path.join(MONTAGEM, 'runtime', 'node');
  fs.mkdirSync(destino, { recursive: true });
  fs.copyFileSync(process.execPath, path.join(destino, 'node.exe'));
  const licenca = path.join(path.dirname(process.execPath), 'LICENSE');
  if (fs.existsSync(licenca)) fs.copyFileSync(licenca, path.join(destino, 'LICENSE.txt'));
}

function montarPython() {
  passo('Python ' + PYTHON_VERSAO + ' embutido + faster-whisper');
  const destino = path.join(MONTAGEM, 'runtime', 'python');
  fs.mkdirSync(destino, { recursive: true });
  rodar(TAR, ['-xf', path.join(CACHE, 'python-embed.zip'), '-C', destino]);

  // O Python embutido ignora site-packages ate a gente mandar olhar la.
  const pth = fs.readdirSync(destino).find((f) => /^python\d+\._pth$/.test(f));
  fs.writeFileSync(path.join(destino, pth), [
    'python' + PYTHON_VERSAO.split('.').slice(0, 2).join('') + '.zip',
    '.',
    'Lib\\site-packages',
    '',
    'import site',
    '',
  ].join('\r\n'));

  const sitePackages = path.join(destino, 'Lib', 'site-packages');
  rodar(acharPythonLocal(), ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-warn-script-location',
    '--only-binary=:all:', '--target', sitePackages].concat(PACOTES_PY));
  // Os .exe de linha de comando (hf, tqdm...) e as ferramentas de conversao de
  // modelo do onnxruntime nao servem pro programa - e tem caminho tao comprido
  // que, instalado em C:\Users\<nome>\AppData\..., passaria do limite de 260
  // letras do Windows. O faster-whisper so usa o InferenceSession.
  for (const sobra of ['bin', 'onnxruntime/tools', 'onnxruntime/transformers', 'onnxruntime/quantization']) {
    fs.rmSync(path.join(sitePackages, sobra), { recursive: true, force: true });
  }

  const sistema = path.join(process.env.WINDIR || 'C:\\Windows', 'System32');
  for (const dll of DLLS_VC) {
    const alvo = path.join(destino, dll);
    if (!fs.existsSync(alvo) && fs.existsSync(path.join(sistema, dll))) fs.copyFileSync(path.join(sistema, dll), alvo);
  }
}

function montarFfmpeg() {
  passo('ffmpeg');
  const aberto = path.join(CACHE, 'ffmpeg');
  if (!fs.existsSync(aberto)) {
    fs.mkdirSync(aberto, { recursive: true });
    rodar(TAR, ['-xf', path.join(CACHE, 'ffmpeg-essentials.zip'), '-C', aberto]);
  }
  const raiz = path.join(aberto, fs.readdirSync(aberto).find((d) => /^ffmpeg-/.test(d)));
  const destino = path.join(MONTAGEM, 'runtime', 'ffmpeg');
  fs.mkdirSync(destino, { recursive: true });
  for (const exe of ['ffmpeg.exe', 'ffprobe.exe']) fs.copyFileSync(path.join(raiz, 'bin', exe), path.join(destino, exe));
  fs.copyFileSync(path.join(raiz, 'LICENSE'), path.join(destino, 'LICENSE.txt'));
  console.log('   ' + path.basename(raiz));

  passo('yt-dlp');
  fs.copyFileSync(path.join(CACHE, 'yt-dlp.exe'), path.join(MONTAGEM, 'runtime', 'yt-dlp.exe'));
}

function montarModelo() {
  passo('Modelos de transcricao (small e base)');
  for (const modelo of MODELOS) {
    const de = path.join(RAIZ, 'modelos', modelo);
    if (!fs.existsSync(de)) throw new Error('Nao achei ' + de + ' (rode o programa uma vez pra baixar o modelo)');
    // So o que o faster-whisper le: refs/main aponta pra pasta em snapshots.
    copiar(de, path.join(MONTAGEM, 'modelos', modelo), (src) => !/[\\/](\.no_exist|blobs)([\\/]|$)/.test(src));
  }
}

function montarLancador() {
  passo('Compilando o CortadorAutomatico.exe');
  rodar(acharCsc(), [
    '/nologo', '/target:winexe', '/optimize+', '/platform:anycpu',
    '/win32icon:' + path.join(IMAGENS, 'icone.ico'),
    '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Management.dll',
    '/out:' + path.join(MONTAGEM, 'CortadorAutomatico.exe'),
    path.join(AQUI, 'lancador', 'CortadorAutomatico.cs'),
  ]);
}

function compilarInstalador() {
  passo('Gerando o instalador (demora uns minutos: comprime quase 1 GB)');
  const iss = path.join(AQUI, 'cortador.iss');
  // O Inno so le acento direito se o .iss tiver a marca de UTF-8 (BOM).
  const texto = fs.readFileSync(iss, 'utf8');
  if (texto.charCodeAt(0) !== 0xfeff) fs.writeFileSync(iss, '\ufeff' + texto, 'utf8');
  fs.mkdirSync(DIST, { recursive: true });
  rodar(acharInno(), ['/Q', '/DMONTAGEM=' + MONTAGEM, '/DSAIDA=' + DIST, iss], { cwd: AQUI });
}

function tamanho(pasta) {
  let total = 0;
  for (const item of fs.readdirSync(pasta, { withFileTypes: true })) {
    const p = path.join(pasta, item.name);
    total += item.isDirectory() ? tamanho(p) : fs.statSync(p).size;
  }
  return total;
}

function main() {
  if (os.platform() !== 'win32') throw new Error('O instalador so e montado no Windows.');
  // --so-montar: para antes do instalador, pra testar a pasta montada
  // --so-instalador: gera o instalador em cima da montagem que ja existe
  const soMontar = process.argv.includes('--so-montar');
  const soInstalador = process.argv.includes('--so-instalador');

  if (!soInstalador) {
    baixar();
    fs.rmSync(MONTAGEM, { recursive: true, force: true });
    montarApp();
    montarNode();
    montarPython();
    montarFfmpeg();
    montarModelo();
    montarLancador();
    console.log('\n   montagem: ' + Math.round(tamanho(MONTAGEM) / 1048576) + ' MB');
  }

  if (soMontar) return;
  compilarInstalador();
  const exe = path.join(DIST, 'Instalar-Cortador-Automatico.exe');
  console.log('\nPronto: ' + exe + ' (' + Math.round(fs.statSync(exe).size / 1048576) + ' MB)');
}

try {
  main();
} catch (e) {
  console.error('\nERRO: ' + e.message);
  process.exit(1);
}
