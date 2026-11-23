'use strict';
/**
 * Quanto do processador o programa usa: "leve" ou "total".
 *
 * Total: transcricao e corte usam quase todos os nucleos - mais rapido, mas o
 * PC trabalha no maximo (PC fraco ou mal ventilado esquenta e pode desligar).
 * Leve: metade dos nucleos e prioridade baixa - demora mais, o PC esquenta bem
 * menos e continua usavel enquanto gera os cortes.
 *
 * A escolha fica no config.json (o mesmo da pasta de salvar) e vale na hora.
 * A gravacao da live NUNCA fica com prioridade baixa: perder pedaco da live e pior.
 */

const os = require('os');
const pastas = require('./pastas');

const MODOS = ['leve', 'total'];

/** O que a pessoa escolheu, ou null se ainda nao escolheu (primeira vez). */
function escolhido() {
  const m = pastas.lerConfig().desempenho;
  return MODOS.includes(m) ? m : null;
}

/** O modo que vale agora (sem escolha ainda: o recomendado pro PC). */
function modo() {
  return escolhido() || recomendado();
}

function definir(m) {
  if (!MODOS.includes(m)) throw new Error('Modo invalido.');
  const cfg = pastas.lerConfig();
  cfg.desempenho = m;
  pastas.gravarConfig(cfg);
  return m;
}

/**
 * O Windows mostra um pouco menos de RAM do que o pente tem (a placa de video
 * integrada reserva uma parte): 16 GB aparecem como 15,4. Mostra o tamanho do pente.
 */
function ramDoPente(gb) {
  const tamanhos = [2, 3, 4, 6, 8, 12, 16, 20, 24, 32, 48, 64, 96, 128];
  return tamanhos.find((t) => gb <= t && gb >= t * 0.85) || Math.round(gb);
}

/** O PC da pessoa, pra mostrar na tela e recomendar. */
function pc() {
  const cpus = os.cpus() || [];
  return {
    nucleos: cpus.length || 1,
    ramGb: ramDoPente(os.totalmem() / 1073741824),
    processador: String((cpus[0] && cpus[0].model) || '').replace(/\s+/g, ' ').replace(/\(R\)|\(TM\)|CPU|@.*$/gi, '').trim(),
  };
}

/**
 * Leve pra PC com menos de 12 GB de RAM ou ate 4 nucleos (threads); total pro resto.
 */
function recomendado() {
  const p = pc();
  return p.ramGb < 12 || p.nucleos <= 4 ? 'leve' : 'total';
}

/** Quantos nucleos a transcricao e o corte podem usar. */
function nucleos() {
  const n = pc().nucleos;
  return modo() === 'leve' ? Math.max(1, Math.floor(n / 2)) : Math.max(1, n - 2);
}

/** No modo leve, o processo roda com prioridade baixa (o resto do PC passa na frente). */
function aliviar(proc) {
  if (modo() !== 'leve' || !proc || !proc.pid) return;
  try { os.setPriority(proc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (_) { /* processo ja terminou */ }
}

/** Pro ffmpeg que recodifica (libx264): no modo leve, limita os nucleos. */
function argsDoFfmpeg(args) {
  if (modo() !== 'leve') return args;
  const i = args.indexOf('libx264');
  if (i < 0 || args.includes('-threads')) return args;
  const novo = args.slice();
  novo.splice(i + 1, 0, '-threads', String(nucleos()));
  return novo;
}

// ---------------------------------------------------------------- placa de video
//
// Gerar o corte (recodificar o video) e a parte pesada do fim. A placa de video
// faz isso bem mais rapido que o processador: NVIDIA (NVENC), AMD (AMF) ou Intel
// (Quick Sync). Ja a transcricao (faster-whisper) pode rodar em CUDA em qualquer
// GPU NVIDIA compativel - mesmo em placas sem NVENC.

const PLACAS = [
  { encoder: 'h264_nvenc', nome: 'NVIDIA', sigla: 'NVENC' },
  { encoder: 'h264_amf', nome: 'AMD', sigla: 'AMF' },
  { encoder: 'h264_qsv', nome: 'Intel', sigla: 'QSV' },
];
let placaAchada; // undefined = ainda nao testou; null = nenhuma funcionou
let testando = null;
let placaQuebrou = false; // falhou num corte de verdade: volta pro processador ate fechar

let cudaAchada; // undefined = ainda nao testou; null = sem CUDA utilizavel; { nome, computeType }
let testandoCuda = null;
let gpuNome = null; // preenchido rapido pelo nvidia-smi (~100ms) antes dos testes terminarem

/** Testa de verdade (um video de meio segundo) qual placa o ffmpeg consegue usar. */
function detectarPlaca(ffmpeg) {
  if (placaAchada !== undefined) return Promise.resolve(placaAchada);
  if (!ffmpeg) { placaAchada = null; return Promise.resolve(null); }
  if (testando) return testando;
  const { spawn } = require('child_process');
  const testar = (p) => new Promise((ok) => {
    let proc;
    try {
      proc = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=30:d=0.5',
        '-c:v', p.encoder, '-pix_fmt', p.encoder === 'h264_qsv' ? 'nv12' : 'yuv420p', '-f', 'null', '-'], { windowsHide: true });
    } catch (_) { return ok(false); }
    const relogio = setTimeout(() => { try { proc.kill(); } catch (_) {} ok(false); }, 6000);
    proc.on('error', () => { clearTimeout(relogio); ok(false); });
    proc.on('close', (code) => { clearTimeout(relogio); ok(code === 0); });
  });
  testando = (async () => {
    try {
      // Testa NVENC, AMF e QSV em paralelo e escolhe o primeiro disponivel na
      // ordem de prioridade (NVIDIA > AMD > Intel). Assim o programa aproveita
      // todos os recursos disponiveis: CUDA + NVENC, CUDA + QSV/AMF, ou apenas
      // o que estiver disponivel na maquina, mantendo o restante na CPU.
      const resultados = await Promise.all(PLACAS.map((p) => testar(p)));
      const idx = resultados.indexOf(true);
      if (idx >= 0) { placaAchada = PLACAS[idx]; return placaAchada; }
    } catch (_) {}
    placaAchada = null;
    return null;
  })();
  return testando;
}

/** Nome da GPU NVIDIA via nvidia-smi (ex.: "NVIDIA GeForce GTX 1070"), ou null se nao houver. */
function nomeGpuNvidia() {
  const { spawn } = require('child_process');
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn('nvidia-smi', ['--query-gpu=name,compute_cap', '--format=csv,noheader'], { windowsHide: true });
    } catch (_) { return resolve(null); }
    let out = '';
    const relogio = setTimeout(() => { try { proc.kill(); } catch (_) {} resolve(null); }, 5000);
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (d) => { out += d; });
    proc.on('error', () => { clearTimeout(relogio); resolve(null); });
    proc.on('close', (code) => {
      clearTimeout(relogio);
      if (code !== 0) return resolve(null);
      const linha = out.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
      if (!linha) return resolve(null);
      const partes = linha.split(',').map((s) => s.trim());
      resolve(partes[0] || 'NVIDIA');
    });
  });
}

/** Testa de verdade se o ctranslate2 (faster-whisper) consegue usar CUDA nesta maquina. */
function detectarCuda(pythonBin) {
  if (cudaAchada !== undefined) return Promise.resolve(cudaAchada);
  if (testandoCuda) return testandoCuda;
  const path = require('path');
  const { spawn } = require('child_process');
  const script = path.join(__dirname, '..', 'py', 'transcrever.py');

  testandoCuda = (async () => {
    try {
      const nome = await nomeGpuNvidia();
      if (nome) gpuNome = nome;
      if (!nome || !pythonBin) { cudaAchada = null; return null; }
      const res = await new Promise((resolve) => {
        let proc;
        try {
          proc = spawn(pythonBin, [script, '--testar-cuda'], { windowsHide: true });
        } catch (_) { return resolve(null); }
        let out = '';
        const relogio = setTimeout(() => { try { proc.kill(); } catch (_) {} resolve(null); }, 20000);
        proc.stdout.setEncoding('utf8');
        proc.stdout.on('data', (d) => { out += d; });
        proc.on('error', () => { clearTimeout(relogio); resolve(null); });
        proc.on('close', (code) => {
          clearTimeout(relogio);
          if (code !== 0) return resolve(null);
          try {
            const linha = out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('{')).pop();
            resolve(linha ? JSON.parse(linha) : null);
          } catch (_) { resolve(null); }
        });
      });
      if (res && res.cuda) {
        cudaAchada = { nome, computeType: res.compute_type || 'float32' };
        return cudaAchada;
      }
    } catch (_) {}
    cudaAchada = null;
    return null;
  })();
  return testandoCuda;
}

function placaLigada() { return !!pastas.lerConfig().placaVideo; }
function usarCudaNaTranscricao() { return placaLigada() && !!cudaAchada; }
function definirPlaca(ligada) {
  const cfg = pastas.lerConfig();
  cfg.placaVideo = !!ligada;
  pastas.gravarConfig(cfg);
  placaQuebrou = false;
  return cfg.placaVideo;
}
function marcarPlacaQuebrada() { placaQuebrou = true; }

/** Troca o libx264 pelo encoder da placa, mantendo a mesma qualidade (crf). */
function paraPlaca(args) {
  const p = placaAchada;
  const i = args.indexOf('libx264');
  if (!p || i < 1 || args[i - 1] !== '-c:v') return null;
  const tirar = new Set(['-preset', '-crf', '-profile:v', '-level', '-x264-params', '-tune', '-threads']);
  const crfIdx = args.indexOf('-crf');
  const crf = crfIdx >= 0 ? String(args[crfIdx + 1]) : '20';
  const novo = [];
  for (let k = 0; k < args.length; k++) {
    if (tirar.has(args[k])) { k++; continue; }
    if (k === i - 1) continue; // o '-c:v' antigo
    if (k === i) {
      if (p.encoder === 'h264_nvenc') novo.push('-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', crf, '-b:v', '0', '-profile:v', 'high');
      else if (p.encoder === 'h264_amf') { const qp = String(Number(crf) + 3); novo.push('-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', qp, '-qp_p', qp, '-qp_b', qp); }
      else novo.push('-c:v', 'h264_qsv', '-global_quality', crf, '-preset', 'medium');
      continue;
    }
    novo.push(args[k]);
  }
  if (p.encoder === 'h264_qsv') { const f = novo.indexOf('-pix_fmt'); if (f >= 0) novo[f + 1] = 'nv12'; }
  return novo;
}

/**
 * Os argumentos do ffmpeg ja ajustados: placa de video (se ligada e funcionando)
 * ou o processador com o modo leve/total. placa=true avisa quem chama que, se
 * der erro, vale tentar de novo no processador.
 */
function adaptarFfmpeg(args) {
  if (placaLigada() && !placaQuebrou && placaAchada) {
    const naPlaca = paraPlaca(args);
    if (naPlaca) return { args: naPlaca, placa: true };
  }
  return { args: argsDoFfmpeg(args), placa: false };
}

function resumo() {
  return {
    modo: modo(), escolhido: escolhido(), recomendado: recomendado(), pc: pc(),
    placa: {
      ligada: placaLigada(),
      achada: placaAchada === undefined ? 'testando' : (placaAchada ? placaAchada.nome : null),
      sigla: placaAchada ? placaAchada.sigla : null,
      quebrou: placaQuebrou,
      gpu: gpuNome,
      cuda: cudaAchada === undefined ? 'testando' : (cudaAchada ? cudaAchada.nome : null),
      computeType: cudaAchada ? cudaAchada.computeType : null,
    },
  };
}

module.exports = {
  modo, escolhido, definir, pc, recomendado, nucleos, aliviar, argsDoFfmpeg,
  adaptarFfmpeg, detectarPlaca, detectarCuda, usarCudaNaTranscricao, definirPlaca, marcarPlacaQuebrada, resumo,
};
