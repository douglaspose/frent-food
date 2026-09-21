import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { sessaoDaTela, temPermissao } from "@/lib/session";
import { MesasTela } from "./mesas-tela";

export const metadata: Metadata = { title: "Mesas e áreas" };
export const dynamic = "force-dynamic";

export default async function MesasPage() {
  const sessao = await sessaoDaTela();

  const areas = await db.area.findMany({
    where: { unidadeId: sessao.unidadeId },
    orderBy: { ordem: "asc" },
    include: {
      mesas: { orderBy: { numero: "asc" } },
    },
  });

  // Mesa sem área existe: ela some do mapa (que agrupa por área), então
  // precisa aparecer aqui para o dono poder consertar.
  const semArea = await db.mesa.findMany({
    where: { unidadeId: sessao.unidadeId, areaId: null },
    orderBy: { numero: "asc" },
  });

  const semQr = await db.mesa.count({
    where: { unidadeId: sessao.unidadeId, qrToken: null },
  });

  const mapear = (mesas: (typeof semArea)[number][]) =>
    mesas
      // numero é texto (mesas podem se chamar "12A"), então ordena pelo valor
      // numérico antes de cair no alfabético.
      .sort((a, b) => Number(a.numero) - Number(b.numero) || a.numero.localeCompare(b.numero))
      .map((m) => ({
        id: m.id,
        numero: m.numero,
        capacidade: m.capacidade,
        status: m.status,
        ativo: m.ativo,
        areaId: m.areaId ?? "",
        temQr: Boolean(m.qrToken),
      }));

  return (
    <MesasTela
      podeEditar={temPermissao(sessao, "produto.editar")}
      semQr={semQr}
      areas={areas.map((a) => ({
        id: a.id,
        nome: a.nome,
        ativo: a.ativo,
        mesas: mapear(a.mesas),
      }))}
      mesasSemArea={mapear(semArea)}
      rodape={
        <Link href="/gestao/mesas/qrcodes" className="text-orange-600 hover:text-orange-700">
          Imprimir folha de QR Codes
        </Link>
      }
    />
  );
}
