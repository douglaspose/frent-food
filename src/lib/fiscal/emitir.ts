import "server-only";
import { db } from "../db";
import { CONSUMO } from "../itens";
import { calcularTotais } from "../comanda";
import { enfileirar } from "../fila-impressao";
import { gerarCodigoNumerico, montarChave, TP_EMIS } from "./chave";
import { danfeDaNota } from "./danfe";
import { EmissorSimulado } from "./emissor-simulado";
import { montarNota, montarPagamento, type ItemDaComanda } from "./montar-nota";
import type { Emissor, NotaParaEmitir } from "./tipos";
import type { Prisma } from "@prisma/client";

/**
 * Escolhe quem fala com a SEFAZ. Enquanto só existe o simulado, os gateways
 * caem nele de propósito: melhor uma nota marcada como simulação do que uma
 * integração pela metade fingindo que emitiu.
 */
export function emissorDa(unidade: { emissorFiscal: string }): Emissor {
  switch (unidade.emissorFiscal) {
    case "SIMULADO":
    default:
      return new EmissorSimulado();
  }
}

/** Os estados em que a comanda já tem nota, e não cabe outra. */
const JA_TEM_NOTA = ["AUTORIZADA", "PROCESSANDO", "CONTINGENCIA"] as const;

const JA_TEM_NOTA_MOTIVO = "Esta comanda já tem nota emitida.";

/** Quantas vezes tentar outro número antes de desistir. */
const TENTATIVAS_DE_NUMERO = 5;

/**
 * O número foi levado por outro caixa entre a leitura e a gravação.
 *
 * É a única violação de unicidade possível nesta gravação: a `chaveAcesso`
 * ainda é nula aqui, e `comandaId` não é único.
 */
function numeroJaTomado(e: unknown) {
  return (
    e instanceof Error && e.message.includes("notas_fiscais_unidadeId_serie_numero_key")
  );
}

/**
 * Reserva a nota da comanda: confere que ela não tem nota e grava a linha, de
 * uma vez só.
 *
 * Duas corridas moram aqui, e as duas são a mesma coisa — ler o banco, decidir,
 * e gravar depois:
 *
 * 1. **Duas contas diferentes fechando no mesmo segundo** — o sábado inteiro.
 *    As duas leituras do maior número da série veem o mesmo máximo, e a
 *    gravação da segunda batia no `@@unique([unidadeId, serie, numero])`. O
 *    estouro subia por `emitirNfce`, que promete não lançar, e quem a chama
 *    (`lib/conta.ts`) o engolia porque a conta já está paga e o cliente não
 *    pode ser segurado na porta: a venda terminava **sem nota e sem linha no
 *    banco**, invisível para a tela Fiscal, que lista notas.
 *
 * 2. **Dois toques na mesma venda** — o botão "reemitir" da tela Fiscal, ou
 *    duas abas do caixa. A conferência de "esta comanda já tem nota" lia e a
 *    gravação vinha depois, então as duas passavam e a venda terminava com
 *    **duas notas autorizadas na SEFAZ**. Nota em duplicidade é o problema
 *    fiscal mais caro deste módulo: imposto recolhido duas vezes sobre a mesma
 *    venda, e desfazer pede cancelamento dentro da janela da SEFAZ.
 *
 * A trava da linha da comanda resolve a segunda — é a mesma que
 * `lib/cancelamento` e a finalização usam, e a granularidade certa: quem
 * disputa uma comanda é o dedo da mesma pessoa, não o salão. A primeira fica
 * com o índice único: quem perde o número tenta a transação de novo, e a
 * tentativa seguinte lê um máximo já maior. Cinco tentativas cobrem cinco
 * caixas empatando.
 *
 * A trava da linha da **unidade** não serve aqui: ela é a da abertura de mesa
 * (`lib/abertura`) e da venda de balcão, e serializaria toda emissão contra o
 * salão para pagar por uma colisão que só acontece no empate.
 */
async function reservarNota(
  montar: (numero: number) => NotaParaEmitir,
  onde: {
    tenantId: string;
    unidadeId: string;
    comandaId: string;
    serie: number;
    ambiente: "HOMOLOGACAO" | "PRODUCAO";
    emitidaPorId?: string;
  }
) {
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM comandas WHERE id = ${onde.comandaId} FOR UPDATE`;

        // A conferência que vale, dentro da trava. A de fora é só para não
        // abrir transação no caso comum de quem toca duas vezes devagar.
        const ja = await tx.notaFiscal.findFirst({
          where: { comandaId: onde.comandaId, status: { in: [...JA_TEM_NOTA] } },
          select: { id: true },
        });
        if (ja) return { jaEmitida: ja.id };

        const ultima = await tx.notaFiscal.findFirst({
          where: { unidadeId: onde.unidadeId, serie: onde.serie },
          orderBy: { numero: "desc" },
          select: { numero: true },
        });

        const nota = montar((ultima?.numero ?? 0) + 1);
        const registro = await tx.notaFiscal.create({
          data: {
            tenantId: onde.tenantId,
            unidadeId: onde.unidadeId,
            comandaId: onde.comandaId,
            serie: onde.serie,
            numero: nota.numero,
            ambiente: onde.ambiente,
            status: "PROCESSANDO",
            valorTotal: nota.valorTotal,
            emitidaPorId: onde.emitidaPorId,
          },
        });
        return { nota, registro };
      });
    } catch (e) {
      if (tentativa >= TENTATIVAS_DE_NUMERO || !numeroJaTomado(e)) throw e;
    }
  }
}

/**
 * O que fica guardado quando a SEFAZ não recebe.
 *
 * A nota nasce **em contingência offline**: é assim que a lei trata a venda
 * que aconteceu sem o serviço no ar, e a chave de acesso dela carrega
 * `tpEmis=9` para dizer isso. A chave é calculada aqui, por nós — não vem do
 * emissor, que é justamente quem não respondeu — e é a mesma que a transmissão
 * de depois vai usar: a data de emissão e o código numérico entram no cálculo,
 * então remontar o documento mais tarde daria outra nota.
 *
 * Por isso o documento inteiro é guardado em `emitida`. Era o que faltava
 * para a transmissão posterior existir (`lib/fiscal/contingencia`).
 */
function emOffline(nota: NotaParaEmitir): { documento: NotaParaEmitir; chave: string } {
  const documento: NotaParaEmitir = { ...nota, contingencia: true };
  const chave = montarChave({
    uf: documento.emitente.uf,
    emissao: documento.emissao,
    cnpj: documento.emitente.cnpj,
    serie: documento.serie,
    numero: documento.numero,
    codigoNumerico: documento.codigoNumerico,
    tipoEmissao: TP_EMIS.CONTINGENCIA_OFFLINE,
  });
  return { documento, chave };
}

/**
 * O cupom que o cliente leva quando a SEFAZ está fora.
 *
 * A lei manda entregar o DANFE ao consumidor **no ato da venda**, autorizada
 * ou não: na contingência offline o papel sai com o aviso de contingência, a
 * chave que nós mesmos calculamos e sem protocolo — a autorização vem depois,
 * pela transmissão (`lib/fiscal/contingencia`), e aí sai um segundo papel para
 * a casa.
 *
 * Até aqui o cliente saía **sem cupom nenhum** quando o serviço estava fora,
 * que era a dívida mais séria que o módulo fiscal tinha.
 *
 * Nunca lança: a conta já foi paga e o cliente está de pé no caixa. Papel que
 * não sai é problema da fila de impressão, não da venda.
 */
async function papelDaContingencia(
  registro: { id: string; tenantId: string; unidadeId: string },
  documento: NotaParaEmitir,
  chave: string
) {
  try {
    await enfileirar({
      tenantId: registro.tenantId,
      unidadeId: registro.unidadeId,
      tipo: "DANFE_NFCE",
      titulo: `NFC-e ${documento.numero}/${documento.serie} (contingência)`,
      referenciaId: registro.id,
      conteudo: danfeDaNota(documento, { contingencia: true, chaveAcesso: chave }),
    });
  } catch (e) {
    console.error("Falha ao enfileirar DANFE da contingência", e);
  }
}

export type ResultadoEmitir =
  | { ok: true; notaId: string; chaveAcesso: string }
  | { ok: false; notaId?: string; motivo: string };

/**
 * Emite a NFC-e de uma comanda paga.
 *
 * Nunca lança: a conta já foi paga e o cliente está de pé no caixa. Problema
 * fiscal vira nota com status de erro para a gestão resolver, não venda
 * travada.
 */
export async function emitirNfce(
  comandaId: string,
  usuarioId?: string,
  /** O teste injeta aqui o emissor que cai; em produção vem do cadastro. */
  emissor?: Emissor
): Promise<ResultadoEmitir> {
  const comanda = await db.comanda.findUnique({
    where: { id: comandaId },
    include: {
      unidade: true,
      cliente: { select: { nome: true, cpf: true } },
      itens: {
        where: CONSUMO,
        orderBy: { lancadoEm: "asc" },
        include: {
          produto: {
            select: {
              codigo: true,
              titulo: true,
              ncm: true,
              cest: true,
              unidadeMedida: true,
              perfilFiscal: true,
            },
          },
        },
      },
      pagamentos: { include: { formaPagamento: true } },
    },
  });

  if (!comanda) return { ok: false, motivo: "Comanda não encontrada." };

  const unidade = comanda.unidade;
  if (!unidade.emiteNfce) return { ok: false, motivo: "Emissão de NFC-e desligada nesta unidade." };
  if (!unidade.uf) return { ok: false, motivo: "UF da unidade não configurada." };
  if (!unidade.cnpj) return { ok: false, motivo: "CNPJ da unidade não configurado." };

  const jaEmitida = await db.notaFiscal.findFirst({
    where: { comandaId, status: { in: [...JA_TEM_NOTA] } },
  });
  // Emitir duas notas para a mesma venda é problema fiscal, não conveniência.
  // Quem decide é a conferência de dentro da trava, em `reservarNota`: esta
  // responde cedo e com o id da nota, e não vale contra dois toques juntos.
  if (jaEmitida) {
    return { ok: false, notaId: jaEmitida.id, motivo: JA_TEM_NOTA_MOTIVO };
  }

  const itens: ItemDaComanda[] = comanda.itens.map((item) => ({
    codigo: item.produto.codigo ?? "",
    descricao: item.produto.titulo,
    ncm: item.produto.ncm,
    cest: item.produto.cest,
    unidadeMedida: item.produto.unidadeMedida,
    quantidade: Number(item.quantidade),
    valorUnitario: Number(item.precoUnitario),
    valorTotal: Number(item.precoTotal),
    perfil: item.produto.perfilFiscal
      ? {
          origemMercadoria: item.produto.perfilFiscal.origemMercadoria,
          cfop: item.produto.perfilFiscal.cfop,
          csosn: item.produto.perfilFiscal.csosn,
          cstIcms: item.produto.perfilFiscal.cstIcms,
          aliquotaIcms: Number(item.produto.perfilFiscal.aliquotaIcms),
          cstPis: item.produto.perfilFiscal.cstPis,
          aliquotaPis: Number(item.produto.perfilFiscal.aliquotaPis),
          cstCofins: item.produto.perfilFiscal.cstCofins,
          aliquotaCofins: Number(item.produto.perfilFiscal.aliquotaCofins),
        }
      : null,
  }));

  const totais = calcularTotais({
    itens: itens.map((i) => ({ precoTotal: i.valorTotal })),
    taxaServicoPct: Number(comanda.taxaServicoPct),
    descontoValor: Number(comanda.descontoValor),
  });

  // Os pagamentos cobrem a conta inteira, inclusive a taxa de serviço; a nota
  // só cobre mercadoria. O ajuste mantém pagamento e total coerentes.
  const proporcao = totais.total > 0 ? totais.base / totais.total : 1;
  const pagamentos = comanda.pagamentos.map((p) =>
    montarPagamento(
      p.formaPagamento.tipo,
      p.formaPagamento.nome,
      Math.round(Number(p.valor) * proporcao * 100) / 100,
      Math.round(Number(p.troco) * proporcao * 100) / 100
    )
  );

  const serie = unidade.serieNfce;
  // Conferidos no alto da função; soltos aqui porque dentro da closure o
  // TypeScript não guarda o estreitamento feito sobre a propriedade.
  const cnpj = unidade.cnpj;
  const uf = unidade.uf;

  const montar = (numero: number) =>
    montarNota({
      serie,
      numero,
      codigoNumerico: gerarCodigoNumerico(),
      ambiente: unidade.ambienteFiscal,
      contingencia: false,
      emitente: {
        cnpj,
        razaoSocial: unidade.razaoSocial ?? unidade.nome,
        nomeFantasia: unidade.apelido ?? unidade.nome,
        inscricaoEstadual: unidade.inscricaoEstadual,
        regime: unidade.regimeTributario,
        uf,
        codigoMunicipio: unidade.codigoMunicipioIbge,
        municipio: unidade.cidade,
        logradouro: unidade.logradouro,
        numero: unidade.numero,
        bairro: unidade.bairro,
        cep: unidade.cep,
      },
      destinatario: comanda.cliente?.cpf
        ? { cpf: comanda.cliente.cpf, nome: comanda.cliente.nome }
        : null,
      itens,
      pagamentos,
      desconto: totais.desconto,
      taxaServico: totais.taxaServico,
    });

  /*
   * Gravar primeiro, falar com a SEFAZ depois.
   *
   * A linha é o que reserva o número, e é por isso que ela não pode estourar
   * aqui: o estouro subia por uma função que promete não lançar e a venda
   * ficava sem documento e sem rastro. Esgotar as tentativas é recusa legível,
   * como todo problema fiscal nesta função — nunca venda travada.
   */
  let reservada;
  try {
    reservada = await reservarNota(montar, {
      tenantId: comanda.tenantId,
      unidadeId: unidade.id,
      comandaId,
      serie,
      ambiente: unidade.ambienteFiscal,
      emitidaPorId: usuarioId,
    });
  } catch (e) {
    console.error("Falha ao gravar a nota antes de emitir", e);
    return {
      ok: false,
      motivo: "Não foi possível reservar o número da nota. Reemita pela tela Fiscal.",
    };
  }
  // O outro toque chegou primeiro, e a nota dele é a desta venda.
  if ("jaEmitida" in reservada) {
    return { ok: false, notaId: reservada.jaEmitida, motivo: JA_TEM_NOTA_MOTIVO };
  }
  const { nota, registro } = reservada;

  try {
    const resposta = await (emissor ?? emissorDa(unidade)).emitir(nota);

    switch (resposta.status) {
      case "AUTORIZADA": {
        await db.notaFiscal.update({
          where: { id: registro.id },
          data: {
            status: "AUTORIZADA",
            chaveAcesso: resposta.chaveAcesso,
            protocolo: resposta.protocolo,
            autorizadaEm: resposta.autorizadaEm,
            qrCodeDados: resposta.qrCodeDados,
            urlConsulta: resposta.urlConsulta,
            xml: resposta.xml,
          },
        });

        // A nota está autorizada; se o papel falhar, isso não a desfaz.
        try {
          await enfileirar({
            tenantId: comanda.tenantId,
            unidadeId: unidade.id,
            tipo: "DANFE_NFCE",
            titulo: `NFC-e ${nota.numero}/${serie}`,
            referenciaId: registro.id,
            conteudo: danfeDaNota(nota, {
              autorizadaEm: resposta.autorizadaEm,
              protocolo: resposta.protocolo,
              chaveAcesso: resposta.chaveAcesso,
              qrCodeDados: resposta.qrCodeDados,
              urlConsulta: resposta.urlConsulta,
            }),
          });
        } catch (e) {
          console.error("Falha ao enfileirar DANFE", e);
        }

        return { ok: true, notaId: registro.id, chaveAcesso: resposta.chaveAcesso };
      }

      case "INDISPONIVEL": {
        // SEFAZ fora do ar não é erro do restaurante: a nota fica em
        // contingência e é transmitida quando o serviço voltar — agora existe
        // quem a transmita (`lib/fiscal/contingencia`).
        const offline = emOffline(nota);
        await db.notaFiscal.update({
          where: { id: registro.id },
          data: {
            status: "CONTINGENCIA",
            motivoRejeicao: resposta.motivo,
            chaveAcesso: offline.chave,
            emitida: offline.documento as unknown as Prisma.InputJsonValue,
          },
        });
        await papelDaContingencia(registro, offline.documento, offline.chave);
        return { ok: false, notaId: registro.id, motivo: `Em contingência: ${resposta.motivo}` };
      }

      default:
        await db.notaFiscal.update({
          where: { id: registro.id },
          data: {
            status: resposta.status === "DENEGADA" ? "DENEGADA" : "REJEITADA",
            motivoRejeicao: resposta.motivo,
            tentativas: { increment: 1 },
          },
        });
        return { ok: false, notaId: registro.id, motivo: resposta.motivo };
    }
  } catch (e) {
    /*
     * Estourou no meio da conversa: trata como serviço fora, que é o caso
     * provável (rede, DNS, timeout).
     *
     * Fica um risco conhecido, e ele é do adaptador do gateway, não daqui: se
     * a autorização saiu e só a **resposta** se perdeu, a nota está autorizada
     * na SEFAZ e aqui em contingência. A transmissão de depois mandaria a
     * mesma chave e receberia "duplicidade" — por isso o adaptador precisa
     * consultar pela chave antes de retransmitir. Está anotado em
     * `docs/fiscal.md`; com o emissor simulado não acontece.
     */
    const motivo = e instanceof Error ? e.message : "Falha ao comunicar com o emissor.";
    const offline = emOffline(nota);
    await db.notaFiscal.update({
      where: { id: registro.id },
      data: {
        status: "CONTINGENCIA",
        motivoRejeicao: motivo,
        chaveAcesso: offline.chave,
        emitida: offline.documento as unknown as Prisma.InputJsonValue,
        tentativas: { increment: 1 },
      },
    });
    await papelDaContingencia(registro, offline.documento, offline.chave);
    return { ok: false, notaId: registro.id, motivo };
  }
}

export async function cancelarNfce(notaId: string, motivo: string) {
  const nota = await db.notaFiscal.findUniqueOrThrow({
    where: { id: notaId },
    include: { unidade: true },
  });

  if (nota.status !== "AUTORIZADA") throw new Error("Só é possível cancelar nota autorizada.");
  if (!nota.chaveAcesso) throw new Error("Nota sem chave de acesso.");

  const resposta = await emissorDa(nota.unidade).cancelar(nota.chaveAcesso, motivo);
  if (resposta.status === "RECUSADO") throw new Error(resposta.motivo);

  await db.notaFiscal.update({
    where: { id: notaId },
    data: {
      status: "CANCELADA",
      canceladaEm: resposta.canceladaEm,
      protocoloCancelamento: resposta.protocolo,
      motivoCancelamento: motivo.trim(),
    },
  });
}
