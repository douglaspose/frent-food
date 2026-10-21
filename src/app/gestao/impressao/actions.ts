"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigirPermissao } from "@/lib/session";
import { enfileirar } from "@/lib/fila-impressao";
import { centro, linha } from "@/lib/impressao";
import { emResultado, ErroDeOperacao } from "@/lib/erro-de-operacao";
import { conferirUnidade } from "@/lib/da-unidade";
import { conexaoValida, conferirEndereco, precisaEndereco } from "@/lib/impressoras";

/**
 * A credencial da unidade, nova.
 *
 * Pede `unidade.configurar`, e não `produto.editar` como o resto desta tela:
 * é a mesma credencial que o cadastro de aparelhos trata com essa régua, e
 * gerá-la de novo **derruba todos os aparelhos da casa de uma vez** — o agente
 * do balcão inclusive. Reimprimir e descartar papel continuam sendo de quem
 * opera a fila.
 */
export async function gerarTokenImpressao() {
  return emResultado(async () => {
    const sessao = await exigirPermissao("unidade.configurar");

    const token = randomBytes(24).toString("base64url");
    await db.unidade.update({ where: { id: sessao.unidadeId }, data: { tokenImpressao: token } });

    revalidatePath("/gestao/impressao");
    return token;
  });
}

export type DadosImpressora = {
  nome: string;
  conexao: string;
  endereco: string;
  modelo: string;
};

/**
 * O cadastro conferido, antes de virar linha.
 *
 * Nome é o que a cozinha vai ler na tela; o endereço é o que o agente vai
 * discursar. Conexão que não é uma das três não entra: a fila guardaria uma
 * impressora que agente nenhum sabe alcançar, e o papel ficaria pendente para
 * sempre sem ninguém saber por quê.
 */
function conferirCadastro(dados: DadosImpressora) {
  const nome = dados.nome.trim();
  if (!nome) throw new ErroDeOperacao("Dê um nome à impressora — é o que a cozinha vai ler.");
  if (!conexaoValida(dados.conexao)) throw new ErroDeOperacao("Escolha como o agente chega nela.");

  let endereco: string | null = null;
  if (precisaEndereco(dados.conexao)) {
    const r = conferirEndereco(dados.endereco);
    if ("erro" in r) throw new ErroDeOperacao(r.erro);
    endereco = r.endereco;
  }

  return { nome, conexao: dados.conexao, endereco, modelo: dados.modelo.trim() || null };
}

/** A impressora, se for desta unidade. */
async function impressoraDaUnidade(
  id: string,
  sessao: { tenantId: string; unidadeId: string }
) {
  const impressora = await db.impressora.findUnique({ where: { id } });
  if (!impressora) throw new ErroDeOperacao("Impressora não encontrada.");
  // O id vem do navegador, e chave estrangeira ignora o RLS: sem isto, a
  // matriz renomeava e cortava a térmica da filial.
  conferirUnidade(impressora, sessao, "Impressora");
  return impressora;
}

/**
 * Cadastra uma impressora da casa.
 *
 * Pede `unidade.configurar`, como o resto do que é infraestrutura (aparelhos,
 * credencial da unidade, ajustes): é decisão de quem responde pela casa, não
 * de quem opera a fila no turno.
 */
export async function cadastrarImpressora(dados: DadosImpressora) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("unidade.configurar");
    const limpo = conferirCadastro(dados);

    const criada = await db.impressora.create({
      data: { tenantId: sessao.tenantId, unidadeId: sessao.unidadeId, ...limpo },
    });

    revalidatePath("/gestao/impressao");
    return { id: criada.id };
  });
}

export async function atualizarImpressora(id: string, dados: DadosImpressora) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("unidade.configurar");
    await impressoraDaUnidade(id, sessao);
    const limpo = conferirCadastro(dados);

    await db.impressora.update({ where: { id }, data: limpo });
    revalidatePath("/gestao/impressao");
  });
}

/**
 * Desliga ou religa a impressora.
 *
 * Desligada, ela sai da conta que decide se o papel "da mão" pode sair na
 * bobina da maquininha (`GET /api/impressao`) — é como a casa diz "esta
 * térmica está na assistência" sem perder o cadastro nem desfazer os vínculos
 * das praças.
 */
export async function alternarImpressoraAtiva(id: string, ativo: boolean) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("unidade.configurar");
    await impressoraDaUnidade(id, sessao);

    await db.impressora.update({ where: { id }, data: { ativo } });
    revalidatePath("/gestao/impressao");
  });
}

/**
 * Apaga o cadastro, se não houver nada pendurado nele.
 *
 * Praça ligada e papel na fila apontam para esta linha: apagar levaria o
 * banco a recusar a exclusão com erro de chave estrangeira, que chega à tela
 * como falha de sistema. A recusa aqui diz o que desfazer primeiro — e desligar
 * costuma ser o que a casa realmente queria.
 */
export async function excluirImpressora(id: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("unidade.configurar");
    await impressoraDaUnidade(id, sessao);

    const pracas = await db.estacao.count({ where: { impressoraId: id } });
    if (pracas > 0) {
      throw new ErroDeOperacao(
        `Esta impressora atende ${pracas} praça(s). Troque a impressora delas antes de apagar — ou desligue-a.`
      );
    }
    const papeis = await db.filaImpressao.count({ where: { impressoraId: id } });
    if (papeis > 0) {
      throw new ErroDeOperacao(
        "Há papel na fila endereçado a ela. Desligue-a: o histórico da fila precisa do cadastro para dizer onde cada papel saiu."
      );
    }

    await db.impressora.delete({ where: { id } });
    revalidatePath("/gestao/impressao");
  });
}

/**
 * Liga uma praça à impressora dela — ou a desliga de todas.
 *
 * É o vínculo que faz a comanda da cozinha sair na térmica da cozinha. Sem
 * ele, o papel vai "na mão": sai em qualquer agente que buscar a fila,
 * inclusive na bobina da maquininha no bolso do garçom.
 */
export async function ligarPracaNaImpressora(estacaoId: string, impressoraId: string | null) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("unidade.configurar");

    const estacao = await db.estacao.findUnique({ where: { id: estacaoId } });
    if (!estacao) throw new ErroDeOperacao("Praça não encontrada.");
    conferirUnidade(estacao, sessao, "Praça");

    // A impressora também: ligar a praça da matriz na térmica da filial faria
    // a comanda daqui sair na outra cidade.
    if (impressoraId) await impressoraDaUnidade(impressoraId, sessao);

    await db.estacao.update({ where: { id: estacaoId }, data: { impressoraId } });
    revalidatePath("/gestao/impressao");
  });
}

/** Reimprime enfileirando de novo, sem mexer no registro original. */
export async function reimprimir(filaId: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("produto.editar");

    const original = await db.filaImpressao.findUnique({ where: { id: filaId } });
    if (!original) throw new ErroDeOperacao("Não encontrado.");
    /*
     * A fila é por unidade, e o RLS é por restaurante: o papel da filial
     * existe para a sessão da matriz. Reimprimir enfileira de novo na unidade
     * de **origem** — o papel sairia na outra cidade, de madrugada, sem
     * ninguém de lá ter pedido.
     */
    conferirUnidade(original, sessao, "Papel");

    await enfileirar({
      tenantId: original.tenantId,
      unidadeId: original.unidadeId,
      impressoraId: original.impressoraId,
      tipo: original.tipo,
      titulo: `${original.titulo} (2ª via)`,
      conteudo: original.conteudo,
      referenciaId: original.referenciaId ?? undefined,
    });

    revalidatePath("/gestao/impressao");
  });
}

/** Marca como resolvido sem imprimir — para limpar fila de impressora removida. */
export async function descartar(filaId: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("produto.editar");

    const trabalho = await db.filaImpressao.findUnique({ where: { id: filaId } });
    if (!trabalho) throw new ErroDeOperacao("Não encontrado.");
    // Descartar daqui apagaria da fila de lá um papel que ninguém de lá
    // resolveu — e a praça continuaria esperando o prato.
    conferirUnidade(trabalho, sessao, "Papel");

    await db.filaImpressao.update({
      where: { id: filaId },
      data: { status: "ERRO", erro: "descartado manualmente" },
    });

    revalidatePath("/gestao/impressao");
  });
}

export async function imprimirTeste() {
  return emResultado(async () => {
    const sessao = await exigirPermissao("produto.editar");

    const conteudo = [
      linha("="),
      centro("TESTE DE IMPRESSAO"),
      linha("="),
      `Unidade: ${sessao.unidadeId}`,
      `Emitido por: ${sessao.nome}`,
      `Em: ${new Date().toLocaleString("pt-BR")}`,
      linha(),
      "Acentuacao: aeiou ACENTO ção não",
      "0123456789 ABCDEFGHIJ abcdefghij",
      // 48 colunas cheias: se a régua sair quebrada, a impressora não está em 80mm.
      linha("."),
      "",
      centro("Se voce esta lendo isto, funcionou."),
      linha("="),
    ].join("\n");

    await enfileirar({
      tenantId: sessao.tenantId,
      unidadeId: sessao.unidadeId,
      tipo: "CONFERENCIA",
      titulo: "Teste de impressão",
      conteudo,
    });

    revalidatePath("/gestao/impressao");
  });
}
