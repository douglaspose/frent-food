/**
 * O restaurante de exemplo: cargos, cardápio, formas de pagamento e equipe.
 *
 * Mora aqui, e não dentro do `seed.ts`, porque tem dois leitores: o seed, que
 * monta a demonstração, e o simulador de carga (`carga/`), que monta um dia
 * de operação para o agente de testes. Se cada um tivesse a sua cópia, o
 * simulador testaria permissões que nenhuma instalação real tem — e o
 * próprio seed já sofreu com lista duplicada, que é como um parâmetro acabou
 * lido pelo KDS e nunca criado.
 */

/** Permissões por cargo. A chave é o que o código checa antes de cada ação. */
export const PERMISSOES: Record<string, string[]> = {
  GARCOM: ["comanda.abrir", "comanda.lancarItem", "comanda.imprimirParcial", "mesa.transferir"],
  CAIXA: [
    "comanda.abrir",
    "comanda.lancarItem",
    "comanda.fechar",
    "comanda.receberPagamento",
    "caixa.abrir",
    "caixa.fechar",
  ],
  GERENTE: [
    "comanda.abrir",
    "comanda.lancarItem",
    "comanda.fechar",
    "comanda.receberPagamento",
    "comanda.cancelarItem",
    "comanda.aplicarDesconto",
    // O garçom já transfere; o gerente, que responde pelo salão, precisava
    // chamar um garçom para mudar uma mesa de lugar.
    "mesa.transferir",
    "caixa.abrir",
    "caixa.fechar",
    "caixa.sangria",
    "autorizacao.aprovar",
    "produto.editar",
    "cardapio.editar",
    // O gerente lê o diário porque é ele quem confere o turno. Garçom e caixa
    // não: a tela diz quem deu desconto e quem fechou com falta.
    "auditoria.ver",
  ],
  PROPRIETARIO: ["*"],
};

/** Cardápio de demonstração: espetaria/bar, próximo do que um cliente real teria. */
export const CARDAPIO: { categoria: string; itens: [string, number][] }[] = [
  {
    categoria: "Espetos",
    itens: [
      ["Espeto de Alcatra", 14.9],
      ["Espeto de Frango", 12.9],
      ["Espeto de Coração", 13.9],
      ["Espeto de Linguiça", 12.9],
      ["Espeto de Queijo Coalho", 12.0],
      ["Pão de Alho", 9.9],
    ],
  },
  {
    categoria: "Carnes",
    itens: [
      ["Picanha na Chapa", 129.9],
      ["Cupim na Chapa", 99.9],
      ["Carne de Sol com Mandioca", 89.9],
    ],
  },
  {
    categoria: "Porções",
    itens: [
      ["Batata Frita", 39.9],
      ["Mandioca Frita", 34.9],
      ["Torresmo", 44.9],
      ["Calabresa Acebolada", 42.9],
    ],
  },
  {
    categoria: "Bebidas",
    itens: [
      ["Cerveja Long Neck", 12.0],
      ["Chopp 300ml", 11.0],
      ["Refrigerante Lata", 7.0],
      ["Água Mineral", 5.0],
      ["Suco de Laranja", 12.0],
      ["Caipirinha", 22.0],
    ],
  },
  {
    categoria: "Sobremesas",
    itens: [
      ["Pudim", 16.9],
      ["Petit Gateau", 24.9],
    ],
  },
];

/**
 * Grupos de opcionais da demonstração.
 *
 * `produtos` são os títulos que recebem o grupo. Um grupo obrigatório com uma
 * escolha é o "escolha o ponto"; um grupo com `max` acima de um é o "até três
 * adicionais". Opcional com preço zero existe e é comum — "sem cebola" muda o
 * prato sem mudar a conta.
 */
export const GRUPOS_OPCIONAIS: {
  titulo: string;
  min: number;
  max: number;
  obrigatorio: boolean;
  produtos: string[];
  /**
   * `[título, preço]`, ou `[título, preço, produto]` quando o adicional é algo
   * que sai do estoque: aí ele também dá baixa, como qualquer venda. Adicional
   * cobrado que nunca baixa é inventário furando um pouco por noite, sem
   * ninguém achar a causa.
   */
  itens: ([string, number] | [string, number, string])[];
}[] = [
  {
    titulo: "Ponto da carne",
    min: 1,
    max: 1,
    obrigatorio: true,
    produtos: ["Picanha na Chapa", "Cupim na Chapa"],
    itens: [
      ["Mal passada", 0],
      ["Ao ponto", 0],
      ["Bem passada", 0],
    ],
  },
  {
    titulo: "Adicionais",
    min: 0,
    max: 3,
    obrigatorio: false,
    produtos: ["Picanha na Chapa", "Cupim na Chapa", "Batata Frita"],
    itens: [
      ["Bacon", 8.0],
      // Este sai do estoque: é o mesmo espeto que a casa vende sozinho.
      ["Queijo coalho", 7.0, "Espeto de Queijo Coalho"],
      ["Cebola empanada", 6.5],
      ["Molho da casa", 0],
    ],
  },
  {
    titulo: "Acompanhamento",
    min: 1,
    max: 2,
    obrigatorio: true,
    produtos: ["Carne de Sol com Mandioca"],
    itens: [
      ["Arroz", 0],
      ["Feijão tropeiro", 0],
      ["Vinagrete", 0],
      ["Farofa", 0],
    ],
  },
];

/** Bebida vai para o bar, comida vai para a cozinha. */
export const CATEGORIAS_DO_BAR = new Set(["Bebidas"]);

/** Carne pede ponto: é o que faz o PDV perguntar "mal passada?" ao lançar. */
export const CATEGORIAS_COM_PONTO = new Set(["Carnes"]);

/** Bebida alcoólica, pelo título — é o que marca "maior de idade". */
export function ehAlcoolica(titulo: string) {
  return titulo.includes("Cerveja") || titulo.includes("Chopp") || titulo.includes("Caipirinha");
}

export const FORMAS_DE_PAGAMENTO = [
  { nome: "Dinheiro", tipo: "DINHEIRO" as const },
  { nome: "Pix", tipo: "PIX" as const },
  { nome: "Cartão de Débito", tipo: "DEBITO" as const, taxaPct: 1.5, prazoDias: 1 },
  { nome: "Cartão de Crédito", tipo: "CREDITO" as const, taxaPct: 3.2, prazoDias: 30 },
];
