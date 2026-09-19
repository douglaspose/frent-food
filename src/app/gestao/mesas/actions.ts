"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigirPermissao } from "@/lib/session";
import { emResultado, ErroDeOperacao } from "@/lib/erro-de-operacao";

const PERMISSAO = "produto.editar";

/** Token do QR fixo da mesa. Aleatório: é a única credencial da página pública. */
function novoToken() {
  return randomBytes(12).toString("base64url");
}

function revalidar() {
  revalidatePath("/gestao/mesas");
  revalidatePath("/pdv");
}

// ─────────────────────────── Áreas ───────────────────────────

export async function criarArea(nome: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    if (!nome.trim()) throw new ErroDeOperacao("Informe o nome da área.");

    const ultima = await db.area.findFirst({
      where: { unidadeId: sessao.unidadeId },
      orderBy: { ordem: "desc" },
      select: { ordem: true },
    });

    await db.area.create({
      data: {
        tenantId: sessao.tenantId,
        unidadeId: sessao.unidadeId,
        nome: nome.trim().toUpperCase(),
        ordem: (ultima?.ordem ?? 0) + 1,
      },
    });

    revalidar();
  });
}

async function areaDaUnidade(areaId: string, unidadeId: string) {
  const area = await db.area.findUnique({ where: { id: areaId } });
  if (!area || area.unidadeId !== unidadeId) throw new ErroDeOperacao("Área não encontrada.");
  return area;
}

export async function renomearArea(areaId: string, nome: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    if (!nome.trim()) throw new ErroDeOperacao("Informe o nome da área.");

    await areaDaUnidade(areaId, sessao.unidadeId);
    await db.area.update({ where: { id: areaId }, data: { nome: nome.trim().toUpperCase() } });
    revalidar();
  });
}

export async function moverArea(areaId: string, direcao: -1 | 1) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    const area = await areaDaUnidade(areaId, sessao.unidadeId);

    // Troca de posição com a vizinha — é o que o usuário espera de "subir".
    const vizinha = await db.area.findFirst({
      where: {
        unidadeId: sessao.unidadeId,
        ordem: direcao === -1 ? { lt: area.ordem } : { gt: area.ordem },
      },
      orderBy: { ordem: direcao === -1 ? "desc" : "asc" },
    });
    if (!vizinha) return;

    await db.$transaction([
      db.area.update({ where: { id: area.id }, data: { ordem: vizinha.ordem } }),
      db.area.update({ where: { id: vizinha.id }, data: { ordem: area.ordem } }),
    ]);

    revalidar();
  });
}

export async function alternarAreaAtiva(areaId: string, ativo: boolean) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    await areaDaUnidade(areaId, sessao.unidadeId);

    if (!ativo) {
      const ocupadas = await db.mesa.count({
        where: { areaId, status: { not: "LIVRE" } },
      });
      // Desativar uma área com mesa ocupada sumiria com a comanda do mapa.
      if (ocupadas > 0) {
        throw new ErroDeOperacao(`A área tem ${ocupadas} mesa(s) ocupada(s). Feche as contas antes.`);
      }
    }

    await db.area.update({ where: { id: areaId }, data: { ativo } });
    revalidar();
  });
}

// ─────────────────────────── Mesas ───────────────────────────

/**
 * Cria uma faixa de mesas de uma vez.
 *
 * É assim que um restaurante configura no primeiro dia: "mesas 1 a 40 no
 * salão". Cadastrar quarenta mesas uma a uma faria qualquer dono desistir
 * antes de terminar.
 */
export async function criarMesasEmLote(dados: {
  areaId: string;
  de: number;
  ate: number;
  capacidade: number;
}) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    await areaDaUnidade(dados.areaId, sessao.unidadeId);

    if (!Number.isInteger(dados.de) || !Number.isInteger(dados.ate) || dados.de < 1) {
      throw new ErroDeOperacao("Informe uma faixa válida de números.");
    }
    if (dados.ate < dados.de) throw new ErroDeOperacao("O número final deve ser maior que o inicial.");
    if (dados.ate - dados.de + 1 > 200) throw new ErroDeOperacao("Crie no máximo 200 mesas por vez.");

    const numeros = Array.from({ length: dados.ate - dados.de + 1 }, (_, i) => String(dados.de + i));

    // Número de mesa é único por unidade: pular os que já existem evita estourar
    // a criação inteira por causa de uma mesa repetida no meio da faixa.
    const existentes = await db.mesa.findMany({
      where: { unidadeId: sessao.unidadeId, numero: { in: numeros } },
      select: { numero: true },
    });
    const jaExiste = new Set(existentes.map((m) => m.numero));
    const novos = numeros.filter((n) => !jaExiste.has(n));

    if (novos.length > 0) {
      await db.mesa.createMany({
        data: novos.map((numero) => ({
          tenantId: sessao.tenantId,
          unidadeId: sessao.unidadeId,
          areaId: dados.areaId,
          numero,
          capacidade: dados.capacidade,
          qrToken: novoToken(),
        })),
      });
    }

    revalidar();
    return { criadas: novos.length, ignoradas: jaExiste.size };
  });
}

async function mesaDaUnidade(mesaId: string, unidadeId: string) {
  const mesa = await db.mesa.findUnique({ where: { id: mesaId } });
  if (!mesa || mesa.unidadeId !== unidadeId) throw new ErroDeOperacao("Mesa não encontrada.");
  return mesa;
}

export async function atualizarMesa(dados: {
  mesaId: string;
  numero: string;
  capacidade: number;
  areaId: string;
}) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    await mesaDaUnidade(dados.mesaId, sessao.unidadeId);
    if (!dados.numero.trim()) throw new ErroDeOperacao("Informe o número da mesa.");

    const repetida = await db.mesa.findFirst({
      where: {
        unidadeId: sessao.unidadeId,
        numero: dados.numero.trim(),
        id: { not: dados.mesaId },
      },
    });
    if (repetida) throw new ErroDeOperacao(`Já existe a mesa ${dados.numero.trim()}.`);

    await db.mesa.update({
      where: { id: dados.mesaId },
      data: {
        numero: dados.numero.trim(),
        capacidade: dados.capacidade,
        areaId: dados.areaId || null,
      },
    });

    revalidar();
  });
}

export async function alternarMesaAtiva(mesaId: string, ativo: boolean) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    const mesa = await mesaDaUnidade(mesaId, sessao.unidadeId);

    if (!ativo && mesa.status !== "LIVRE") {
      throw new ErroDeOperacao("A mesa está ocupada. Feche a conta antes de desativá-la.");
    }

    await db.mesa.update({ where: { id: mesaId }, data: { ativo } });
    revalidar();
  });
}

/**
 * Exclui de vez — só quando a mesa nunca foi usada.
 *
 * Mesa com comanda no histórico vira registro de venda e relatório; apagar
 * quebraria o passado. Nesse caso o caminho é desativar.
 */
export async function excluirMesa(mesaId: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    await mesaDaUnidade(mesaId, sessao.unidadeId);

    const comandas = await db.comanda.count({ where: { mesaId } });
    if (comandas > 0) {
      throw new ErroDeOperacao(
        `Esta mesa já teve ${comandas} comanda(s) e faz parte do histórico. Desative em vez de excluir.`
      );
    }

    await db.mesa.delete({ where: { id: mesaId } });
    revalidar();
  });
}

/** Gera um QR novo — usar quando o adesivo da mesa for parar em outro lugar. */
export async function regerarQrToken(mesaId: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    await mesaDaUnidade(mesaId, sessao.unidadeId);

    await db.mesa.update({ where: { id: mesaId }, data: { qrToken: novoToken() } });
    revalidar();
    revalidatePath("/gestao/mesas/qrcodes");
  });
}

/** Preenche o QR das mesas que ainda não têm — caso de base antiga. */
export async function gerarQrFaltantes() {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);

    const semToken = await db.mesa.findMany({
      where: { unidadeId: sessao.unidadeId, qrToken: null },
      select: { id: true },
    });

    for (const mesa of semToken) {
      await db.mesa.update({ where: { id: mesa.id }, data: { qrToken: novoToken() } });
    }

    revalidar();
    revalidatePath("/gestao/mesas/qrcodes");
    return { geradas: semToken.length };
  });
}
