"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigirPermissao } from "@/lib/session";
import { publicar } from "@/lib/eventos";
import { ajusteBooleano } from "@/lib/parametros-servidor";
import { emResultado, ErroDeOperacao } from "@/lib/erro-de-operacao";
import { enviarCarrinho as enviarRodada } from "@/lib/carrinho";

export async function abrirComanda(mesaId: string, pessoas: number, nomeCliente?: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("comanda.abrir");

    // A mesma regra de `definirPessoas`: -3 pessoas abria a mesa e estragava
    // a divisão por pessoa na hora de pagar.
    if (!Number.isInteger(pessoas) || pessoas < 1 || pessoas > 99) {
      throw new ErroDeOperacao("Informe de 1 a 99 pessoas.");
    }

    /**
     * O nome vai para a comanda, para o mapa e para o papel da impressora.
     * Caractere de controle sai (o byte zero derrubava a action, e o resto
     * chegava à térmica como comando); e um nome tem tamanho de nome — cinco
     * mil caracteres eram gravados e impressos inteiros.
     */
    nomeCliente = nomeCliente?.replace(/[\x00-\x1f\x7f]/g, "").trim();
    if (nomeCliente && nomeCliente.length > 80) {
      throw new ErroDeOperacao("O nome do cliente vai até 80 caracteres.");
    }

    const mesa = await db.mesa.findUniqueOrThrow({
      where: { id: mesaId },
      include: { unidade: true },
    });
    // Um usuário de um restaurante não abre mesa em outro, nem trocando o id na URL.
    if (mesa.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Mesa de outro restaurante.");

    const jaAberta = await db.comanda.findFirst({
      where: { mesaId, status: { in: ["ABERTA", "FECHANDO"] } },
    });
    if (jaAberta) return { comandaId: jaAberta.id };

    if (!nomeCliente?.trim() && (await ajusteBooleano(mesa.unidadeId, "mesa.exigirIdentificacaoCliente"))) {
      throw new ErroDeOperacao("Esta unidade exige o nome do cliente para abrir a mesa.");
    }

    const comanda = await db.$transaction(async (tx) => {
      /**
       * Uma abertura por vez na unidade.
       *
       * O max+1 era lido fora da transação: no dia simulado de 180 comandas,
       * 50 de 222 aberturas falharam por número repetido, e dois garçons na
       * mesma mesa podiam abrir duas comandas. A trava da linha da unidade
       * (NO KEY UPDATE, que não bloqueia quem só referencia a unidade)
       * enfileira as aberturas; dentro dela, a mesa é conferida de novo e o
       * número lido é o último de verdade.
       */
      await tx.$queryRaw`SELECT id FROM unidades WHERE id = ${mesa.unidadeId} FOR NO KEY UPDATE`;

      const aberta = await tx.comanda.findFirst({
        where: { mesaId, status: { in: ["ABERTA", "FECHANDO"] } },
      });
      if (aberta) return aberta;

      const ultima = await tx.comanda.findFirst({
        where: { unidadeId: mesa.unidadeId },
        orderBy: { numero: "desc" },
        select: { numero: true },
      });

      const criada = await tx.comanda.create({
        data: {
          tenantId: mesa.tenantId,
          unidadeId: mesa.unidadeId,
          numero: (ultima?.numero ?? 0) + 1,
          origem: "MESA",
          mesaId: mesa.id,
          pessoas,
          nomeCliente: nomeCliente || null,
          taxaServicoPct: mesa.unidade.taxaServicoPct,
          abertaPorId: sessao.usuarioId,
        },
      });
      await tx.mesa.update({ where: { id: mesa.id }, data: { status: "OCUPADA" } });
      return criada;
    });

    revalidatePath("/pdv");
    await publicar(sessao.unidadeId, "mesa-aberta");
    return { comandaId: comanda.id };
  });
}

/**
 * Envia o carrinho para produção.
 *
 * Os itens já existem no banco com status PENDENTE — aqui eles são promovidos
 * a ENVIADO. Não se criam linhas novas: o que o garçom montou é exatamente o
 * que vai para a cozinha, mesmo que ele tenha trocado de tablet no meio.
 *
 * O envio gera um ticket por estação, não um por item: uma rodada com 3 espetos
 * e 2 cervejas vira um ticket na cozinha e um no bar.
 *
 * A regra em si mora em `@/lib/carrinho`, compartilhada com a maquininha: lá o
 * garçom lança pela porta `/api/maquininha`, aqui pelo navegador, e é a mesma
 * rodada indo para a mesma cozinha. O que sobra aqui é a sessão e a tela.
 */
export async function enviarCarrinho(comandaId: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("comanda.lancarItem");
    const enviados = await enviarRodada(sessao, comandaId);

    revalidatePath("/pdv");
    revalidatePath("/kds");
    return enviados;
  });
}

