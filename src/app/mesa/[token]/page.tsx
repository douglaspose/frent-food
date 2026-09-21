import type { Metadata } from "next";
import { logomarcaDoTenant } from "@/lib/logomarca";
import { FUNDO_ESCURO } from "@/lib/marca";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ChamarGarcom } from "./chamar-garcom";

export const metadata: Metadata = { title: "Mesa" };
export const dynamic = "force-dynamic";

/**
 * Página do QR fixo da mesa — a única rota pública do sistema.
 *
 * O cliente aponta a câmera e chama o garçom sem precisar levantar a mão nem
 * instalar nada. O token identifica a mesa; nada aqui exige login, e nada aqui
 * revela valor de conta ou dado de outra mesa.
 */
export default async function MesaPublicaPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const mesa = await db.mesa.findUnique({
    where: { qrToken: token },
    select: {
      id: true,
      numero: true,
      ativo: true,
      unidade: { select: { nome: true, tenantId: true } },
      comandas: {
        where: { status: { in: ["ABERTA", "FECHANDO"] } },
        select: { id: true, chamadoGarcomEm: true },
        take: 1,
      },
    },
  });

  if (!mesa?.ativo) notFound();

  const comanda = mesa.comandas[0];
  // A tela do cliente é preta: a versão que serve aqui é a de fundo escuro.
  const marca = await logomarcaDoTenant(mesa.unidade.tenantId, FUNDO_ESCURO);

  return (
    <main className="flex min-h-tela flex-col items-center justify-center bg-neutral-950 px-6 text-center text-neutral-100">
      {/*
        A marca da casa acima do número da mesa. Esta é a única tela que quem
        não trabalha aqui vê — o nome em letra miúda cumpria a função, mas a
        logo é o que o cliente reconhece.
      */}
      {marca?.src ? (
        <span
          className={`mb-4 flex items-center ${marca.corDeFundo ? "rounded-xl px-6 py-4" : ""}`}
          style={marca.corDeFundo ? { backgroundColor: marca.corDeFundo } : undefined}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={marca.src} alt={marca.nome} className="max-h-28 max-w-[18rem] object-contain" />
        </span>
      ) : (
        <p className="text-sm uppercase tracking-widest text-neutral-500">{mesa.unidade.nome}</p>
      )}
      <h1 className="mt-2 text-5xl font-bold">Mesa {mesa.numero}</h1>

      {comanda ? (
        <ChamarGarcom token={token} jaChamou={Boolean(comanda.chamadoGarcomEm)} />
      ) : (
        <p className="mt-10 max-w-xs text-neutral-400">
          Esta mesa ainda não foi aberta. Chame um atendente para começar.
        </p>
      )}
    </main>
  );
}
