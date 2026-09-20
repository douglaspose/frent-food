import type { Metadata } from "next";
import { db } from "@/lib/db";
import { centavos } from "@/lib/comanda";
import { redirect } from "next/navigation";
import { exigirSessao, temAlgumaPermissao, temPermissao } from "@/lib/session";
import { PERMISSOES_DO_CAIXA } from "@/lib/caixa";
import { dadosDaBarra } from "@/lib/barra";
import { BarraAmbientes } from "../barra-ambientes";
import { CaixaPainel } from "./caixa-painel";

export const metadata: Metadata = { title: "Caixa" };
export const dynamic = "force-dynamic";

export default async function CaixaPage() {
  const sessao = await exigirSessao();

  /**
   * Esconder o botão não é segurança — é conveniência.
   *
   * Quem não opera o caixa também não entra pela URL: a tela mostra o dinheiro
   * que está na gaveta agora e as sangrias do turno.
   */
  if (!temAlgumaPermissao(sessao, PERMISSOES_DO_CAIXA)) redirect("/pdv");

  const unidade = await db.unidade.findFirst({ where: { id: sessao.unidadeId } });
  if (!unidade) {
    return (
      <main className="flex min-h-tela items-center justify-center text-neutral-400">
        Nenhuma unidade encontrada.
      </main>
    );
  }

  const caixa = await db.caixa.findFirst({
    where: { unidadeId: unidade.id, tipo: "GERAL", status: "ABERTO" },
    include: {
      abertoPor: { select: { nome: true } },
      pagamentos: { include: { formaPagamento: { select: { nome: true, tipo: true } } } },
      movimentos: {
        orderBy: { criadoEm: "desc" },
        include: { usuario: { select: { nome: true } } },
      },
    },
  });

  const comandasAbertas = await db.comanda.count({
    where: { unidadeId: unidade.id, status: { in: ["ABERTA", "FECHANDO"] } },
  });

  if (!caixa) {
    return (
      <>
        <BarraAmbientes dados={await dadosDaBarra(sessao)} />
        <main className="mx-auto flex max-w-md flex-col justify-center px-6 pt-16 pb-28 sm:pb-16">
        <h1 className="texto-tela">Caixa fechado</h1>
        <p className="texto-apoio mt-1 text-neutral-500">{unidade.nome}</p>
          <CaixaPainel
            unidadeId={unidade.id}
            caixa={null}
            comandasAbertas={comandasAbertas}
            podeOperar={temPermissao(sessao, "caixa.abrir")}
          />
        </main>
      </>
    );
  }

  // Agrupa o recebido por forma de pagamento — é o que o operador confere ao fechar.
  const porForma = new Map<string, { nome: string; tipo: string; valor: number }>();
  for (const p of caixa.pagamentos) {
    const chave = p.formaPagamentoId;
    const atual = porForma.get(chave);
    const liquido = Number(p.valor) - Number(p.troco);
    porForma.set(chave, {
      nome: p.formaPagamento.nome,
      tipo: p.formaPagamento.tipo,
      valor: centavos((atual?.valor ?? 0) + liquido),
    });
  }

  return (
    <>
      <BarraAmbientes dados={await dadosDaBarra(sessao)} />
      <main className="mx-auto max-w-2xl px-6 pt-8 pb-28 sm:pb-8">
      <h1 className="texto-tela">Caixa aberto</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Turno {caixa.turno.toLowerCase()} · aberto por {caixa.abertoPor.nome} ·{" "}
        {caixa.abertoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
      </p>

      <CaixaPainel
        unidadeId={unidade.id}
        comandasAbertas={comandasAbertas}
        podeOperar={temPermissao(sessao, "caixa.fechar")}
        podeMovimentar={temPermissao(sessao, "caixa.sangria")}
        caixa={{
          id: caixa.id,
          turno: caixa.turno,
          fundoCaixa: Number(caixa.fundoCaixa),
          recebidoPorForma: [...porForma.values()],
          movimentos: caixa.movimentos.map((m) => ({
            id: m.id,
            tipo: m.tipo,
            valor: Number(m.valor),
            descricao: m.descricao,
            usuario: m.usuario.nome,
            criadoEm: m.criadoEm.toISOString(),
          })),
          }}
        />
      </main>
    </>
  );
}
