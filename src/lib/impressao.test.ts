import { describe, expect, it } from "vitest";
import {
  COLUNAS,
  centro,
  comandaDeProducao,
  conferenciaDeConta,
  cupomDePagamento,
  larguraImpressa,
  pares,
  paraImpressora,
  paraTela,
  quebrar,
} from "./impressao";

/**
 * Papel que estoura 48 colunas quebra a linha na impressora e vira ilegível.
 *
 * Medido pelo que sai no papel, e não pelo número de caracteres: a letra dupla
 * ocupa duas colunas por letra, e o comando que a liga não ocupa nenhuma.
 */
function larguraMaxima(texto: string) {
  return Math.max(...texto.split("\n").map(larguraImpressa));
}

describe("primitivas de layout", () => {
  it("centraliza dentro da largura do papel", () => {
    expect(centro("TESTE")).toHaveLength(COLUNAS - Math.ceil((COLUNAS - 5) / 2));
    expect(centro("TESTE").trim()).toBe("TESTE");
  });

  it("alinha valor à direita preenchendo o meio", () => {
    const linha = pares("Subtotal", "161,90");
    expect(linha).toHaveLength(COLUNAS);
    expect(linha.startsWith("Subtotal")).toBe(true);
    expect(linha.endsWith("161,90")).toBe(true);
  });

  it("não estoura a largura quando os dois lados são longos", () => {
    const linha = pares("A".repeat(60), "999.999,99");
    expect(linha.length).toBeLessThanOrEqual(COLUNAS);
  });

  it("quebra respeitando palavras", () => {
    const linhas = quebrar("PICANHA COMPLETA GRATINADA COM FAROFA", 20);
    expect(linhas.every((l) => l.length <= 20)).toBe(true);
    expect(linhas.join(" ")).toBe("PICANHA COMPLETA GRATINADA COM FAROFA");
  });

  it("parte palavra maior que a largura sem perder caractere", () => {
    // O caso real é a URL de consulta da NFC-e: não tem espaço nenhum, e
    // truncada deixa o cliente com um endereço que não abre.
    const url = "https://nfce-homologacao.sefaz.go.gov.br/consulta";
    const linhas = quebrar(url, 48);

    expect(linhas.every((l) => l.length <= 48)).toBe(true);
    expect(linhas.join("")).toBe(url);
  });

  it("parte palavras muito longas em vários pedaços", () => {
    const linhas = quebrar("A".repeat(100), 10);
    expect(linhas).toHaveLength(10);
    expect(linhas.join("")).toHaveLength(100);
  });
});

describe("comanda de produção", () => {
  const papel = comandaDeProducao({
    estacao: "COZINHA",
    pedidoNumero: 4,
    mesa: "3",
    comandaNumero: 12,
    garcom: "João Garçom",
    criadoEm: new Date("2026-09-18T19:36:00"),
    itens: [
      { titulo: "Costela no Bafo", quantidade: 1, pontoCarne: "MAL PASSADO" },
      { titulo: "Espeto de Alcatra", quantidade: 2 },
      { titulo: "Picanha Completa Gratinada com Farofa e Vinagrete", quantidade: 1, observacao: "sem cebola" },
    ],
  });

  it("cabe no papel", () => {
    expect(larguraMaxima(papel)).toBeLessThanOrEqual(COLUNAS);
  });

  it("destaca a mesa e a estação", () => {
    expect(papel).toContain("COZINHA");
    expect(papel).toContain("MESA 3");
  });

  it("nunca mostra preço para a cozinha", () => {
    expect(papel).not.toMatch(/R\$/);
    expect(papel).not.toMatch(/\d+,\d{2}/);
  });

  it("mostra ponto da carne e observação", () => {
    expect(papel).toContain("MAL PASSADO");
    expect(papel).toContain("sem cebola");
  });

  it("usa o número da comanda quando não há mesa", () => {
    const balcao = comandaDeProducao({
      estacao: "BAR",
      pedidoNumero: 9,
      mesa: null,
      comandaNumero: 77,
      garcom: "Ana",
      criadoEm: new Date(),
      itens: [{ titulo: "Chopp", quantidade: 1 }],
    });
    expect(balcao).toContain("COMANDA 77");
  });
});

describe("conferência de conta", () => {
  const papel = conferenciaDeConta({
    restaurante: "Matriz",
    mesa: "3",
    comandaNumero: 4,
    pessoas: 4,
    nomeCliente: null,
    abertaEm: new Date("2026-09-18T19:36:00"),
    taxaServicoPct: 10,
    descontoValor: 0,
    descontoMotivo: null,
    itens: [
      { titulo: "Costela no Bafo", quantidade: 1, precoTotal: 119.9 },
      { titulo: "Espeto de Alcatra", quantidade: 2, precoTotal: 35 },
      { titulo: "Refrigerante Lata", quantidade: 1, precoTotal: 7 },
    ],
  });

  it("cabe no papel", () => {
    expect(larguraMaxima(papel)).toBeLessThanOrEqual(COLUNAS);
  });

  it("fecha a conta certa", () => {
    expect(papel).toContain("R$ 178,09");
  });

  it("divide por pessoa com duas casas", () => {
    expect(papel).toContain("44,52");
    expect(papel).not.toContain("44,523");
  });

  it("avisa que não é documento fiscal", () => {
    expect(papel).toContain("NAO E DOCUMENTO FISCAL");
  });

  it("marca a segunda via", () => {
    const segunda = conferenciaDeConta({
      restaurante: "Matriz",
      mesa: "3",
      comandaNumero: 4,
      pessoas: 1,
      nomeCliente: null,
      abertaEm: new Date(),
      taxaServicoPct: 10,
      descontoValor: 0,
      descontoMotivo: null,
      itens: [{ titulo: "Chopp", quantidade: 1, precoTotal: 11 }],
      segundaVia: true,
    });
    expect(segunda).toContain("SEGUNDA VIA");
  });

  it("mostra o desconto com o motivo", () => {
    const comDesconto = conferenciaDeConta({
      restaurante: "Matriz",
      mesa: "3",
      comandaNumero: 4,
      pessoas: 1,
      nomeCliente: null,
      abertaEm: new Date(),
      taxaServicoPct: 10,
      descontoValor: 3.8,
      descontoMotivo: "Cortesia gerente",
      itens: [{ titulo: "Espeto", quantidade: 1, precoTotal: 43.8 }],
    });
    expect(comDesconto).toContain("Cortesia gerente");
    expect(comDesconto).toContain("R$ 44,00");
  });

  /** A linha do papel que contém o texto, já sem os comandos de impressora. */
  const linhaCom = (texto: string, trecho: string) =>
    texto.split("\n").find((l) => paraTela(l).includes(trecho));

  it("imprime a mesa e o total em letra dupla, sem estourar o papel", () => {
    const mesa = linhaCom(papel, "Mesa 3")!;
    const total = linhaCom(papel, "TOTAL")!;
    // Na impressora, a letra dupla liga no começo da linha e desliga no fim.
    for (const l of [mesa, total]) {
      const naImpressora = paraImpressora(l);
      expect(naImpressora.startsWith("\x1d\x21\x11")).toBe(true);
      expect(naImpressora.endsWith("\x1d\x21\x00")).toBe(true);
      expect(larguraImpressa(l)).toBeLessThanOrEqual(COLUNAS);
    }
    // O resto do papel continua em letra normal.
    expect(paraImpressora(linhaCom(papel, "Espeto de Alcatra")!)).not.toContain("\x1d");
  });

  /**
   * O comando que desliga a letra dupla termina no byte zero, e o Postgres
   * recusa byte zero numa coluna de texto. A primeira versão guardava o
   * comando direto — e a conferência de toda mesa falhava ao entrar na fila.
   */
  it("o que vai para a fila não tem byte zero — o banco recusaria", () => {
    expect(papel).not.toContain("\x00");
    expect(paraImpressora(papel)).toContain("\x00");
  });

  it("na tela, a letra dupla some e o texto fica limpo", () => {
    expect(paraTela(papel)).not.toMatch(/[\x0e\x0f\x1d]/);
    expect(paraTela(papel)).toContain("Mesa 3");
    expect(paraTela(papel)).toContain("R$ 178,09");
  });

  it("sem pagamento, não fala em pago nem em falta", () => {
    expect(papel).not.toContain("JA PAGO");
    expect(papel).not.toContain("FALTA PAGAR");
  });

  describe("com pagamento parcial de quem já foi embora", () => {
    const parcial = conferenciaDeConta({
      restaurante: "Matriz",
      mesa: "3",
      comandaNumero: 4,
      pessoas: 4,
      nomeCliente: null,
      abertaEm: new Date("2026-09-18T19:36:00"),
      taxaServicoPct: 10,
      descontoValor: 0,
      descontoMotivo: null,
      itens: [
        { titulo: "Costela no Bafo", quantidade: 1, precoTotal: 119.9 },
        { titulo: "Espeto de Alcatra", quantidade: 2, precoTotal: 35 },
        { titulo: "Refrigerante Lata", quantidade: 1, precoTotal: 7 },
      ],
      pagamentos: [
        { forma: "Pix", valor: 44.52, em: new Date("2026-09-18T21:14:00") },
        { forma: "Dinheiro", valor: 44.52, em: new Date("2026-09-18T21:15:00") },
      ],
    });

    it("lista cada pagamento com a forma, a hora e o valor", () => {
      expect(parcial).toContain("JA PAGO");
      expect(paraTela(parcial)).toMatch(/Pix\s+21:14\s+44,52/);
      expect(paraTela(parcial)).toMatch(/Dinheiro\s+21:15\s+44,52/);
    });

    it("mostra quanto falta pagar", () => {
      // 178,09 − 44,52 − 44,52
      expect(linhaCom(parcial, "FALTA PAGAR")).toContain("R$ 89,05");
    });

    it("mantém o total da conta inteira e a divisão por pessoa", () => {
      expect(paraTela(parcial)).toContain("R$ 178,09");
      expect(paraTela(parcial)).toContain("Por pessoa (4)");
      expect(paraTela(parcial)).toContain("44,52");
    });

    it("cabe no papel", () => {
      expect(larguraMaxima(parcial)).toBeLessThanOrEqual(COLUNAS);
    });
  });

  it("conta paga por inteiro mostra falta zero, nunca negativa", () => {
    const quitada = conferenciaDeConta({
      restaurante: "Matriz",
      mesa: "3",
      comandaNumero: 4,
      pessoas: 1,
      nomeCliente: null,
      abertaEm: new Date(),
      taxaServicoPct: 0,
      descontoValor: 0,
      descontoMotivo: null,
      itens: [{ titulo: "Chopp", quantidade: 1, precoTotal: 11 }],
      pagamentos: [{ forma: "Pix", valor: 11, em: new Date() }],
    });
    expect(linhaCom(quitada, "FALTA PAGAR")).toContain("R$ 0,00");
  });
});

describe("cupom de pagamento", () => {
  it("cabe no papel e lista as formas com troco", () => {
    const papel = cupomDePagamento({
      restaurante: "Matriz",
      mesa: "5",
      comandaNumero: 1,
      total: 44,
      operador: "Caixa da Noite",
      pagamentos: [
        { forma: "Pix", valor: 20, troco: 0 },
        { forma: "Dinheiro", valor: 30, troco: 6 },
      ],
    });

    expect(larguraMaxima(papel)).toBeLessThanOrEqual(COLUNAS);
    expect(papel).toContain("Pix");
    expect(papel).toContain("Troco");
    expect(papel).toContain("6,00");
  });
});
