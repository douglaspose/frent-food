const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 2,
});

/** Campos que são dinheiro. Ler "1750" onde se esperava R$ 17,50 atrapalha. */
const EM_REAIS = new Set([
  "valor",
  "preco",
  "troco",
  "valorApurado",
  "valorInformado",
  "divergencia",
]);

const ROTULOS: Record<string, string> = {
  valor: "valor",
  preco: "preço",
  pct: "taxa",
  motivo: "motivo",
  autorizadoPor: "autorizado por",
  ajuste: "ajuste",
  mesa: "mesa",
  comanda: "comanda",
  status: "status",
  estavaEm: "estava em",
  quantidade: "quantidade",
  turno: "turno",
  descricao: "descrição",
  nome: "nome",
  email: "e-mail",
  ativo: "ativo",
  titulo: "produto",
  cargo: "cargo",
  trocouSenha: "trocou a senha",
  trocouPin: "trocou o PIN",
  valorApurado: "apurado",
  valorInformado: "contado",
  divergencia: "diferença",
  troco: "troco",
};

function texto(chave: string, valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (typeof valor === "boolean") return valor ? "sim" : "não";
  if (typeof valor === "number") {
    if (EM_REAIS.has(chave)) return brl.format(valor);
    if (chave === "pct") return `${valor}%`;
    return String(valor);
  }
  return String(valor);
}

type Json = unknown;

function objeto(valor: Json): Record<string, unknown> | null {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) return null;
  return valor as Record<string, unknown>;
}

/**
 * Mostra o que mudou, não o JSON cru.
 *
 * O `antes`/`depois` existe para responder "de quanto para quanto?". Despejar
 * `{"valor":0,"motivo":null}` na tela devolve a pergunta para quem perguntou.
 */
export function Detalhe({ antes, depois }: { antes: Json; depois: Json }) {
  const a = objeto(antes);
  const d = objeto(depois);

  if (!a && !d) return <span className="text-neutral-500">—</span>;

  // Campos do "depois" primeiro, que é o estado que interessa; os que só
  // existem no "antes" (um pagamento estornado, por exemplo) vêm depois.
  const chaves = [...new Set([...Object.keys(d ?? {}), ...Object.keys(a ?? {})])];

  return (
    <ul className="space-y-0.5">
      {chaves.map((chave) => {
        // Ids internos não dizem nada para quem lê; servem para rastrear.
        if (chave.endsWith("Id")) return null;

        const temAntes = a && chave in a;
        const temDepois = d && chave in d;
        const mudou = temAntes && temDepois && texto(chave, a[chave]) !== texto(chave, d[chave]);

        return (
          <li key={chave}>
            <span className="text-neutral-500">{ROTULOS[chave] ?? chave}: </span>
            {mudou ? (
              <>
                <span className="text-neutral-500 line-through">{texto(chave, a[chave])}</span>
                <span className="text-neutral-500"> → </span>
                <span className="font-medium text-neutral-900">{texto(chave, d[chave])}</span>
              </>
            ) : (
              <span className={temDepois ? "font-medium text-neutral-900" : ""}>
                {texto(chave, temDepois ? d[chave] : a?.[chave])}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
