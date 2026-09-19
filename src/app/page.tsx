import Link from "next/link";
import { redirect } from "next/navigation";
import { lerSessao } from "@/lib/session";

/**
 * Seleção de ambiente. Cada função do restaurante vive numa tela própria —
 * o garçom não navega pela gestão, a cozinha não vê faturamento.
 */
const AMBIENTES = [
  {
    href: "/pdv",
    nome: "Frente de Loja",
    descricao: "Mesas, comandas e atendimento",
  },
  {
    href: "/kds",
    nome: "Cozinha",
    descricao: "Pedidos em preparo por estação",
  },
  {
    href: "/gestao",
    nome: "Gestão",
    descricao: "Painel, cardápio, produtos e equipe",
  },
];

export default async function Home() {
  const sessao = await lerSessao();
  if (!sessao) redirect("/login");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-950 px-6 text-neutral-100">
      <h1 className="text-2xl font-bold tracking-tight">Gestão de Restaurantes</h1>
      <p className="mt-1 text-sm text-neutral-500">Selecione o ambiente</p>

      <div className="mt-10 w-full max-w-sm space-y-3">
        {AMBIENTES.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="flex items-center gap-4 rounded-xl border border-neutral-800 bg-neutral-900 px-5 py-4 transition hover:border-orange-600 hover:bg-neutral-800"
          >
            <span className="h-10 w-10 shrink-0 rounded-lg bg-orange-600" />
            <span>
              <span className="block font-semibold">{a.nome}</span>
              <span className="block text-sm text-neutral-500">{a.descricao}</span>
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
