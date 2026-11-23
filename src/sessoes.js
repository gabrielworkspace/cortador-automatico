'use strict';
/**
 * O perfil de corte do programa. Hoje e um so, geral: corta live de Kick,
 * Twitch e YouTube (gravada ou ao vivo) e qualquer video. O vocabulario de
 * games - GTA inclusive - entra na nota so quando aparece na fala.
 *
 * A versao antiga, com as sessoes de canal e de campeonato, ficou guardada no
 * git (tag versao-lucas-jamble). Pra voltar pra ela:
 *   git checkout versao-lucas-jamble
 *
 * O resto do codigo continua perguntando "qual sessao?" porque assim um perfil
 * novo entra aqui sem mexer no pipeline. Os lexicos de nota ficam no score.js
 * e os de titulo/hashtag no copy.js, chaveados pelo id.
 */

const path = require('path');

const SESSOES = {
  padrao: {
    id: 'padrao',
    nome: 'AUTOCORTES Z',
    descricao: 'Cortes de live e vídeo · Kick, Twitch e YouTube',
    pasta: 'cortes',
    // Live de jogo quase sempre e webcam + gameplay: o rosto em cima e o jogo
    // embaixo e o formato que mais segura no feed.
    formatoPadrao: 'split',
  },
};

const PADRAO = SESSOES.padrao;

/** O perfil pelo id. Qualquer id desconhecido (projeto antigo) cai no padrao. */
function pegar(id) {
  return SESSOES[id] || PADRAO;
}

/** Onde os projetos do perfil ficam, dentro da pasta de saida. */
function pastaDeSaida(sessao, saida) {
  return sessao.pasta ? path.join(saida, sessao.pasta) : saida;
}

/** O que a janela precisa saber - sem caminho do disco. */
function paraJanela() {
  return Object.values(SESSOES).map((s) => ({
    id: s.id,
    nome: s.nome,
    descricao: s.descricao,
    formatoPadrao: s.formatoPadrao || null,
  }));
}

module.exports = { SESSOES, pegar, pastaDeSaida, paraJanela };
