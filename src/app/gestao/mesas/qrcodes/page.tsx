import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { sessaoDaTela } from "@/lib/session";
import { BotaoImprimir } from "./botao-imprimir";

export const metadata: Metadata = { title: "QR Codes das mesas" };
export const dynamic = "force-dynamic";

/**
 * Endereço que vai dentro do QR.
 *
 * Em produção vem de NEXT_PUBLIC_APP_URL: o adesivo fica colado na mesa por
 * meses, e um QR apontando para `localhost` viraria lixo impresso.
 */
async function baseUrl() {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const cabecalhos = await headers();
  const host = cabecalhos.get("host") ?? "localhost:3001";
  const protocolo = host.startsWith("localhost") ? "http" : "https";
  return `${protocolo}://${host}`;
}

export default async function QrCodesPage() {
  const sessao = await sessaoDaTela();

  const [unidade, mesas] = await Promise.all([
    db.unidade.findUniqueOrThrow({
      where: { id: sessao.unidadeId },
      select: { nome: true },
    }),
    db.mesa.findMany({
      where: { unidadeId: sessao.unidadeId, ativo: true, qrToken: { not: null } },
      select: { id: true, numero: true, qrToken: true, area: { select: { nome: true } } },
    }),
  ]);

  const base = await baseUrl();

  const cartoes = await Promise.all(
    mesas
      .sort((a, b) => Number(a.numero) - Number(b.numero) || a.numero.localeCompare(b.numero))
      .map(async (mesa) => ({
        id: mesa.id,
        numero: mesa.numero,
        area: mesa.area?.nome ?? null,
        // SVG inline: imprime nítido em qualquer resolução, ao contrário de PNG.
        svg: await QRCode.toString(`${base}/mesa/${mesa.qrToken}`, {
          type: "svg",
          margin: 1,
          // Correção alta: o adesivo vai viver numa mesa de restaurante, com
          // gordura, respingo e canto amassado.
          errorCorrectionLevel: "H",
        }),
      }))
  );

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">QR Codes das mesas</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {cartoes.length} mesa(s) · recorte e cole em cada mesa
          </p>
        </div>
        <span className="flex gap-4 text-sm">
          <Link href="/gestao/mesas" className="text-neutral-500 hover:text-neutral-900">
            ← Mesas
          </Link>
          <BotaoImprimir />
        </span>
      </div>

      {cartoes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 py-16 text-center text-sm text-neutral-500 print:hidden">
          Nenhuma mesa ativa com QR Code. Gere os códigos na tela de mesas.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 print:grid-cols-3 print:gap-2">
          {cartoes.map((cartao) => (
            <div
              key={cartao.id}
              // break-inside-avoid impede o cartão ser partido entre páginas.
              className="flex break-inside-avoid flex-col items-center rounded-xl border border-neutral-300 bg-white p-4 text-center"
            >
              <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
                {unidade.nome}
              </p>
              <p className="mt-1 text-3xl font-bold leading-none">Mesa {cartao.numero}</p>
              {cartao.area && (
                <p className="text-[10px] uppercase tracking-wide text-neutral-500">
                  {cartao.area}
                </p>
              )}

              <div
                className="mt-3 w-full max-w-[9rem] [&>svg]:h-auto [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: cartao.svg }}
              />

              <p className="mt-3 text-sm font-semibold">Aponte a câmera</p>
              <p className="text-xs text-neutral-500">para chamar o garçom</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
