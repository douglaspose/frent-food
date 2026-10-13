import { NextResponse, type NextRequest } from "next/server";
import { declararTenant } from "@/lib/tenant-atual";
import { cardapioDaUnidade } from "@/lib/carrinho";
import { operadorDaRequisicao, unidadeDoAparelho } from "@/lib/maquininha";

export const dynamic = "force-dynamic";

/**
 * GET /api/maquininha/cardapio — o cardápio do salão, para o garçom lançar.
 *
 * É o mesmo cardápio do PDV, da mesma tabela: o que a casa cadastra em
 * Gestão → Cardápio aparece aqui, com o preço de lá. Nada é duplicado para a
 * maquininha — cardápio em dois lugares é cardápio que diverge, e o que
 * diverge primeiro é o preço.
 *
 * Vem inteiro de uma vez, e não por categoria: um cardápio de restaurante tem
 * algumas centenas de itens, cabe numa resposta, e o garçom no salão não pode
 * depender da rede a cada toque para ver a próxima seção.
 */
export async function GET(request: NextRequest) {
  const unidade = await unidadeDoAparelho(request);
  if (!unidade?.ativo) {
    return NextResponse.json({ erro: "Token do aparelho inválido." }, { status: 401 });
  }
  declararTenant(unidade.tenantId);

  const operador = await operadorDaRequisicao(request, unidade);
  if (!operador) {
    return NextResponse.json({ erro: "Sessão do operador expirada." }, { status: 401 });
  }

  const podeLancar =
    operador.permissoes.includes("*") || operador.permissoes.includes("comanda.lancarItem");
  if (!podeLancar) {
    return NextResponse.json(
      { erro: "Seu acesso não permite lançar itens." },
      { status: 403 }
    );
  }

  return NextResponse.json({
    unidade: unidade.nome,
    categorias: await cardapioDaUnidade(unidade.id),
  });
}
