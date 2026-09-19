#!/usr/bin/env node
/**
 * Agente de impressão.
 *
 * Roda numa máquina DENTRO do restaurante — a mesma rede das impressoras. O
 * servidor nunca fala com a impressora: ele só enfileira, e este agente busca
 * o que está pendente e manda imprimir. É o que permite o sistema ficar na
 * nuvem sem abrir a rede do restaurante para a internet.
 *
 * Uso:
 *   API_URL=https://seu.dominio.com.br TOKEN=xxxx node agente.mjs
 *
 * Variáveis opcionais:
 *   INTERVALO_MS  entre buscas (padrão 3000)
 *   PASTA_SAIDA   grava os papéis em arquivo em vez de imprimir (para testar)
 */

import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const TOKEN = process.env.TOKEN;
const INTERVALO_MS = Number(process.env.INTERVALO_MS ?? 3000);
const PASTA_SAIDA = process.env.PASTA_SAIDA;
const PORTA_PADRAO = 9100; // porta RAW/JetDirect, o que quase toda térmica de rede usa

if (!TOKEN) {
  console.error("Defina TOKEN com o token de impressão da unidade.");
  process.exit(1);
}

const ESC = "\x1b";
const GS = "\x1d";

/**
 * Monta um QR Code em ESC/POS.
 *
 * O DANFE da NFC-e é obrigado a trazer o QR Code impresso: é por ele que o
 * consumidor confere a nota na SEFAZ. Texto não serve — tem que ser o código
 * de verdade.
 */
function qrCodeEscPos(conteudo) {
  const dados = Buffer.from(conteudo, "ascii");
  const tamanho = dados.length + 3;

  return Buffer.concat([
    Buffer.from(`${ESC}a\x01`, "ascii"), // centraliza
    Buffer.from(`${GS}(k\x04\x00\x31\x41\x32\x00`, "ascii"), // modelo 2
    Buffer.from(`${GS}(k\x03\x00\x31\x43\x06`, "ascii"), // tamanho do módulo
    Buffer.from(`${GS}(k\x03\x00\x31\x45\x31`, "ascii"), // correção de erro M
    Buffer.from([0x1d, 0x28, 0x6b, tamanho & 0xff, (tamanho >> 8) & 0xff, 0x31, 0x50, 0x30]),
    dados,
    Buffer.from(`${GS}(k\x03\x00\x31\x51\x30`, "ascii"), // imprime
    Buffer.from(`${ESC}a\x00`, "ascii"), // volta ao alinhamento à esquerda
  ]);
}

/** Envolve o texto nos comandos ESC/POS: inicializa, imprime, corta. */
function paraEscPos(texto) {
  const partes = [
    Buffer.from(`${ESC}@`, "ascii"), // reset
    // CP850 cobre os acentos do português nas térmicas mais comuns.
    Buffer.from(`${ESC}t\x02`, "ascii"),
  ];

  // O servidor marca onde o QR entra; o desenho é feito aqui, na impressora.
  for (const bloco of texto.split(/(\[\[QRCODE:[^\]]+\]\])/)) {
    const qr = bloco.match(/^\[\[QRCODE:(.+)\]\]$/);
    if (qr) partes.push(qrCodeEscPos(qr[1]));
    else if (bloco) partes.push(Buffer.from(bloco.replace(/\n/g, "\r\n"), "latin1"));
  }

  partes.push(
    Buffer.from("\r\n\r\n\r\n\r\n", "ascii"), // avanço para a serrilha
    Buffer.from(`${GS}V\x41\x03`, "ascii") // corte parcial
  );

  return Buffer.concat(partes);
}

function imprimirNaRede(endereco, dados) {
  return new Promise((resolve, reject) => {
    const [host, porta] = endereco.split(":");
    const socket = net.createConnection(
      { host, port: Number(porta) || PORTA_PADRAO, timeout: 8000 },
      () => socket.end(dados)
    );
    socket.on("close", resolve);
    socket.on("timeout", () => socket.destroy(new Error("tempo esgotado")));
    socket.on("error", reject);
  });
}

async function imprimir(trabalho) {
  const dados = paraEscPos(trabalho.conteudo);

  if (PASTA_SAIDA) {
    await fs.mkdir(PASTA_SAIDA, { recursive: true });
    const arquivo = path.join(PASTA_SAIDA, `${trabalho.id}.txt`);
    await fs.writeFile(arquivo, trabalho.conteudo, "utf8");
    console.log(`  → gravado em ${arquivo}`);
    return;
  }

  if (!trabalho.impressora?.endereco) {
    throw new Error(`sem impressora configurada para "${trabalho.titulo}"`);
  }
  await imprimirNaRede(trabalho.impressora.endereco, dados);
}

async function confirmar(id, ok, erro) {
  await fetch(`${API_URL}/api/impressao`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ id, ok, erro }),
  });
}

let avisouQueda = false;

async function rodada() {
  const resposta = await fetch(`${API_URL}/api/impressao`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });

  if (!resposta.ok) {
    throw new Error(`servidor respondeu ${resposta.status}`);
  }

  const { trabalhos } = await resposta.json();
  for (const trabalho of trabalhos) {
    console.log(`[${new Date().toLocaleTimeString("pt-BR")}] ${trabalho.titulo}`);
    try {
      await imprimir(trabalho);
      await confirmar(trabalho.id, true);
    } catch (e) {
      console.error(`  ✗ ${e.message}`);
      // Reporta a falha e segue: um papel preso não pode travar os outros.
      await confirmar(trabalho.id, false, e.message);
    }
  }
}

console.log(`Agente de impressão · ${API_URL}`);
console.log(PASTA_SAIDA ? `Modo teste: gravando em ${PASTA_SAIDA}` : "Imprimindo via rede (porta 9100)");

for (;;) {
  try {
    await rodada();
    if (avisouQueda) {
      console.log("Conexão com o servidor restabelecida.");
      avisouQueda = false;
    }
  } catch (e) {
    // Internet cai o tempo todo em restaurante: avisa uma vez e continua
    // tentando, em vez de encher o log e morrer.
    if (!avisouQueda) {
      console.error(`Sem contato com o servidor (${e.message}). Continuando a tentar...`);
      avisouQueda = true;
    }
  }
  await new Promise((r) => setTimeout(r, INTERVALO_MS));
}
