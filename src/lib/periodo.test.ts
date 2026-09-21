import { describe, expect, it } from "vitest";
import {
  ORDEM_DOS_ATALHOS,
  PERIODOS,
  comoTexto,
  diasDoIntervalo,
  janelaDoGrafico,
  lerPeriodo,
  variacao,
} from "./periodo";

/**
 * Uma quinta-feira no meio de setembro, às 15h. O horário importa: quase todo
 * erro de relatório está em tratar "hoje" como um instante em vez de um dia.
 */
const AGORA = new Date(2026, 8, 17, 15, 30);

/** Datas como "17/09 00:00", que é o que se lê num teste de período. */
const legivel = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(
    d.getHours()
  ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

const janela = (i: { inicio: Date; fim: Date }) => `${legivel(i.inicio)} → ${legivel(i.fim)}`;

describe("período do painel", () => {
  it("hoje vai de meia-noite a meia-noite, e compara com ontem", () => {
    const p = lerPeriodo({ periodo: "hoje" }, AGORA);

    expect(janela(p.atual)).toBe("17/09 00:00 → 18/09 00:00");
    expect(janela(p.anterior)).toBe("16/09 00:00 → 17/09 00:00");
    expect(p.dias).toBe(1);
  });

  it("o fim é exclusivo, então a venda das 23h59 do último dia entra", () => {
    /**
     * É o bug clássico do relatório: com o fim em 23:59:59 a última venda do
     * dia cai fora por causa dos milissegundos, e some do fechamento.
     */
    const p = lerPeriodo({ periodo: "hoje" }, AGORA);
    const ultimaVenda = new Date(2026, 8, 17, 23, 59, 59, 800);

    expect(ultimaVenda >= p.atual.inicio && ultimaVenda < p.atual.fim).toBe(true);
  });

  it("ontem é o dia inteiro de ontem, e compara com anteontem", () => {
    const p = lerPeriodo({ periodo: "ontem" }, AGORA);

    expect(janela(p.atual)).toBe("16/09 00:00 → 17/09 00:00");
    expect(janela(p.anterior)).toBe("15/09 00:00 → 16/09 00:00");
  });

  it("as faixas em dias incluem hoje", () => {
    // "Últimos 7 dias" é hoje e os seis de trás, não os sete anteriores a hoje.
    const p = lerPeriodo({ periodo: "7" }, AGORA);

    expect(janela(p.atual)).toBe("11/09 00:00 → 18/09 00:00");
    expect(janela(p.anterior)).toBe("04/09 00:00 → 11/09 00:00");
    expect(p.dias).toBe(7);
  });

  it("o mês corrente compara com o mesmo trecho do mês anterior", () => {
    /**
     * A armadilha que este caso existe para impedir: no dia 17, comparar com
     * agosto inteiro mostraria uma queda de quase metade todo mês, sem que
     * nada tivesse piorado.
     */
    const p = lerPeriodo({ periodo: "mes" }, AGORA);

    expect(janela(p.atual)).toBe("01/09 00:00 → 18/09 00:00");
    expect(janela(p.anterior)).toBe("01/08 00:00 → 18/08 00:00");
    expect(p.dias).toBe(17);
  });

  it("mês anterior é mês fechado contra mês fechado", () => {
    const p = lerPeriodo({ periodo: "mes-anterior" }, AGORA);

    expect(janela(p.atual)).toBe("01/08 00:00 → 01/09 00:00");
    expect(janela(p.anterior)).toBe("01/07 00:00 → 01/08 00:00");
  });

  it("mês anterior em março cai em fevereiro, que é mais curto", () => {
    // Fevereiro de 2026 tem 28 dias; a conta não pode inventar o dia 29.
    const p = lerPeriodo({ periodo: "mes-anterior" }, new Date(2026, 2, 10, 9, 0));

    expect(janela(p.atual)).toBe("01/02 00:00 → 01/03 00:00");
    expect(p.dias).toBe(28);
  });

  it("o mês corrente no dia 31 não estoura para o mês seguinte", () => {
    /**
     * 31 de outubro comparando com setembro: o trecho equivalente começaria
     * em 1º de setembro e andaria 31 dias, o que passa de 30/09. Andar por
     * duração, e não por dia do mês, mantém a conta válida.
     */
    const p = lerPeriodo({ periodo: "mes" }, new Date(2026, 9, 31, 20, 0));

    expect(janela(p.atual)).toBe("01/10 00:00 → 01/11 00:00");
    expect(p.anterior.inicio.getMonth()).toBe(8);
    expect(p.anterior.fim.getTime()).toBeGreaterThan(p.anterior.inicio.getTime());
  });

  it("personalizado cobre os dois dias escolhidos por inteiro", () => {
    const p = lerPeriodo({ periodo: "personalizado", de: "2026-09-01", ate: "2026-09-05" }, AGORA);

    expect(janela(p.atual)).toBe("01/09 00:00 → 06/09 00:00");
    expect(p.dias).toBe(5);
    expect([p.de, p.ate]).toEqual(["2026-09-01", "2026-09-05"]);
  });

  it("personalizado invertido troca as datas em silêncio", () => {
    // Quem digitou de trás para frente quer o intervalo, não uma mensagem.
    const p = lerPeriodo({ periodo: "personalizado", de: "2026-09-05", ate: "2026-09-01" }, AGORA);

    expect(janela(p.atual)).toBe("01/09 00:00 → 06/09 00:00");
  });

  it("personalizado sem data volta ao padrão em vez de mostrar tela vazia", () => {
    const p = lerPeriodo({ periodo: "personalizado" }, AGORA);

    expect(p.chave).toBe("14");
    expect(p.dias).toBe(14);
  });

  it("data impossível não vira outro dia", () => {
    // `new Date(2026, 1, 31)` viraria 3 de março sem reclamar.
    const p = lerPeriodo({ periodo: "personalizado", de: "2026-02-31", ate: "2026-03-05" }, AGORA);

    expect(p.chave).toBe("14");
  });

  it("período desconhecido cai no padrão", () => {
    expect(lerPeriodo({ periodo: "ano-passado" }, AGORA).chave).toBe("14");
    expect(lerPeriodo({}, AGORA).chave).toBe("14");
  });

  it("o intervalo anterior nunca encosta no atual", () => {
    // Um dia contado duas vezes infla a base e inverte o sinal da variação.
    for (const chave of ["hoje", "ontem", "7", "14", "30", "mes", "mes-anterior"]) {
      const p = lerPeriodo({ periodo: chave }, AGORA);
      expect(p.anterior.fim.getTime()).toBeLessThanOrEqual(p.atual.inicio.getTime());
    }
  });

  it("comoTexto devolve o dia local, sem passear pelo fuso", () => {
    // `toISOString()` aqui devolveria o dia anterior à noite no horário de
    // Brasília — e o formulário abriria com a data errada.
    expect(comoTexto(new Date(2026, 8, 17, 22, 0))).toBe("2026-09-17");
  });
});

describe("janela do gráfico", () => {
  it("hoje vira uma semana, terminando hoje", () => {
    // Um dia só desenhava uma barra gigante sozinha no cartão.
    const p = lerPeriodo({ periodo: "hoje" }, AGORA);
    const g = janelaDoGrafico(p);

    expect(janela(g)).toBe("11/09 00:00 → 18/09 00:00");
  });

  it("ontem vira uma semana terminando ontem, e não hoje", () => {
    /**
     * A última barra tem que ser o dia que os cartões contaram. Terminar em
     * hoje mostraria um dia que não entrou em nenhum número da tela.
     */
    const p = lerPeriodo({ periodo: "ontem" }, AGORA);
    const g = janelaDoGrafico(p);

    expect(janela(g)).toBe("10/09 00:00 → 17/09 00:00");
    expect(g.fim.getTime()).toBe(p.atual.fim.getTime());
  });

  it("de uma semana para cima o gráfico é o próprio período", () => {
    for (const chave of ["7", "14", "30", "mes", "mes-anterior"]) {
      const p = lerPeriodo({ periodo: chave }, AGORA);
      const g = janelaDoGrafico(p);

      expect(g.inicio.getTime()).toBe(p.atual.inicio.getTime());
      expect(g.fim.getTime()).toBe(p.atual.fim.getTime());
    }
  });

  it("personalizado de dois dias também é esticado", () => {
    const p = lerPeriodo({ periodo: "personalizado", de: "2026-09-10", ate: "2026-09-11" }, AGORA);

    expect(janela(janelaDoGrafico(p))).toBe("05/09 00:00 → 12/09 00:00");
  });
});

describe("dias do intervalo", () => {
  it("o último dia sai do fim menos um, porque o fim é exclusivo", () => {
    const p = lerPeriodo({ periodo: "hoje" }, AGORA);

    expect(diasDoIntervalo(p.atual)).toEqual({ primeiro: "2026-09-17", ultimo: "2026-09-17" });
  });

  it("marca as duas pontas de um período longo", () => {
    const p = lerPeriodo({ periodo: "7" }, AGORA);

    expect(diasDoIntervalo(p.atual)).toEqual({ primeiro: "2026-09-11", ultimo: "2026-09-17" });
  });
});

describe("ordem dos atalhos", () => {
  it("começa em Hoje, e não nas faixas em dias", () => {
    /**
     * `Object.keys(PERIODOS)` devolve `7, 14, 30, hoje, ontem, …`: o JavaScript
     * trata chave numérica como índice e a move para a frente. A barra saía com
     * "Últimos 7 dias" na primeira posição.
     */
    expect(ORDEM_DOS_ATALHOS[0]).toBe("hoje");
    expect([...ORDEM_DOS_ATALHOS]).toEqual(["hoje", "ontem", "7", "14", "30", "mes", "mes-anterior"]);
  });

  it("cobre todos os períodos menos o personalizado", () => {
    // Sem isto, um período novo entraria em PERIODOS e nunca apareceria na tela.
    const naBarra = new Set<string>(ORDEM_DOS_ATALHOS);
    const esperados = Object.keys(PERIODOS).filter((c) => c !== "personalizado");

    expect([...naBarra].sort()).toEqual(esperados.sort());
  });
});

describe("variação", () => {
  it("mede a diferença contra a base", () => {
    expect(variacao(120, 100)).toBeCloseTo(20);
    expect(variacao(80, 100)).toBeCloseTo(-20);
  });

  it("sem base não existe variação", () => {
    // Sair de zero para mil não é "+100%": é uma conta que não existe, e
    // inventá-la é pior que deixar vazio, porque parece informação.
    expect(variacao(1000, 0)).toBeNull();
  });
});
