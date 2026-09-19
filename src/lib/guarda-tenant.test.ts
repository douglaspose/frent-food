import { describe, expect, it } from "vitest";
import { verificarConsulta } from "./guarda-tenant";

const bloqueia = (modelo: string, operacao: string, args?: unknown) =>
  verificarConsulta(modelo, operacao, args).permitido === false;

describe("guarda de tenant", () => {
  it("barra varredura de modelo isolado sem filtro", () => {
    expect(bloqueia("Comanda", "findMany", {})).toBe(true);
    expect(bloqueia("Comanda", "findMany", undefined)).toBe(true);
    expect(bloqueia("Produto", "count", {})).toBe(true);
    expect(bloqueia("Mesa", "deleteMany", { where: {} })).toBe(true);
  });

  it("aceita filtro por tenant ou unidade", () => {
    expect(bloqueia("Comanda", "findMany", { where: { tenantId: "t1" } })).toBe(false);
    expect(bloqueia("Mesa", "findMany", { where: { unidadeId: "u1" } })).toBe(false);
    expect(bloqueia("Produto", "findMany", { where: { tenant: { slug: "demo" } } })).toBe(false);
  });

  it("aceita filtro por relação que já amarra o restaurante", () => {
    expect(bloqueia("Pagamento", "findMany", { where: { comanda: { unidadeId: "u1" } } })).toBe(
      false
    );
    expect(bloqueia("ComandaItem", "findMany", { where: { comandaId: "c1" } })).toBe(false);
  });

  it("aceita chave estrangeira que já pertence a um restaurante", () => {
    // Uma mesa pertence a uma unidade só, então filtrar por mesaId isola tanto
    // quanto filtrar por tenantId. Sem isso o guarda dava falso positivo na
    // tela da comanda.
    const porMesa = { where: { mesaId: "m1", status: { in: ["ABERTA"] } } };
    expect(bloqueia("Comanda", "findFirst", porMesa)).toBe(false);
    expect(bloqueia("Mesa", "findMany", { where: { areaId: "a1" } })).toBe(false);
    expect(bloqueia("Pedido", "findMany", { where: { estacaoId: "e1" } })).toBe(false);
  });

  it("aceita escopo dentro de AND", () => {
    const args = { where: { AND: [{ status: "ABERTA" }, { unidadeId: "u1" }] } };
    expect(bloqueia("Comanda", "findMany", args)).toBe(false);
  });

  it("exige escopo em TODOS os ramos do OR", () => {
    // Um ramo sem filtro basta para o OR trazer linha de outro restaurante.
    const meioAberto = { where: { OR: [{ unidadeId: "u1" }, { status: "PAGA" }] } };
    expect(bloqueia("Comanda", "findMany", meioAberto)).toBe(true);

    const fechado = { where: { OR: [{ unidadeId: "u1" }, { unidadeId: "u2" }] } };
    expect(bloqueia("Comanda", "findMany", fechado)).toBe(false);
  });

  it("não atrapalha modelos que não pertencem a um restaurante", () => {
    expect(bloqueia("Tenant", "findMany", {})).toBe(false);
    expect(bloqueia("Composicao", "findMany", {})).toBe(false);
  });

  it("não interfere em busca por id único", () => {
    expect(bloqueia("Comanda", "findUnique", { where: { id: "c1" } })).toBe(false);
    expect(bloqueia("Comanda", "create", { data: {} })).toBe(false);
  });

  it("explica o que fazer na mensagem", () => {
    const r = verificarConsulta("Comanda", "findMany", {});
    expect(r.permitido).toBe(false);
    if (!r.permitido) {
      expect(r.motivo).toContain("tenantId");
      expect(r.motivo).toContain("Comanda.findMany");
    }
  });
});
