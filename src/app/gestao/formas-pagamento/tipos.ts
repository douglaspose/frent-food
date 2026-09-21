/**
 * O vocabulário das formas de pagamento — sem nada de servidor.
 *
 * Fica separado de `actions.ts` pelo mesmo motivo que `auditoria.ts` fica
 * separado de `auditoria-servidor.ts`: um módulo `"use server"` só pode
 * exportar função assíncrona. Qualquer outra coisa vira um proxy do lado do
 * cliente, e a lista chegava na tela como um objeto sem `.map` — a página
 * quebrava ao abrir o formulário, e a mensagem não dizia nada sobre isso.
 */
export const TIPOS = [
  "DINHEIRO",
  "PIX",
  "DEBITO",
  "CREDITO",
  "VOUCHER",
  "CONVENIO",
  "OUTRO",
] as const;

export type TipoDePagamento = (typeof TIPOS)[number];

export const ROTULO_DO_TIPO: Record<TipoDePagamento, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  DEBITO: "Cartão de débito",
  CREDITO: "Cartão de crédito",
  VOUCHER: "Vale-refeição",
  CONVENIO: "Convênio",
  OUTRO: "Outro",
};

/**
 * O `tPag` do layout da NFC-e, deduzido do tipo.
 *
 * Deduzido, e não digitado: é código fiscal, e errá-lo faz a nota ser rejeitada
 * na SEFAZ — não é campo para o dono de restaurante preencher de cabeça. Se
 * alguma adquirente exigir um código fora deste mapa, aí vale abrir o campo;
 * até lá, oferecer dezesseis opções só cria uma forma nova de errar.
 */
export const CODIGO_FISCAL: Record<TipoDePagamento, string> = {
  DINHEIRO: "01",
  CREDITO: "03",
  DEBITO: "04",
  CONVENIO: "05",
  VOUCHER: "11",
  PIX: "17",
  OUTRO: "99",
};

export type DadosDaForma = {
  nome: string;
  tipo: TipoDePagamento;
  taxaPct: number;
  prazoDias: number;
};
