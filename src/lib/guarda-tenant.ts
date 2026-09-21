/**
 * Guarda contra vazamento entre restaurantes.
 *
 * O isolamento hoje depende de cada consulta lembrar de filtrar por tenant ou
 * unidade. Uma consulta esquecida não quebra nada visivelmente — ela devolve
 * dados de outro cliente, silenciosamente. Este guarda transforma esse erro
 * silencioso em exceção imediata.
 *
 * É defesa em profundidade, não a única linha: o RLS no Postgres
 * (ver docs/seguranca.md) barra no banco o que escapar daqui.
 */

/** Modelos cujas linhas pertencem a um restaurante específico. */
const MODELOS_ISOLADOS = new Set([
  "Unidade",
  "ParametroUnidade",
  "Usuario",
  "Cargo",
  "Area",
  "Mesa",
  "Cliente",
  "CategoriaProduto",
  "Produto",
  "GrupoOpcional",
  "Cardapio",
  "Impressora",
  "Estacao",
  "Comanda",
  "ComandaItem",
  "Pedido",
  "Caixa",
  "MovimentoCaixa",
  "FormaPagamento",
  "Pagamento",
  "Autorizacao",
  "AuditLog",
  "FilaImpressao",
  "EstoqueSaldo",
  "MovimentoEstoque",
  "Logomarca",
]);

/** Operações que varrem várias linhas — as perigosas. */
const OPERACOES_VERIFICADAS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "deleteMany",
]);

/**
 * Campos que já amarram a linha a um restaurante. `unidadeId` e `cardapioId`
 * contam porque a unidade e o cardápio pertencem a um tenant só.
 */
const CHAVES_DE_ESCOPO = [
  "tenantId",
  "tenant",
  "unidadeId",
  "unidade",
  "comandaId",
  "comanda",
  "cardapioId",
  "cardapio",
  "caixaId",
  "caixa",
  "produtoId",
  "produto",
  "pedidoId",
  "pedido",
  "usuarioId",
  "usuario",
  "cargoId",
  "cargo",
  // Toda chave estrangeira abaixo aponta para um registro que já pertence a um
  // restaurante só — filtrar por ela isola tanto quanto filtrar por tenantId.
  "mesaId",
  "mesa",
  "areaId",
  "area",
  "estacaoId",
  "estacao",
  "impressoraId",
  "impressora",
  "formaPagamentoId",
  "formaPagamento",
  "clienteId",
  "cliente",
  "categoriaId",
  "categoria",
  "grupoId",
  "grupo",
  "qrToken",
  "id",
];

function temEscopo(where: unknown, profundidade = 0): boolean {
  if (!where || typeof where !== "object" || profundidade > 3) return false;

  const objeto = where as Record<string, unknown>;

  for (const chave of CHAVES_DE_ESCOPO) {
    if (objeto[chave] !== undefined) return true;
  }

  // OR só isola se TODOS os ramos isolarem; AND basta um.
  if (Array.isArray(objeto.AND) && objeto.AND.some((r) => temEscopo(r, profundidade + 1))) {
    return true;
  }
  if (Array.isArray(objeto.OR) && objeto.OR.length > 0) {
    return objeto.OR.every((r) => temEscopo(r, profundidade + 1));
  }

  return false;
}

export type ResultadoGuarda = { permitido: true } | { permitido: false; motivo: string };

export function verificarConsulta(
  modelo: string | undefined,
  operacao: string,
  argumentos: unknown
): ResultadoGuarda {
  if (!modelo || !MODELOS_ISOLADOS.has(modelo)) return { permitido: true };
  if (!OPERACOES_VERIFICADAS.has(operacao)) return { permitido: true };

  const where = (argumentos as { where?: unknown } | undefined)?.where;
  if (temEscopo(where)) return { permitido: true };

  return {
    permitido: false,
    motivo:
      `${modelo}.${operacao} sem filtro de restaurante. ` +
      `Adicione tenantId ou unidadeId ao where — sem isso a consulta devolve dados de outros clientes.`,
  };
}
