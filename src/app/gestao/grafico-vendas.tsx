import type { DiaDoGrafico } from "@/lib/painel";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function rotuloDia(iso: string) {
  // Monta a data local a partir do ISO para não perder um dia por fuso.
  const [ano, mes, dia] = iso.split("-").map(Number);
  return new Date(ano, mes - 1, dia).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

/**
 * Barras em CSS puro. Uma biblioteca de gráficos aqui custaria ~100kB para
 * desenhar catorze retângulos.
 *
 * A barra é **empilhada**, não duas barras lado a lado: a altura continua sendo
 * o faturamento do dia, e a fatia de cima mostra quanto daquilo foi custo da
 * mercadoria. Lado a lado dobraria o número de colunas — no celular são catorze
 * que já rolam — e ainda sugeriria que lucro e faturamento são grandezas
 * independentes, quando um é parte do outro.
 */
export function GraficoVendas({ dados, comCusto }: { dados: DiaDoGrafico[]; comCusto: boolean }) {
  const maximo = Math.max(...dados.map((d) => d.faturamento), 1);

  /**
   * Em trinta dias a coluna fica com 12px — medido — e "14/09" precisa de 28px.
   * Todos os rótulos viravam uma faixa cinza ilegível. Mostrando um a cada três,
   * sobra espaço para cada um respirar; o último sempre aparece, porque é o dia
   * de hoje e é o que se procura primeiro.
   *
   * O corte é pela contagem de dias, e não pela largura medida, porque isto
   * roda no servidor — não há como perguntar ao navegador quanto coube.
   */
  const passoDoRotulo = dados.length > 16 ? 3 : 1;

  return (
    <>
      {comCusto && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-orange-500" />
            lucro bruto
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-orange-200" />
            custo da mercadoria
          </span>
        </div>
      )}

      {/* Catorze colunas não cabem em 375px: espremidas viram traços sem
          rótulo legível, e a largura mínima delas empurrava a página inteira
          para 537px — o bastante para desancorar a barra fixa do rodapé. No
          celular o gráfico rola dentro do próprio cartão. */}
      {/* O dir="rtl" só serve para a rolagem começar no fim: sem ele o celular
          abre o gráfico nos dias mais antigos e esconde justamente o de hoje. O
          conteúdo volta a ltr logo dentro, então a ordem dos dias não muda. */}
      <div dir="rtl" className="-mx-1 min-w-0 overflow-x-auto px-1">
        {/* 34rem dá ~31px por coluna em catorze dias, o bastante para "14/09"
            caber sem encostar no vizinho. A largura só alonga a rolagem dentro
            do cartão — a página continua em 375px, medido. */}
        <div dir="ltr" className="flex h-56 min-w-[34rem] gap-1.5 sm:min-w-0">
          {dados.map((d, i) => (
            <Coluna
              key={d.dia}
              dia={d}
              maximo={maximo}
              comCusto={comCusto}
              comRotulo={i % passoDoRotulo === 0 || i === dados.length - 1}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function Coluna({
  dia,
  maximo,
  comCusto,
  comRotulo,
}: {
  dia: DiaDoGrafico;
  maximo: number;
  comCusto: boolean;
  comRotulo: boolean;
}) {
  const { faturamento, cmv, lucro } = dia;

  /**
   * Prejuízo no dia não empilha: a fatia de custo seria maior que a barra
   * inteira. A coluna vira vermelha por inteiro, que é o sinal certo — aquele
   * dia vendeu por menos do que custou.
   */
  const noVermelho = comCusto && lucro < 0;

  // A fatia de custo é medida sobre a própria barra, não sobre o máximo do
  // gráfico: é a proporção dentro do dia que interessa ler.
  const fatiaDeCusto = faturamento > 0 ? Math.min(100, (cmv / faturamento) * 100) : 0;

  /**
   * O rótulo que aparece sobre a barra mostra só o faturamento.
   *
   * "R$ 408,01 · lucro R$ 382,81" não cabe em uma coluna de catorze — saía
   * cortado em "· lucr…". A quebra por cima do custo já está desenhada na
   * própria barra; o detalhe em números fica no `title`, que o navegador mostra
   * sem disputar espaço com o gráfico.
   */
  const detalhe = comCusto
    ? `${rotuloDia(dia.dia)} · ${brl.format(faturamento)} de faturamento · ${brl.format(
        cmv
      )} de custo · ${brl.format(lucro)} de lucro`
    : `${rotuloDia(dia.dia)} · ${brl.format(faturamento)} de faturamento`;

  return (
    <div
      className="group flex min-w-0 flex-1 flex-col items-center gap-1.5"
      title={faturamento > 0 ? detalhe : `${rotuloDia(dia.dia)} · sem vendas`}
    >
      <span className="h-3 max-w-full truncate text-[10px] font-semibold tabular-nums text-neutral-500 opacity-0 transition group-hover:opacity-100">
        {faturamento > 0 ? brl.format(faturamento) : ""}
      </span>

      {/* A altura em % só resolve dentro de um pai com altura definida — por
          isso a barra mora neste trilho flex-1, e não solta na coluna. */}
      <div className="flex w-full min-h-0 flex-1 items-end">
        <div
          className={`flex w-full flex-col overflow-hidden rounded-t-md transition ${
            faturamento > 0
              ? noVermelho
                ? "bg-red-500 group-hover:bg-red-700"
                : "bg-orange-500 group-hover:bg-orange-700"
              : "bg-neutral-200"
          }`}
          style={{ height: `${Math.max((faturamento / maximo) * 100, 2)}%` }}
        >
          {comCusto && !noVermelho && fatiaDeCusto > 0 && (
            <div
              className="w-full shrink-0 bg-orange-200"
              style={{ height: `${fatiaDeCusto}%` }}
            />
          )}
        </div>
      </div>

      {/* A altura fica reservada mesmo sem texto: sem ela as colunas com e sem
          rótulo teriam trilhos de alturas diferentes, e as barras desalinhariam
          a base. */}
      <span className="h-4 whitespace-nowrap text-[10px] tabular-nums text-neutral-500">
        {comRotulo ? rotuloDia(dia.dia) : ""}
      </span>
    </div>
  );
}
