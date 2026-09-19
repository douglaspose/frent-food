import "server-only";
import { db } from "../db";
import { CONSUMO } from "../itens";
import { calcularTotais } from "../comanda";
import { enfileirar } from "../fila-impressao";
import { gerarCodigoNumerico } from "./chave";
import { montarDanfe } from "./danfe";
import { EmissorSimulado } from "./emissor-simulado";
import { montarNota, montarPagamento, type ItemDaComanda } from "./montar-nota";
import type { Emissor } from "./tipos";

/**
 * Escolhe quem fala com a SEFAZ. Enquanto só existe o simulado, os gateways
 * caem nele de propósito: melhor uma nota marcada como simulação do que uma
 * integração pela metade fingindo que emitiu.
 */
function emissorDa(unidade: { emissorFiscal: string }): Emissor {
  switch (unidade.emissorFiscal) {
    case "SIMULADO":
    default:
      return new EmissorSimulado();
  }
}

/**
 * Reserva o próximo número da série.
 *
 * A numeração não pode ter buraco nem repetição, e duas comandas fechando ao
 * mesmo tempo disputariam o mesmo número. A transação com leitura do maior
 * número resolve no volume de um restaurante; numa rede grande isso vira uma
 * sequence no Postgres.
 */
async function reservarNumero(unidadeId: string, serie: number) {
  const ultima = await db.notaFiscal.findFirst({
    where: { unidadeId, serie },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });
  return (ultima?.numero ?? 0) + 1;
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
export async function emitirNfce(comandaId: string, usuarioId?: string): Promise<ResultadoEmitir> {
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
    where: { comandaId, status: { in: ["AUTORIZADA", "PROCESSANDO", "CONTINGENCIA"] } },
  });
  // Emitir duas notas para a mesma venda é problema fiscal, não conveniência.
  if (jaEmitida) {
    return { ok: false, notaId: jaEmitida.id, motivo: "Esta comanda já tem nota emitida." };
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
  const numero = await reservarNumero(unidade.id, serie);

  const nota = montarNota({
    serie,
    numero,
    codigoNumerico: gerarCodigoNumerico(),
    ambiente: unidade.ambienteFiscal,
    contingencia: false,
    emitente: {
      cnpj: unidade.cnpj,
      razaoSocial: unidade.razaoSocial ?? unidade.nome,
      nomeFantasia: unidade.apelido ?? unidade.nome,
      inscricaoEstadual: unidade.inscricaoEstadual,
      regime: unidade.regimeTributario,
      uf: unidade.uf,
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

  const registro = await db.notaFiscal.create({
    data: {
      tenantId: comanda.tenantId,
      unidadeId: unidade.id,
      comandaId,
      serie,
      numero,
      ambiente: unidade.ambienteFiscal,
      status: "PROCESSANDO",
      valorTotal: nota.valorTotal,
      emitidaPorId: usuarioId,
    },
  });

  try {
    const resposta = await emissorDa(unidade).emitir(nota);

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
            titulo: `NFC-e ${numero}/${serie}`,
            referenciaId: registro.id,
            conteudo: montarDanfe({
              emitente: {
                razaoSocial: nota.emitente.razaoSocial,
                cnpj: nota.emitente.cnpj,
                endereco: [unidade.logradouro, unidade.numero, unidade.bairro, unidade.cidade]
                  .filter(Boolean)
                  .join(", "),
              },
              numero,
              serie,
              ambiente: unidade.ambienteFiscal,
              autorizadaEm: resposta.autorizadaEm,
              chaveAcesso: resposta.chaveAcesso,
              protocolo: resposta.protocolo,
              qrCodeDados: resposta.qrCodeDados,
              urlConsulta: resposta.urlConsulta,
              itens: nota.itens.map((i) => ({
                descricao: i.descricao,
                quantidade: i.quantidade,
                unidade: i.unidade,
                valorUnitario: i.valorUnitario,
                valorTotal: i.valorTotal,
              })),
              valorProdutos: nota.valorProdutos,
              valorDesconto: nota.valorDesconto,
              valorTotal: nota.valorTotal,
              pagamentos: nota.pagamentos.map((p) => ({
                descricao: p.descricao,
                valor: p.valor,
                troco: p.troco,
              })),
              consumidor: nota.destinatario,
              observacao: nota.informacoesComplementares,
            }),
          });
        } catch (e) {
          console.error("Falha ao enfileirar DANFE", e);
        }

        return { ok: true, notaId: registro.id, chaveAcesso: resposta.chaveAcesso };
      }

      case "INDISPONIVEL":
        // SEFAZ fora do ar não é erro do restaurante: a nota fica em
        // contingência e é transmitida quando o serviço voltar.
        await db.notaFiscal.update({
          where: { id: registro.id },
          data: { status: "CONTINGENCIA", motivoRejeicao: resposta.motivo },
        });
        return { ok: false, notaId: registro.id, motivo: `Em contingência: ${resposta.motivo}` };

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
    const motivo = e instanceof Error ? e.message : "Falha ao comunicar com o emissor.";
    await db.notaFiscal.update({
      where: { id: registro.id },
      data: { status: "CONTINGENCIA", motivoRejeicao: motivo, tentativas: { increment: 1 } },
    });
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
