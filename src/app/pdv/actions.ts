"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigirPermissao } from "@/lib/session";
import { enfileirarPedidos } from "@/lib/fila-impressao";
import { baixarVenda } from "@/lib/estoque";
import { publicar } from "@/lib/eventos";
import { ajusteBooleano } from "@/lib/parametros-servidor";
import { emResultado, ErroDeOperacao } from "@/lib/erro-de-operacao";

export async function abrirComanda(mesaId: string, pessoas: number, nomeCliente?: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("comanda.abrir");

    // A mesma regra de `definirPessoas`: -3 pessoas abria a mesa e estragava
    // a divisão por pessoa na hora de pagar.
    if (!Number.isInteger(pessoas) || pessoas < 1 || pessoas > 99) {
      throw new ErroDeOperacao("Informe de 1 a 99 pessoas.");
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
 */
export async function enviarCarrinho(comandaId: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("comanda.lancarItem");

    const comanda = await db.comanda.findUniqueOrThrow({ where: { id: comandaId } });
    if (comanda.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Comanda de outro restaurante.");
    if (comanda.status !== "ABERTA") throw new ErroDeOperacao("A comanda não está aberta.");

    const pedidosCriados: string[] = [];

    /**
     * Cozinha que não quer o toque a mais recebe o ticket já em preparo. Com a
     * confirmação ligada ele nasce em NA FILA e alguém assume o prato — é o que
     * separa "a cozinha viu" de "o pedido chegou".
     */
    const confirmaNaTela = await ajusteBooleano(comanda.unidadeId, "kds.confirmarPedidoNaTela");
    const statusInicial = confirmaNaTela ? "AGUARDANDO" : "EM_PREPARO";

    const pendentes = await db.$transaction(async (tx) => {
      /**
       * Um envio por vez na mesma comanda.
       *
       * O carrinho era lido fora da transação: dois toques em "enviar" liam os
       * mesmos itens pendentes, e a rodada ia duas vezes para a cozinha — dois
       * tickets e a baixa do estoque em dobro. Com a comanda travada, o
       * segundo toque espera o primeiro e encontra o carrinho vazio.
       */
      await tx.$queryRaw`SELECT id FROM comandas WHERE id = ${comandaId} FOR UPDATE`;
      const atual = await tx.comanda.findUniqueOrThrow({ where: { id: comandaId }, select: { status: true } });
      if (atual.status !== "ABERTA") throw new ErroDeOperacao("A comanda não está aberta.");

      const pendentes = await tx.comandaItem.findMany({
        where: { comandaId, status: "PENDENTE" },
        select: { id: true, produtoId: true, quantidade: true },
      });
      if (pendentes.length === 0) return pendentes;

      const estacoesPorProduto = await tx.produtoEstacao.findMany({
        where: { produtoId: { in: pendentes.map((i) => i.produtoId) } },
      });
      const estacaoDoProduto = new Map(estacoesPorProduto.map((e) => [e.produtoId, e.estacaoId]));

      await tx.comandaItem.updateMany({
        where: { id: { in: pendentes.map((i) => i.id) } },
        // O item da comanda acompanha o ticket: o garçom vê "EM_PREPARO" na
        // tela da mesa sem a cozinha precisar tocar em nada.
        data: { status: confirmaNaTela ? "ENVIADO" : "EM_PREPARO", lancadoEm: new Date() },
      });

      // Agrupa os itens por estação de produção.
      const porEstacao = new Map<string, string[]>();
      for (const item of pendentes) {
        const estacaoId = estacaoDoProduto.get(item.produtoId);
        if (!estacaoId) continue; // produto sem estação não vai para produção
        porEstacao.set(estacaoId, [...(porEstacao.get(estacaoId) ?? []), item.id]);
      }

      // Dentro da transação: o item enviado e a baixa do estoque têm que nascer
      // juntos, senão o consumo fica sem contrapartida quando algo falhar.
      await baixarVenda(tx, {
        tenantId: comanda.tenantId,
        unidadeId: comanda.unidadeId,
        usuarioId: sessao.usuarioId,
        itens: pendentes.map((i) => ({
          produtoId: i.produtoId,
          quantidade: Number(i.quantidade),
          comandaItemId: i.id,
        })),
      });

      /**
       * A numeração dos tickets, por último e em fila.
       *
       * O max+1 corria solto: dois envios ao mesmo tempo liam o mesmo último
       * número, e no dia simulado 140 de 620 tickets repetiam número — o que a
       * cozinha grita e o que vai pendurado na chapa. A trava (consultiva, só
       * desta numeração) dura até o fim da transação; por isso este é o último
       * passo, depois da baixa do estoque, e segura a fila só pelos inserts.
       */
      await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`pedido:${comanda.unidadeId}`}))) AS trava`;
      const ultimo = await tx.pedido.findFirst({
        where: { unidadeId: comanda.unidadeId },
        orderBy: { numero: "desc" },
        select: { numero: true },
      });
      let numero = (ultimo?.numero ?? 0) + 1;

      for (const [estacaoId, itemIds] of porEstacao) {
        const pedido = await tx.pedido.create({
          data: {
            tenantId: comanda.tenantId,
            unidadeId: comanda.unidadeId,
            comandaId,
            estacaoId,
            numero: numero++,
            status: statusInicial,
            iniciadoEm: confirmaNaTela ? null : new Date(),
            itens: { create: itemIds.map((comandaItemId) => ({ comandaItemId })) },
          },
        });
        pedidosCriados.push(pedido.id);
      }
      return pendentes;
    });
    if (pendentes.length === 0) return { enviados: 0 };

    // Fora da transação: o pedido já está no KDS, e uma falha ao montar o papel
    // não pode desfazer o lançamento que a cozinha já está vendo.
    try {
      await enfileirarPedidos(pedidosCriados);
    } catch (e) {
      console.error("Falha ao enfileirar impressão dos pedidos", e);
    }

    revalidatePath("/pdv");
    revalidatePath("/kds");
    // O evento que mais importa: é ele que faz o ticket aparecer na cozinha sem
    // ninguém esperar o próximo ciclo.
    await publicar(sessao.unidadeId, "pedido-enviado");
    return { enviados: pendentes.length };
  });
}
