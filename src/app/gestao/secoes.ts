/**
 * As seções que vivem dentro de "Configurações".
 *
 * Moram aqui, e não na página que as lista, porque quem também precisa delas é
 * o menu de cima: é essa lista que faz "Configurações" aparecer aceso enquanto
 * você está em Ajustes ou em Fiscal. Com as rotas escritas em dois lugares, a
 * sexta seção que alguém criar entra na página e não acende no menu — e esse é
 * o tipo de desencontro que ninguém reporta, só estranha.
 *
 * O critério para uma seção estar aqui não é frequência de uso, que envelhece
 * e é diferente em cada restaurante: é o que ela responde. Estas cinco mudam
 * quando algo muda na casa. Cardápio, produtos, estoque e diário mudam durante
 * o turno, e por isso ficam na barra.
 *
 * A descrição não é enfeite. São telas abertas a cada dois meses, e é aí que
 * ninguém lembra se "Fiscal" é onde mora o certificado ou a série da nota.
 */
export type SecaoDeConfiguracao = {
  href: string;
  titulo: string;
  descricao: string;
  /** Quando presente, a seção some para quem não tem a permissão. */
  permissao?: string;
};

export const SECOES_DE_CONFIGURACAO: SecaoDeConfiguracao[] = [
  {
    href: "/gestao/mesas",
    titulo: "Mesas",
    descricao: "As mesas do salão e as áreas em que elas ficam — interna, deck, varanda.",
  },
  {
    href: "/gestao/equipe",
    titulo: "Equipe",
    descricao: "Quem trabalha aqui, o cargo de cada um e o PIN de acesso ao PDV.",
  },
  {
    href: "/gestao/impressao",
    titulo: "Impressão",
    descricao: "As impressoras do salão e da cozinha, e o token do agente que fala com elas.",
  },
  {
    href: "/gestao/formas-pagamento",
    titulo: "Formas de pagamento",
    descricao:
      "O que o caixa pode escolher ao fechar a conta, a taxa da maquininha e em quantos dias o dinheiro cai.",
    permissao: "unidade.configurar",
  },
  {
    href: "/gestao/fiscal",
    titulo: "Fiscal",
    descricao: "Emissão de NFC-e: certificado, CSC, série e ambiente de homologação.",
  },
  {
    href: "/gestao/ajustes",
    titulo: "Ajustes",
    descricao: "Como o sistema se comporta no salão — taxa de serviço, alertas, exigências.",
    permissao: "unidade.configurar",
  },
];

export const CONFIGURACOES = "/gestao/configuracoes";
