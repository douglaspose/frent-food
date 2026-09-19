import { describe, expect, it } from "vitest";
import { EmissorSimulado } from "./emissor-simulado";
import {
  CODIGO_PAGAMENTO,
  montarItem,
  montarNota,
  montarPagamento,
  PERFIL_PADRAO,
  type ItemDaComanda,
} from "./montar-nota";

const emitente = {
  cnpj: "41.277.512/0001-87",
  razaoSocial: "RESTAURANTE TESTE LTDA",
  nomeFantasia: "Teste",
  inscricaoEstadual: "123456789",
  regime: "SIMPLES_NACIONAL" as const,
  uf: "GO",
  codigoMunicipio: "5208707",
  municipio: "Goiânia",
  logradouro: "Rua Teste",
  numero: "100",
  bairro: "Centro",
  cep: "74000000",
};

const espeto: ItemDaComanda = {
  codigo: "1",
  descricao: "Espeto de Alcatra",
  ncm: "16025000",
  cest: null,
  unidadeMedida: "UN",
  quantidade: 2,
  valorUnitario: 17.5,
  valorTotal: 35,
  perfil: null,
};

function notaBase(extras: Partial<Parameters<typeof montarNota>[0]> = {}) {
  return montarNota({
    serie: 1,
    numero: 1,
    codigoNumerico: 12345678,
    ambiente: "HOMOLOGACAO",
    contingencia: false,
    emitente,
    destinatario: null,
    itens: [espeto],
    pagamentos: [montarPagamento("PIX", "Pix", 35, 0)],
    desconto: 0,
    taxaServico: 0,
    ...extras,
  });
}

describe("tributação por regime", () => {
  it("Simples Nacional informa CSOSN e não destaca ICMS", () => {
    const item = montarItem(espeto, 1, "SIMPLES_NACIONAL");

    expect(item.csosn).toBe("102");
    expect(item.cstIcms).toBeNull();
    // Destacar ICMS no Simples é rejeição na certa.
    expect(item.valorIcms).toBe(0);
    expect(item.baseCalculoIcms).toBe(0);
  });

  it("Regime Normal informa CST e destaca o ICMS", () => {
    const comAliquota = { ...espeto, perfil: { ...PERFIL_PADRAO, aliquotaIcms: 18 } };
    const item = montarItem(comAliquota, 1, "NORMAL");

    expect(item.cstIcms).toBe("00");
    expect(item.csosn).toBeNull();
    expect(item.baseCalculoIcms).toBe(35);
    expect(item.valorIcms).toBe(6.3); // 35 × 18%
  });

  it("converte unidades que a NFe não conhece", () => {
    expect(montarItem({ ...espeto, unidadeMedida: "G" }, 1, "NORMAL").unidade).toBe("UN");
    expect(montarItem({ ...espeto, unidadeMedida: "L" }, 1, "NORMAL").unidade).toBe("LT");
    expect(montarItem({ ...espeto, unidadeMedida: "KG" }, 1, "NORMAL").unidade).toBe("KG");
  });

  it("limpa a formatação do NCM", () => {
    expect(montarItem({ ...espeto, ncm: "1602.50.00" }, 1, "NORMAL").ncm).toBe("16025000");
  });
});

describe("montagem da nota", () => {
  it("numera os itens a partir de 1", () => {
    const nota = notaBase({ itens: [espeto, espeto, espeto] });
    expect(nota.itens.map((i) => i.numero)).toEqual([1, 2, 3]);
  });

  it("deixa a taxa de serviço fora do total", () => {
    // O erro mais caro dessa integração: cobrar imposto sobre a gorjeta.
    const nota = notaBase({ taxaServico: 3.5 });

    expect(nota.valorTotal).toBe(35);
    expect(nota.informacoesComplementares).toContain("3,50");
    expect(nota.informacoesComplementares).toContain("nao inclusa");
  });

  it("não escreve observação quando não há taxa", () => {
    expect(notaBase().informacoesComplementares).toBeNull();
  });

  it("aplica desconto no total", () => {
    const nota = notaBase({
      desconto: 5,
      pagamentos: [montarPagamento("DINHEIRO", "Dinheiro", 30, 0)],
    });

    expect(nota.valorProdutos).toBe(35);
    expect(nota.valorDesconto).toBe(5);
    expect(nota.valorTotal).toBe(30);
  });

  it("limita o desconto ao valor dos produtos", () => {
    const nota = notaBase({
      desconto: 500,
      pagamentos: [montarPagamento("DINHEIRO", "Dinheiro", 0, 0)],
    });
    expect(nota.valorTotal).toBe(0);
  });

  it("traduz as formas de pagamento para os códigos da NFe", () => {
    expect(CODIGO_PAGAMENTO.DINHEIRO).toBe("01");
    expect(CODIGO_PAGAMENTO.CREDITO).toBe("03");
    expect(CODIGO_PAGAMENTO.DEBITO).toBe("04");
    expect(CODIGO_PAGAMENTO.PIX).toBe("17");
    expect(montarPagamento("INEXISTENTE", "?", 10, 0).codigo).toBe("99");
  });
});

describe("emissor simulado", () => {
  const emissor = new EmissorSimulado();

  it("autoriza uma nota bem formada", async () => {
    const r = await emissor.emitir(notaBase());

    expect(r.status).toBe("AUTORIZADA");
    if (r.status === "AUTORIZADA") {
      expect(r.chaveAcesso).toHaveLength(44);
      expect(r.qrCodeDados).toContain(r.chaveAcesso);
      expect(r.xml).toContain("<mod>65</mod>");
      expect(r.xml).toContain("SIMULA"); // deixa claro que não vale como nota
    }
  });

  it("marca contingência na chave", async () => {
    const r = await emissor.emitir(notaBase({ contingencia: true }));
    if (r.status === "AUTORIZADA") expect(r.chaveAcesso[34]).toBe("9");
  });

  it("recusa item sem NCM", async () => {
    const r = await emissor.emitir(notaBase({ itens: [{ ...espeto, ncm: null }] }));

    expect(r.status).toBe("REJEITADA");
    if (r.status === "REJEITADA") expect(r.motivo).toContain("NCM");
  });

  it("recusa emitente sem inscrição estadual", async () => {
    const r = await emissor.emitir(
      notaBase({ emitente: { ...emitente, inscricaoEstadual: null } })
    );
    expect(r.status).toBe("REJEITADA");
  });

  it("recusa quando o pagamento não fecha com o total", async () => {
    const r = await emissor.emitir({
      ...notaBase(),
      pagamentos: [montarPagamento("PIX", "Pix", 10, 0)],
    });

    expect(r.status).toBe("REJEITADA");
    if (r.status === "REJEITADA") expect(r.motivo).toContain("pagamentos");
  });

  it("exige CPF acima de dez mil reais", async () => {
    const caro = { ...espeto, quantidade: 1, valorUnitario: 12000, valorTotal: 12000 };
    const r = await emissor.emitir(
      notaBase({ itens: [caro], pagamentos: [montarPagamento("CREDITO", "Crédito", 12000, 0)] })
    );

    expect(r.status).toBe("REJEITADA");
    if (r.status === "REJEITADA") expect(r.motivo).toContain("10.000");
  });

  it("escapa caracteres que quebrariam o XML", async () => {
    const r = await emissor.emitir(
      notaBase({ itens: [{ ...espeto, descricao: 'Porção "P&A" <grande>' }] })
    );
    if (r.status === "AUTORIZADA") {
      expect(r.xml).toContain("&amp;");
      expect(r.xml).not.toContain("<grande>");
    }
  });

  it("recusa cancelamento com justificativa curta", async () => {
    const r = await emissor.cancelar("1".repeat(44), "errei");
    expect(r.status).toBe("RECUSADO");
  });

  it("aceita cancelamento com justificativa válida", async () => {
    const r = await emissor.cancelar("1".repeat(44), "Cliente desistiu do pedido apos emissao");
    expect(r.status).toBe("CANCELADA");
  });
});
