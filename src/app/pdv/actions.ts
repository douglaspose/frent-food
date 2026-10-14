"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissao } from "@/lib/session";
import { emResultado } from "@/lib/erro-de-operacao";
import { abrirMesa } from "@/lib/abertura";
import { enviarCarrinho as enviarRodada } from "@/lib/carrinho";

export async function abrirComanda(mesaId: string, pessoas: number, nomeCliente?: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("comanda.abrir");
    /*
     * A regra mora em `@/lib/abertura`, compartilhada com a maquininha: a
     * numeração da comanda e a trava que a protege não podem existir em duas
     * cópias, uma por porta. O que sobra aqui é a sessão e a tela.
     */
    const { comandaId } = await abrirMesa(sessao, { mesaId, pessoas, nomeCliente });

    revalidatePath("/pdv");
    return { comandaId };
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

