import { describe, expect, it } from "vitest";
import { PERMISSOES_DO_CAIXA } from "./caixa";
import { temAlgumaPermissao, type Sessao } from "./session";

/**
 * A tela do caixa mostra quanto há em dinheiro na gaveta agora, o faturamento
 * do turno por forma de pagamento e as sangrias do dia — quem tirou e para
 * onde levou. Não é informação de quem está atendendo mesa.
 *
 * O garçom já era barrado nas **ações** (abrir, fechar, sangria). O que
 * faltava era a porta da tela: ele abria `/pdv/caixa` e lia tudo.
 */
const sessao = (permissoes: string[]): Sessao => ({
  usuarioId: "u1",
  tenantId: "t1",
  unidadeId: "un1",
  nome: "Fulano",
  cargo: "TESTE",
  permissoes,
});

describe("quem entra na tela do caixa", () => {
  /** As listas abaixo são as dos cargos no seed, copiadas como estão. */
  it.each([
    [
      "operador de caixa",
      [
        "comanda.abrir",
        "comanda.lancarItem",
        "comanda.fechar",
        "comanda.receberPagamento",
        "caixa.abrir",
        "caixa.fechar",
      ],
    ],
    [
      "gerente",
      [
        "comanda.abrir",
        "comanda.lancarItem",
        "comanda.fechar",
        "comanda.receberPagamento",
        "comanda.cancelarItem",
        "comanda.aplicarDesconto",
        "caixa.abrir",
        "caixa.fechar",
        "caixa.sangria",
        "autorizacao.aprovar",
        "produto.editar",
        "cardapio.editar",
        "auditoria.ver",
      ],
    ],
    ["proprietário", ["*"]],
  ])("%s entra", (_quem, permissoes) => {
    expect(temAlgumaPermissao(sessao(permissoes), PERMISSOES_DO_CAIXA)).toBe(true);
  });

  it("garçom não entra", () => {
    // As permissões reais do cargo GARCOM no seed.
    const garcom = ["comanda.abrir", "comanda.lancarItem", "comanda.imprimirParcial", "mesa.transferir"];
    expect(temAlgumaPermissao(sessao(garcom), PERMISSOES_DO_CAIXA)).toBe(false);
  });

  it("quem só recebe pagamento na mesa também não entra", () => {
    /**
     * Receber na tela da comanda é outra coisa: ali ele vê a conta de uma
     * mesa, não o caixa do turno inteiro.
     */
    expect(temAlgumaPermissao(sessao(["comanda.receberPagamento"]), PERMISSOES_DO_CAIXA)).toBe(false);
  });

  it("a lista cobre as três operações da gaveta", () => {
    // Acrescentar uma operação de caixa sem acrescentar a chave aqui deixaria
    // quem a tem sem acesso à própria tela.
    expect(PERMISSOES_DO_CAIXA).toEqual(
      expect.arrayContaining(["caixa.abrir", "caixa.fechar", "caixa.sangria"])
    );
  });
});
