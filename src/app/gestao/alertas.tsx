import Link from "next/link";
import type { Alerta } from "@/lib/painel";

/**
 * Os alertas operacionais, no topo da tela.
 *
 * Ficam antes dos números de propósito: são tarefas, não leitura. Quem abre o
 * painel de manhã precisa ver "o caixa de ontem continua aberto" antes de
 * admirar o faturamento da semana.
 *
 * Cada um termina num link para o lugar onde se resolve. Alerta sem destino
 * obriga o dono a caçar a tela certa, e é assim que ele aprende a ignorar o
 * aviso.
 */
export function Alertas({ itens }: { itens: Alerta[] }) {
  // Nada a dizer é uma boa notícia, e não merece um cartão vazio ocupando o
  // topo da tela todo dia em que estiver tudo certo.
  if (itens.length === 0) return null;

  return (
    <ul className="mt-4 space-y-2">
      {itens.map((a) => (
        <li
          key={a.chave}
          className={`flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg px-4 py-3 text-sm ${
            a.nivel === "grave" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-800"
          }`}
        >
          <span>{a.texto}</span>
          <Link href={a.link.href} className="font-semibold underline underline-offset-2">
            {a.link.rotulo}
          </Link>
        </li>
      ))}
    </ul>
  );
}
