/**
 * O período que o painel está olhando, e contra qual ele se compara.
 *
 * Vive fora da página porque é conta, não tela: dá para testar sem navegador,
 * e é o tipo de coisa que erra por um dia e ninguém percebe até o fechamento
 * do mês não bater.
 *
 * O fim é **exclusivo** em todos os intervalos. Consulta de faturamento vira
 * `gte: inicio, lt: fim`, e assim o pagamento das 23h59 do último dia entra
 * sem precisar de `23:59:59.999` — que é onde mora o bug clássico de relatório
 * que perde as últimas vendas do dia.
 */

export const PERIODOS = {
  hoje: "Hoje",
  ontem: "Ontem",
  "7": "Últimos 7 dias",
  "14": "Últimos 14 dias",
  "30": "Últimos 30 dias",
  mes: "Este mês",
  "mes-anterior": "Mês anterior",
  personalizado: "Personalizado",
} as const;

export type ChaveDePeriodo = keyof typeof PERIODOS;

/**
 * A ordem em que os atalhos aparecem na barra.
 *
 * Escrita à mão porque o objeto acima **não** a preserva: o JavaScript trata
 * `"7"`, `"14"` e `"30"` como índices de array e os move para a frente, então
 * iterar `PERIODOS` punha "Últimos 7 dias" antes de "Hoje". Um teste guarda
 * esta lista contra a de cima para que um período novo não fique de fora.
 */
export const ORDEM_DOS_ATALHOS = [
  "hoje",
  "ontem",
  "7",
  "14",
  "30",
  "mes",
  "mes-anterior",
] as const satisfies readonly ChaveDePeriodo[];

/**
 * O que o painel mostra quando ninguém escolheu nada.
 *
 * "Hoje" porque quem abre o painel no meio do turno quer saber como está
 * indo agora, e não a média das duas semanas — que é a pergunta do fim do mês,
 * e essa se faz escolhendo. O gráfico não fica com uma barra só: ele tem piso
 * de uma semana, com o dia de hoje em destaque.
 *
 * Vale também como destino de erro: período desconhecido, data impossível ou
 * personalizado sem datas caem aqui.
 */
export const PERIODO_PADRAO: ChaveDePeriodo = "hoje";

export type Intervalo = {
  inicio: Date;
  /** Exclusivo. */
  fim: Date;
};

export type Periodo = {
  chave: ChaveDePeriodo;
  rotulo: string;
  atual: Intervalo;
  anterior: Intervalo;
  /** Como o período anterior é descrito na tela, ao lado da variação. */
  rotuloDaComparacao: string;
  /** Dias inteiros que o intervalo cobre, para montar o gráfico. */
  dias: number;
  /** Só preenchidos no personalizado, para devolver ao formulário. */
  de?: string;
  ate?: string;
};

const UM_DIA = 24 * 60 * 60 * 1000;

function meiaNoite(base: Date, somarDias = 0) {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + somarDias);
  return d;
}

function primeiroDoMes(base: Date, somarMeses = 0) {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  d.setMonth(d.getMonth() + somarMeses);
  return d;
}

/**
 * Dias inteiros entre duas meias-noites.
 *
 * Arredonda porque o horário de verão faz um dia ter 23 ou 25 horas, e a
 * divisão crua devolveria 6,96 dias para uma semana — que vira 6 no piso e
 * some com uma coluna do gráfico uma vez por ano.
 */
function diasEntre(inicio: Date, fim: Date) {
  return Math.max(1, Math.round((fim.getTime() - inicio.getTime()) / UM_DIA));
}

/** A janela de mesma duração que termina exatamente onde a atual começa. */
function janelaAnterior(atual: Intervalo): Intervalo {
  const duracao = atual.fim.getTime() - atual.inicio.getTime();
  return { inicio: new Date(atual.inicio.getTime() - duracao), fim: new Date(atual.inicio) };
}

/** "2026-09-20" → meia-noite local daquele dia, ou null se não for uma data. */
function lerData(texto: string | undefined): Date | null {
  if (!texto) return null;
  const casa = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!casa) return null;

  const [, ano, mes, dia] = casa.map(Number);
  const d = new Date(ano, mes - 1, dia);
  // Rejeita 2026-02-31, que o Date aceitaria virando 3 de março.
  const bate = d.getFullYear() === ano && d.getMonth() === mes - 1 && d.getDate() === dia;
  return bate ? d : null;
}

export function comoTexto(data: Date) {
  const doisDigitos = (n: number) => String(n).padStart(2, "0");
  return `${data.getFullYear()}-${doisDigitos(data.getMonth() + 1)}-${doisDigitos(data.getDate())}`;
}

export function lerPeriodo(
  params: { periodo?: string; de?: string; ate?: string },
  agora = new Date()
): Periodo {
  const chave: ChaveDePeriodo =
    params.periodo && params.periodo in PERIODOS
      ? (params.periodo as ChaveDePeriodo)
      : PERIODO_PADRAO;

  const montar = (
    atual: Intervalo,
    anterior: Intervalo,
    rotuloDaComparacao: string,
    extras: { de?: string; ate?: string } = {}
  ): Periodo => ({
    chave,
    rotulo: PERIODOS[chave],
    atual,
    anterior,
    rotuloDaComparacao,
    dias: diasEntre(atual.inicio, atual.fim),
    ...extras,
  });

  if (chave === "hoje") {
    const atual = { inicio: meiaNoite(agora), fim: meiaNoite(agora, 1) };
    return montar(atual, janelaAnterior(atual), "ontem");
  }

  if (chave === "ontem") {
    const atual = { inicio: meiaNoite(agora, -1), fim: meiaNoite(agora) };
    return montar(atual, janelaAnterior(atual), "anteontem");
  }

  if (chave === "mes") {
    /**
     * Mês corrente compara com o **mesmo trecho** do mês anterior, não com o
     * mês inteiro.
     *
     * No dia 3, comparar três dias contra trinta mostraria uma queda de 90%
     * todo começo de mês — um número que só assusta e não informa. Começando
     * no dia 1º do mês passado e andando a mesma duração, a comparação é de
     * igual para igual.
     */
    const inicio = primeiroDoMes(agora);
    const atual = { inicio, fim: meiaNoite(agora, 1) };
    const duracao = atual.fim.getTime() - atual.inicio.getTime();
    const inicioAnterior = primeiroDoMes(agora, -1);
    const anterior = {
      inicio: inicioAnterior,
      fim: new Date(inicioAnterior.getTime() + duracao),
    };
    return montar(atual, anterior, "mesmo período do mês anterior");
  }

  if (chave === "mes-anterior") {
    // Mês fechado contra mês fechado: aqui os dois são inteiros, e comparar
    // fevereiro com janeiro por mês cheio é o que se espera de um fechamento.
    const atual = { inicio: primeiroDoMes(agora, -1), fim: primeiroDoMes(agora) };
    const anterior = { inicio: primeiroDoMes(agora, -2), fim: primeiroDoMes(agora, -1) };
    return montar(atual, anterior, "mês retrasado");
  }

  if (chave === "personalizado") {
    const um = lerData(params.de);
    const outro = lerData(params.ate);

    // Sem datas válidas o personalizado não tem o que mostrar: cai no padrão
    // em vez de devolver uma tela vazia sem explicação.
    if (!um || !outro) return lerPeriodo({ periodo: PERIODO_PADRAO }, agora);

    // Invertidas, troca em silêncio: quem digitou de trás para frente quer o
    // intervalo entre as duas datas, não um erro.
    const [de, ate] = um <= outro ? [um, outro] : [outro, um];
    const atual = { inicio: de, fim: meiaNoite(ate, 1) };
    return montar(atual, janelaAnterior(atual), "período anterior de mesma duração", {
      de: comoTexto(de),
      ate: comoTexto(ate),
    });
  }

  // As faixas em dias incluem hoje: "últimos 7 dias" é hoje e os seis de trás.
  const dias = Number(chave);
  const atual = { inicio: meiaNoite(agora, -(dias - 1)), fim: meiaNoite(agora, 1) };
  return montar(atual, janelaAnterior(atual), `${dias} dias anteriores`);
}

/**
 * O gráfico por dia nunca mostra menos de uma semana.
 *
 * Em "Hoje" ou "Ontem" o período tem um dia só, e o gráfico virava uma barra
 * gigante sozinha no cartão — que não é gráfico, é um número desenhado. Com sete
 * dias a barra do dia escolhido aparece ao lado das anteriores, e aí dá para ver
 * se hoje está acima ou abaixo do normal, que é a pergunta de quem abre "Hoje".
 */
export const MINIMO_DE_DIAS_NO_GRAFICO = 7;

/**
 * A janela que o gráfico desenha — nem sempre a mesma dos cartões.
 *
 * Termina onde o período termina, e não no dia de hoje: em "Ontem" a última
 * barra é ontem, senão o gráfico mostraria um dia que os cartões não contaram.
 */
export function janelaDoGrafico(periodo: Pick<Periodo, "atual" | "dias">): Intervalo {
  if (periodo.dias >= MINIMO_DE_DIAS_NO_GRAFICO) return periodo.atual;

  const inicio = new Date(periodo.atual.fim);
  inicio.setDate(inicio.getDate() - MINIMO_DE_DIAS_NO_GRAFICO);
  return { inicio, fim: periodo.atual.fim };
}

/**
 * O primeiro e o último dia locais que um intervalo cobre, como "2026-09-20".
 *
 * O último sai de `fim` menos um dia, porque `fim` é exclusivo: em "Hoje" ele é
 * a meia-noite de amanhã, e usá-lo direto marcaria um dia que não existe no
 * período.
 */
export function diasDoIntervalo(intervalo: Intervalo) {
  const ultimo = new Date(intervalo.fim);
  ultimo.setDate(ultimo.getDate() - 1);
  return { primeiro: comoTexto(intervalo.inicio), ultimo: comoTexto(ultimo) };
}

/**
 * A variação entre dois valores, em porcentagem.
 *
 * `null` quando não há base de comparação. Sair de zero para mil não é
 * "+100%" nem "+∞%": é uma conta que não existe, e inventá-la é pior que
 * deixar o espaço vazio, porque parece informação.
 */
export function variacao(atual: number, anterior: number): number | null {
  if (anterior === 0) return null;
  return ((atual - anterior) / anterior) * 100;
}
