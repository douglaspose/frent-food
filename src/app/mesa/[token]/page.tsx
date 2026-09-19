import type { Metadata } from "next";
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
      unidade: { select: { nome: true } },
      comandas: {
        where: { status: { in: ["ABERTA", "FECHANDO"] } },
        select: { id: true, chamadoGarcomEm: true },
        take: 1,
      },
    },
  });

  if (!mesa?.ativo) notFound();

  const comanda = mesa.comandas[0];

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-950 px-6 text-center text-neutral-100">
      <p className="text-sm uppercase tracking-widest text-neutral-500">{mesa.unidade.nome}</p>
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
