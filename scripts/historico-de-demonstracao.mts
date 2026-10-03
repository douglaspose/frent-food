/**
 * Dois meses de movimento para a demonstração — um bar de espetos e cerveja.
 *
 * Enche o banco de histórico já fechado (comandas pagas, pagamentos, caixas do
 * dia) para que as telas de gestão — faturamento, mais vendidos, formas de
 * pagamento, fechamentos de caixa — apareçam com vida na apresentação, e não
 * zeradas.
 *
 * Fim de semana enche, segunda esvazia; a bebida e o espeto puxam o giro, como
 * num bar de verdade. Tudo com datas no passado, espalhadas pela noite.
 *
 * Uso: DATABASE_URL="<neon>" npx tsx scripts/historico-de-demonstracao.mts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "node:crypto";

const DIAS = 60;

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const aleatorio = (min: number, max: number) => min + Math.random() * (max - min);
const inteiro = (min: number, max: number) => Math.floor(aleatorio(min, max + 1));
const centavos = (v: number) => Math.round(v * 100) / 100;
const escolher = <T>(lista: T[]): T => lista[inteiro(0, lista.length - 1)]!;

async function principal() {
  const unidade = await db.unidade.findFirstOrThrow({ select: { id: true, tenantId: true } });
  const ctx = { tenantId: unidade.tenantId, unidadeId: unidade.id };

  const [usuarios, mesas, itensCardapio, formas] = await Promise.all([
    db.usuario.findMany({
      where: { tenantId: ctx.tenantId },
      select: { id: true, unidades: { select: { cargo: { select: { nome: true } } } } },
    }),
    db.mesa.findMany({ where: { unidadeId: ctx.unidadeId }, select: { id: true } }),
    db.cardapioItem.findMany({
      where: { produto: { tenantId: ctx.tenantId } },
      select: { id: true, produtoId: true, preco: true, produto: { select: { titulo: true } } },
    }),
    db.formaPagamento.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, tipo: true, taxaPct: true } }),
  ]);

  const caixa = usuarios.find((u) => u.unidades.some((v) => v.cargo.nome === "CAIXA")) ?? usuarios[0]!;
  const garcons = usuarios.filter((u) => u.unidades.some((v) => v.cargo.nome === "GARCOM"));
  const garcom = () => (garcons.length ? escolher(garcons) : caixa);

  /**
   * O peso de cada item no giro do bar. Bebida e espeto saem o tempo todo; a
   * picanha, de vez em quando. É o que faz o "mais vendidos" ter cara de bar.
   */
  const peso = (titulo: string) => {
    const t = titulo.toLowerCase();
    if (t.includes("cerveja") || t.includes("chopp")) return 10;
    if (t.includes("espeto")) return 8;
    if (t.includes("caipirinha") || t.includes("refrigerante") || t.includes("suco")) return 5;
    if (t.includes("porç") || t.includes("batata") || t.includes("mandioca") || t.includes("torresmo") || t.includes("calabresa") || t.includes("pão")) return 4;
    if (t.includes("água")) return 2;
    if (t.includes("picanha") || t.includes("cupim") || t.includes("carne de sol")) return 2;
    return 1; // sobremesas e o resto
  };
  // Sorteio ponderado: cada item entra na urna tantas vezes quanto o seu peso.
  const urna: typeof itensCardapio = [];
  for (const item of itensCardapio) for (let i = 0; i < peso(item.produto.titulo); i++) urna.push(item);

  const quantidadeDoItem = (titulo: string) => {
    const t = titulo.toLowerCase();
    if (t.includes("cerveja") || t.includes("chopp")) return inteiro(1, 6);
    if (t.includes("espeto")) return inteiro(1, 4);
    return inteiro(1, 2);
  };

  // Pix e crédito dominam num bar hoje; dinheiro minguando, débito no meio.
  const sortearForma = () => {
    const r = Math.random();
    const tipo = r < 0.35 ? "PIX" : r < 0.65 ? "CREDITO" : r < 0.85 ? "DINHEIRO" : "DEBITO";
    return formas.find((f) => f.tipo === tipo) ?? formas[0]!;
  };

  const volumeDoDia = (diaDaSemana: number) => {
    if (diaDaSemana === 5) return inteiro(90, 120); // sexta
    if (diaDaSemana === 6) return inteiro(100, 135); // sábado
    if (diaDaSemana === 0) return inteiro(45, 75); // domingo
    return inteiro(28, 55); // segunda a quinta
  };

  const ultimoNumero = (await db.comanda.aggregate({ where: { unidadeId: ctx.unidadeId }, _max: { numero: true } }))._max.numero ?? 0;
  let numero = ultimoNumero;

  const agora = new Date();
  let totalComandas = 0;
  let faturamento = 0;

  for (let offset = DIAS; offset >= 0; offset--) {
    const dia = new Date(agora);
    dia.setDate(dia.getDate() - offset);
    const ehHoje = offset === 0;

    const comandasDoDia = ehHoje ? inteiro(18, 40) : volumeDoDia(dia.getDay());

    // O caixa do dia: abre às 18h, fecha de madrugada. Hoje fica aberto.
    const caixaId = randomUUID();
    const abertoEm = new Date(dia);
    abertoEm.setHours(18, inteiro(0, 20), 0, 0);

    const comandas: {
      id: string; tenantId: string; unidadeId: string; numero: number;
      status: "PAGA"; mesaId: string; pessoas: number; taxaServicoPct: number;
      abertaPorId: string; abertaEm: Date; fechadaEm: Date; caixaId: string;
    }[] = [];
    const itens: {
      id: string; tenantId: string; comandaId: string; produtoId: string;
      cardapioItemId: string; quantidade: number; precoUnitario: number; precoTotal: number;
      status: "ENTREGUE"; lancadoPorId: string; lancadoEm: Date;
    }[] = [];
    const pagamentos: {
      id: string; tenantId: string; comandaId: string; caixaId: string;
      formaPagamentoId: string; valor: number; troco: number; taxaPct: number;
      taxaValor: number; usuarioId: string; criadoEm: Date;
    }[] = [];

    let dinheiroNoCaixa = 0;

    for (let c = 0; c < comandasDoDia; c++) {
      const comandaId = randomUUID();
      numero += 1;

      // Hora de abrir: espalhada pela noite. Hoje, nas últimas horas até agora.
      const abertaEm = new Date(dia);
      if (ehHoje) {
        const limite = Math.max(agora.getHours() * 60 + agora.getMinutes() - 10, 18 * 60 + 30);
        const minutos = inteiro(18 * 60, limite);
        abertaEm.setHours(Math.floor(minutos / 60), minutos % 60, 0, 0);
      } else {
        abertaEm.setHours(inteiro(18, 23), inteiro(0, 59), 0, 0);
      }
      const fechadaEm = new Date(abertaEm.getTime() + inteiro(25, 110) * 60_000);

      const g = garcom().id;
      const quantosItens = inteiro(3, 8);
      let subtotal = 0;
      for (let i = 0; i < quantosItens; i++) {
        const item = escolher(urna);
        const qtd = quantidadeDoItem(item.produto.titulo);
        const preco = Number(item.preco);
        const total = centavos(preco * qtd);
        subtotal += total;
        itens.push({
          id: randomUUID(), tenantId: ctx.tenantId, comandaId, produtoId: item.produtoId,
          cardapioItemId: item.id, quantidade: qtd, precoUnitario: preco, precoTotal: total,
          status: "ENTREGUE", lancadoPorId: g, lancadoEm: abertaEm,
        });
      }
      subtotal = centavos(subtotal);
      const taxaServico = centavos(subtotal * 0.1);
      const total = centavos(subtotal + taxaServico);

      comandas.push({
        id: comandaId, tenantId: ctx.tenantId, unidadeId: ctx.unidadeId, numero,
        status: "PAGA", mesaId: escolher(mesas).id, pessoas: inteiro(1, 6), taxaServicoPct: 10,
        abertaPorId: g, abertaEm, fechadaEm, caixaId,
      });

      const forma = sortearForma();
      const taxaPct = Number(forma.taxaPct);
      let troco = 0;
      if (forma.tipo === "DINHEIRO") {
        const entregue = Math.ceil(total / 10) * 10; // paga em nota redonda
        troco = centavos(entregue - total);
        dinheiroNoCaixa += total;
      }
      pagamentos.push({
        id: randomUUID(), tenantId: ctx.tenantId, comandaId, caixaId,
        formaPagamentoId: forma.id, valor: forma.tipo === "DINHEIRO" ? centavos(total + troco) : total,
        troco, taxaPct, taxaValor: centavos((total * taxaPct) / 100),
        usuarioId: caixa.id, criadoEm: fechadaEm,
      });

      faturamento += total;
    }

    const fundo = 300;
    const apurado = ehHoje ? null : centavos(fundo + dinheiroNoCaixa);
    await db.caixa.create({
      data: {
        id: caixaId, tenantId: ctx.tenantId, unidadeId: ctx.unidadeId, tipo: "GERAL",
        data: new Date(Date.UTC(dia.getFullYear(), dia.getMonth(), dia.getDate())),
        turno: "NOITE", status: ehHoje ? "ABERTO" : "FECHADO", fundoCaixa: fundo,
        abertoPorId: caixa.id, abertoEm,
        valorApurado: apurado, valorInformado: apurado, divergencia: ehHoje ? null : 0,
        fechadoPorId: ehHoje ? null : caixa.id,
        fechadoEm: ehHoje ? null : new Date(new Date(dia).setHours(24 + inteiro(0, 2), inteiro(0, 59))),
      },
    });

    // createMany em vez de create por linha: um INSERT com muitas linhas, e não
    // milhares de idas ao banco.
    await db.comanda.createMany({ data: comandas });
    for (let i = 0; i < itens.length; i += 500) await db.comandaItem.createMany({ data: itens.slice(i, i + 500) });
    for (let i = 0; i < pagamentos.length; i += 500) await db.pagamento.createMany({ data: pagamentos.slice(i, i + 500) });

    totalComandas += comandas.length;
    const label = dia.toISOString().slice(0, 10);
    process.stdout.write(`\r${label}: ${comandas.length} comandas  (acumulado ${totalComandas})      `);
  }

  console.log(`\n\nPronto: ${totalComandas} comandas em ${DIAS + 1} dias, faturamento R$ ${faturamento.toFixed(2)}.`);
  await db.$disconnect();
}

principal().catch((e) => {
  console.error(e);
  process.exit(1);
});
