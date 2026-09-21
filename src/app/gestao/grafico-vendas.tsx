"use client";

import { useState } from "react";
import type { DiaDoGrafico } from "@/lib/painel";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function rotuloDia(iso: string) {
  // Monta a data local a partir do ISO para não perder um dia por fuso.
  const [ano, mes, dia] = iso.split("-").map(Number);
  return new Date(ano!, mes! - 1, dia!).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

/**
 * Barras em CSS puro. Uma biblioteca de gráficos aqui custaria ~100kB para
 * desenhar catorze retângulos.
 *
 * A barra é **empilhada**, não duas lado a lado: a altura é o faturamento do
 * dia, e a fatia de cima mostra quanto daquilo foi custo da mercadoria. Lado a
 * lado dobraria o número de colunas — no celular são catorze que já rolam — e
 * ainda sugeriria que lucro e faturamento são grandezas independentes, quando
 * um é parte do outro.
 *
 * O componente é de cliente por duas razões: o visor do dia em foco e a escolha
 * de mostrar ou não o custo. Ambas são estado de quem está olhando, e nenhuma
 * vale uma ida ao servidor.
 */
export function GraficoVendas({
  dados,
  temCusto,
  destaque,
  janelaMaiorQuePeriodo,
}: {
  dados: DiaDoGrafico[];
  /** Se há custo lançado no período. Sem isso não há o que oferecer. */
  temCusto: boolean;
  /**
   * Os dias que os cartões contaram, quando o gráfico mostra mais que eles.
   *
   * Em "Hoje" o gráfico abre uma semana para a barra não ficar sozinha, mas os
   * números da tela falam de um dia só. Sem marcar qual é, o gráfico passaria a
   * contradizer os cartões em silêncio.
   */
  destaque: { primeiro: string; ultimo: string };
  janelaMaiorQuePeriodo: boolean;
}) {
  /**
   * O custo começa escondido.
   *
   * Quem abre o painel quer saber quanto vendeu; o custo é a segunda pergunta,
   * e deixá-lo sempre à mostra coloca uma faixa clara em cima de toda barra
   * para quem nem perguntou.
   */
  const [mostrarCusto, setMostrarCusto] = useState(false);

  /**
   * O dia sob o cursor, num visor fixo — e não num número dentro da coluna.
   *
   * O valor morava no topo da própria coluna, com `truncate`. De trinta dias
   * para cima a coluna fica com 12px (medido) e "R$ 1.535,60" era cortado até
   * não sobrar nada: passar o mouse não mostrava valor nenhum. Em catorze dias
   * a coluna tem 31px e ainda dava para ler um pedaço, o que fazia o defeito
   * parecer intermitente.
   *
   * Num visor de largura fixa o número cabe em qualquer período. De quebra sai
   * do `group-hover:` do Tailwind, que vive dentro de `@media (hover: hover)` e
   * não existe em aparelho de toque — agora o toque no celular também mostra o
   * valor, o que o hover nunca fez.
   */
  const [emFoco, setEmFoco] = useState<number | null>(null);

  const comCusto = temCusto && mostrarCusto;
  const maximo = Math.max(...dados.map((d) => d.faturamento), 1);
  const foco = emFoco === null ? null : dados[emFoco];

  // Nada a destacar quando o gráfico já é exatamente o período.
  const temContexto = dados.some((d) => d.dia < destaque.primeiro || d.dia > destaque.ultimo);

  /**
   * Em trinta dias a coluna fica com 12px — medido — e "14/09" precisa de 28px.
   * Todos os rótulos viravam uma faixa cinza ilegível. Mostrando um a cada três,
   * sobra espaço para cada um respirar; o último sempre aparece, porque é o dia
   * mais recente e é o que se procura primeiro.
   */
  const passoDoRotulo = dados.length > 16 ? 3 : 1;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 className="text-sm font-semibold">
          {comCusto ? "Faturamento e lucro por dia" : "Faturamento por dia"}
          {janelaMaiorQuePeriodo && (
            <span className="ml-2 font-normal text-neutral-500">
              últimos {dados.length} dias, com o período escolhido em destaque
            </span>
          )}
        </h2>

        {temCusto && (
          <label className="realce-ao-toque flex cursor-pointer touch-manipulation items-center gap-2 text-xs text-neutral-600">
            <input
              type="checkbox"
              checked={mostrarCusto}
              onChange={(e) => setMostrarCusto(e.target.checked)}
              className="h-3.5 w-3.5 accent-orange-500"
            />
            mostrar custo da mercadoria
          </label>
        )}
      </div>

      {/*
        Legenda e visor dividem a linha, e ela existe mesmo vazia: sem altura
        reservada o gráfico pulava para cima e para baixo conforme o cursor
        entrava e saía das barras.
      */}
      <div className="mb-2 flex min-h-5 flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
        <div className="flex items-center gap-x-4">
          {comCusto && (
            <>
              {/* Na ordem em que aparecem na barra, de cima para baixo. */}
              <span className="flex items-center gap-1.5 text-neutral-500">
                <span className="h-2.5 w-2.5 rounded-sm bg-orange-500" />
                lucro bruto
              </span>
              <span className="flex items-center gap-1.5 text-neutral-500">
                <span className="h-2.5 w-2.5 rounded-sm bg-orange-900" />
                custo da mercadoria
              </span>
            </>
          )}
        </div>

        {foco && (
          <p className="tabular-nums text-neutral-700">
            <strong className="font-semibold">{rotuloDia(foco.dia)}</strong>
            {" · "}
            {brl.format(foco.faturamento)}
            {comCusto && foco.faturamento > 0 && (
              <>
                <span className="text-neutral-500"> · custo </span>
                {brl.format(foco.cmv)}
                <span className="text-neutral-500"> · lucro </span>
                {brl.format(foco.lucro)}
              </>
            )}
          </p>
        )}
      </div>

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
        <div
          dir="ltr"
          className="flex h-56 min-w-[34rem] gap-1.5 sm:min-w-0"
          onMouseLeave={() => setEmFoco(null)}
        >
          {dados.map((d, i) => (
            <Coluna
              key={d.dia}
              dia={d}
              maximo={maximo}
              comCusto={comCusto}
              comRotulo={i % passoDoRotulo === 0 || i === dados.length - 1}
              apagada={temContexto && (d.dia < destaque.primeiro || d.dia > destaque.ultimo)}
              emFoco={emFoco === i}
              aoFocar={() => setEmFoco(i)}
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
  apagada,
  emFoco,
  aoFocar,
}: {
  dia: DiaDoGrafico;
  maximo: number;
  comCusto: boolean;
  comRotulo: boolean;
  /** Dia que está no gráfico só como contexto, fora do período dos cartões. */
  apagada: boolean;
  emFoco: boolean;
  aoFocar: () => void;
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

  const detalhe = comCusto
    ? `${rotuloDia(dia.dia)} · ${brl.format(faturamento)} de faturamento · ${brl.format(
        cmv
      )} de custo · ${brl.format(lucro)} de lucro`
    : `${rotuloDia(dia.dia)} · ${brl.format(faturamento)} de faturamento`;

  return (
    <div
      /*
        Opacidade, e não outra cor, para o dia de contexto: a barra continua
        sendo a mesma grandeza, só não está no período. Uma cor nova pediria
        mais uma entrada na legenda para dizer a mesma coisa.
      */
      className={`group flex min-w-0 flex-1 cursor-default flex-col items-center gap-1.5 ${
        apagada && !emFoco ? "opacity-40" : ""
      }`}
      /*
        `onClick` além do mouse: no celular não há cursor, e o toque é a única
        forma de perguntar quanto foi aquele dia.
      */
      onMouseEnter={aoFocar}
      onClick={aoFocar}
      title={
        (faturamento > 0 ? detalhe : `${rotuloDia(dia.dia)} · sem vendas`) +
        (apagada ? " · fora do período escolhido" : "")
      }
    >
      {/* A altura fica reservada mesmo sem texto, senão as barras desalinham a
          base entre colunas com e sem rótulo. */}
      <span className="h-3" />

      {/* A altura em % só resolve dentro de um pai com altura definida — por
          isso a barra mora neste trilho flex-1, e não solta na coluna. */}
      <div className="flex w-full min-h-0 flex-1 items-end">
        {/*
          O custo fica **embaixo**, em tom escuro, e não numa faixa clara em
          cima. Faixa pálida no topo de uma barra colorida é o desenho de uma
          barra de progresso: o olho lê "laranja = 63% preenchido" em vez de
          "laranja = lucro, claro = custo", e o custo parecia o fundo da barra.
          Escuro na base, lê-se de baixo para cima — custou tanto, sobrou tanto.
        */}
        <div
          className={`flex w-full flex-col overflow-hidden rounded-t-md transition ${
            faturamento > 0
              ? noVermelho
                ? emFoco
                  ? "bg-red-700"
                  : "bg-red-500"
                : emFoco
                  ? "bg-orange-700"
                  : "bg-orange-500"
              : "bg-neutral-200"
          }`}
          style={{ height: `${Math.max((faturamento / maximo) * 100, 2)}%` }}
        >
          {comCusto && !noVermelho && fatiaDeCusto > 0 && (
            <div
              className="mt-auto w-full shrink-0 bg-orange-900"
              style={{ height: `${fatiaDeCusto}%` }}
            />
          )}
        </div>
      </div>

      <span
        className={`h-4 whitespace-nowrap text-[10px] tabular-nums ${
          emFoco ? "font-semibold text-neutral-900" : "text-neutral-500"
        }`}
      >
        {comRotulo || emFoco ? rotuloDia(dia.dia) : ""}
      </span>
    </div>
  );
}
