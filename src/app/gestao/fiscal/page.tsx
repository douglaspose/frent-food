import type { Metadata } from "next";
import { db } from "@/lib/db";
import { sessaoDaTela, temPermissao } from "@/lib/session";
import { resumoDaContingencia } from "@/lib/fiscal/contingencia";
import { FiscalTela } from "./fiscal-tela";

export const metadata: Metadata = { title: "Fiscal" };
export const dynamic = "force-dynamic";

export default async function FiscalPage() {
  const sessao = await sessaoDaTela();

  const [unidade, perfis, notas, produtosSemPerfil] = await Promise.all([
    db.unidade.findUniqueOrThrow({ where: { id: sessao.unidadeId } }),
    db.perfilFiscal.findMany({
      where: { unidadeId: sessao.unidadeId },
      orderBy: [{ padrao: "desc" }, { nome: "asc" }],
      include: { _count: { select: { produtos: true } } },
    }),
    db.notaFiscal.findMany({
      where: { unidadeId: sessao.unidadeId },
      orderBy: { criadoEm: "desc" },
      take: 50,
      include: { comanda: { select: { id: true, numero: true, mesa: { select: { numero: true } } } } },
    }),
    db.produto.count({ where: { tenantId: sessao.tenantId, ativo: true, perfilFiscalId: null } }),
  ]);

  /*
   * Quantas notas a SEFAZ não recebeu, e desde quando.
   *
   * É o aviso mais caro desta tela: nota emitida offline tem prazo legal para
   * ser transmitida, e antes disto existir ela ficava parada sem ninguém saber.
   */
  const contingencia = await resumoDaContingencia(sessao);

  // Produto sem NCM é rejeição garantida — melhor avisar antes do movimento.
  const produtosSemNcm = await db.produto.count({
    where: { tenantId: sessao.tenantId, ativo: true, tipo: "VENDA", OR: [{ ncm: null }, { ncm: "" }] },
  });

  return (
    <FiscalTela
      podeEditar={temPermissao(sessao, "unidade.configurar")}
      contingencia={contingencia}
      produtosSemPerfil={produtosSemPerfil}
      produtosSemNcm={produtosSemNcm}
      unidade={{
        nome: unidade.nome,
        cnpj: unidade.cnpj,
        uf: unidade.uf,
        emissor: unidade.emissorFiscal,
        temCsc: Boolean(unidade.csc),
        temToken: Boolean(unidade.tokenEmissor),
        config: {
          inscricaoEstadual: unidade.inscricaoEstadual ?? "",
          regimeTributario: unidade.regimeTributario,
          serieNfce: unidade.serieNfce,
          ambienteFiscal: unidade.ambienteFiscal,
          emiteNfce: unidade.emiteNfce,
          cscId: unidade.cscId ?? "",
          csc: "",
          tokenEmissor: "",
        },
      }}
      perfis={perfis.map((p) => ({
        id: p.id,
        nome: p.nome,
        cfop: p.cfop,
        origemMercadoria: p.origemMercadoria,
        csosn: p.csosn,
        cstIcms: p.cstIcms,
        aliquotaIcms: Number(p.aliquotaIcms),
        cstPis: p.cstPis,
        aliquotaPis: Number(p.aliquotaPis),
        cstCofins: p.cstCofins,
        aliquotaCofins: Number(p.aliquotaCofins),
        padrao: p.padrao,
        produtos: p._count.produtos,
      }))}
      notas={notas.map((n) => ({
        id: n.id,
        numero: n.numero,
        serie: n.serie,
        status: n.status,
        ambiente: n.ambiente,
        valorTotal: Number(n.valorTotal),
        chaveAcesso: n.chaveAcesso,
        motivoRejeicao: n.motivoRejeicao,
        criadoEm: n.criadoEm.toISOString(),
        mesa: n.comanda?.mesa?.numero ?? null,
        comandaId: n.comanda?.id ?? null,
        comandaNumero: n.comanda?.numero ?? null,
      }))}
    />
  );
}
