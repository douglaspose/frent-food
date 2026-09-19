import type { Prisma } from "@prisma/client";

/**
 * O vocabulário do diário — sem nada de servidor.
 *
 * Fica separado de `auditoria-servidor.ts` porque a tela de filtros é um
 * componente de cliente e precisa da lista de ações. Junto com o `headers()`
 * do Next, esse import arrastaria uma API de servidor para dentro do pacote
 * que vai ao navegador, e a compilação quebra.
 *
 * O dono do restaurante não pergunta "houve desconto?" — ele pergunta "quem
 * deu esse desconto de R$ 40 na mesa 12 no sábado?". Sem isto, a resposta é
 * sempre a mesma: ninguém sabe. E é justamente onde o dinheiro escapa que o
 * sistema precisa ter memória.
 */
export const ACOES = {
  DESCONTO: "Desconto aplicado",
  TAXA_SERVICO: "Taxa de serviço alterada",
  ITEM_CANCELADO: "Item cancelado",
  CONTA_REABERTA: "Conta reaberta",
  MESA_TRANSFERIDA: "Mesa transferida",
  PAGAMENTO_ESTORNADO: "Pagamento estornado",
  CAIXA_FECHADO: "Caixa fechado",
  CAIXA_SANGRIA: "Sangria",
  CAIXA_SUPRIMENTO: "Suprimento",
  CAIXA_PAGAMENTO: "Pagamento pela gaveta",
  CAIXA_RECEBIMENTO: "Recebimento na gaveta",
  AJUSTE_ALTERADO: "Ajuste alterado",
  PRECO_ALTERADO: "Preço alterado",
  PRODUTO_DESATIVADO: "Produto desativado",
  PRODUTO_REATIVADO: "Produto reativado",
  USUARIO_CRIADO: "Usuário criado",
  USUARIO_EDITADO: "Usuário editado",
  USUARIO_DESATIVADO: "Usuário desativado",
  USUARIO_REATIVADO: "Usuário reativado",
} as const;

export type Acao = keyof typeof ACOES;

export type Registro = {
  /** Modelo afetado, como no schema: "Comanda", "CardapioItem", "Usuario". */
  entidade: string;
  entidadeId: string;
  acao: Acao;
  /** Estado relevante antes e depois. Guarde pouco e legível, não a linha toda. */
  antes?: Prisma.InputJsonValue;
  depois?: Prisma.InputJsonValue;
};
