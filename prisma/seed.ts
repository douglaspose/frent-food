import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { PARAMETROS as CATALOGO } from "../src/lib/parametros";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

/** Permissões por cargo. A chave é o que o código checa antes de cada ação. */
const PERMISSOES: Record<string, string[]> = {
  GARCOM: ["comanda.abrir", "comanda.lancarItem", "comanda.imprimirParcial", "mesa.transferir"],
  CAIXA: [
    "comanda.abrir",
    "comanda.lancarItem",
    "comanda.fechar",
    "comanda.receberPagamento",
    "caixa.abrir",
    "caixa.fechar",
  ],
  GERENTE: [
    "comanda.abrir",
    "comanda.lancarItem",
    "comanda.fechar",
    "comanda.receberPagamento",
    "comanda.cancelarItem",
    "comanda.aplicarDesconto",
    "caixa.abrir",
    "caixa.fechar",
    "caixa.sangria",
    "autorizacao.aprovar",
    "produto.editar",
    "cardapio.editar",
    // O gerente lê o diário porque é ele quem confere o turno. Garçom e caixa
    // não: a tela diz quem deu desconto e quem fechou com falta.
    "auditoria.ver",
  ],
  PROPRIETARIO: ["*"],
};

/**
 * Os parâmetros vêm do catálogo, não de uma cópia aqui.
 *
 * A lista vivia duplicada neste arquivo, e foi assim que `kds.alertaRetiradaMin`
 * acabou lido pelo KDS e nunca criado pelo seed.
 */
const PARAMETROS = CATALOGO.map((p) => ({ grupo: p.grupo, chave: p.chave, valor: p.padrao }));

/** Cardápio de demonstração: espetaria/bar, próximo do que um cliente real teria. */
const CARDAPIO: { categoria: string; itens: [string, number][] }[] = [
  {
    categoria: "Espetos",
    itens: [
      ["Espeto de Alcatra", 14.9],
      ["Espeto de Frango", 12.9],
      ["Espeto de Coração", 13.9],
      ["Espeto de Linguiça", 12.9],
      ["Espeto de Queijo Coalho", 12.0],
      ["Pão de Alho", 9.9],
    ],
  },
  {
    categoria: "Carnes",
    itens: [
      ["Picanha na Chapa", 129.9],
      ["Cupim na Chapa", 99.9],
      ["Carne de Sol com Mandioca", 89.9],
    ],
  },
  {
    categoria: "Porções",
    itens: [
      ["Batata Frita", 39.9],
      ["Mandioca Frita", 34.9],
      ["Torresmo", 44.9],
      ["Calabresa Acebolada", 42.9],
    ],
  },
  {
    categoria: "Bebidas",
    itens: [
      ["Cerveja Long Neck", 12.0],
      ["Chopp 300ml", 11.0],
      ["Refrigerante Lata", 7.0],
      ["Água Mineral", 5.0],
      ["Suco de Laranja", 12.0],
      ["Caipirinha", 22.0],
    ],
  },
  {
    categoria: "Sobremesas",
    itens: [
      ["Pudim", 16.9],
      ["Petit Gateau", 24.9],
    ],
  },
];

/** Bebida vai para o bar, comida vai para a cozinha. */
const CATEGORIAS_DO_BAR = new Set(["Bebidas"]);

async function main() {
  console.log("Limpando dados anteriores...");
  await db.tenant.deleteMany({ where: { slug: "demo" } });

  console.log("Criando tenant e unidade...");
  const tenant = await db.tenant.create({
    data: { slug: "demo", nome: "Restaurante Demonstração", plano: "pro" },
  });

  const unidade = await db.unidade.create({
    data: {
      tenantId: tenant.id,
      codigo: "001",
      nome: "Matriz",
      cidade: "Goiânia",
      uf: "GO",
      taxaServicoPct: 10,
      atuaLoja: true,
    },
  });

  await db.parametroUnidade.createMany({
    data: PARAMETROS.map((p) => ({
      tenantId: tenant.id,
      unidadeId: unidade.id,
      grupo: p.grupo,
      chave: p.chave,
      valor: p.valor as never,
    })),
  });

  console.log("Criando cargos e usuários...");
  const cargos: Record<string, string> = {};
  for (const [nome, chaves] of Object.entries(PERMISSOES)) {
    const cargo = await db.cargo.create({
      data: {
        tenantId: tenant.id,
        nome,
        nivel: Object.keys(PERMISSOES).indexOf(nome),
        permissoes: { create: chaves.map((chave) => ({ chave })) },
      },
    });
    cargos[nome] = cargo.id;
  }

  const senhaHash = await bcrypt.hash("demo1234", 10);
  const equipe: [string, string, string, string][] = [
    ["Dono do Restaurante", "dono@demo.com", "PROPRIETARIO", "1111"],
    ["Marina Gerente", "gerente@demo.com", "GERENTE", "2222"],
    ["Caixa da Noite", "caixa@demo.com", "CAIXA", "3333"],
    ["João Garçom", "joao@demo.com", "GARCOM", "4444"],
    ["Ana Garçonete", "ana@demo.com", "GARCOM", "5555"],
  ];

  for (const [nome, email, cargo, pin] of equipe) {
    await db.usuario.create({
      data: {
        tenantId: tenant.id,
        nome,
        email,
        senhaHash,
        pinHash: await bcrypt.hash(pin, 10),
        unidades: { create: { unidadeId: unidade.id, cargoId: cargos[cargo] } },
      },
    });
  }

  console.log("Criando áreas e mesas...");
  const areas = [
    { nome: "Interna", ordem: 1, mesas: 20 },
    { nome: "Deck", ordem: 2, mesas: 12 },
    { nome: "Externa", ordem: 3, mesas: 8 },
  ];

  let numeroMesa = 1;
  for (const a of areas) {
    const area = await db.area.create({
      data: { tenantId: tenant.id, unidadeId: unidade.id, nome: a.nome, ordem: a.ordem },
    });
    await db.mesa.createMany({
      data: Array.from({ length: a.mesas }, () => ({
        tenantId: tenant.id,
        unidadeId: unidade.id,
        areaId: area.id,
        numero: String(numeroMesa++),
        capacidade: 4,
        // Token do QR fixo da mesa. Aleatório porque é a única credencial da
        // página pública: sequencial deixaria qualquer um chamar garçom em
        // qualquer mesa.
        qrToken: randomBytes(12).toString("base64url"),
      })),
    });
  }

  console.log("Criando estações de produção...");
  const bar = await db.estacao.create({
    data: { tenantId: tenant.id, unidadeId: unidade.id, nome: "BAR", corHex: "#2563eb", ordem: 1 },
  });
  const cozinha = await db.estacao.create({
    data: { tenantId: tenant.id, unidadeId: unidade.id, nome: "COZINHA", corHex: "#ea580c", ordem: 2 },
  });

  console.log("Criando cardápio...");
  const cardapio = await db.cardapio.create({
    data: {
      tenantId: tenant.id,
      unidadeId: unidade.id,
      nome: "Cardápio do Salão",
      canal: "SALAO",
    },
  });

  let codigo = 1;
  for (const [i, grupo] of CARDAPIO.entries()) {
    const categoria = await db.categoriaProduto.create({
      data: { tenantId: tenant.id, nome: grupo.categoria, ordem: i },
    });

    for (const [j, [titulo, preco]] of grupo.itens.entries()) {
      const produto = await db.produto.create({
        data: {
          tenantId: tenant.id,
          codigo: String(codigo++),
          titulo,
          categoriaId: categoria.id,
          tipo: "VENDA",
          exigePontoCarne: grupo.categoria === "Carnes",
          maiorDeIdade: titulo.includes("Cerveja") || titulo.includes("Chopp") || titulo.includes("Caipirinha"),
          estacoes: {
            create: { estacaoId: CATEGORIAS_DO_BAR.has(grupo.categoria) ? bar.id : cozinha.id },
          },
        },
      });

      await db.cardapioItem.create({
        data: {
          cardapioId: cardapio.id,
          produtoId: produto.id,
          categoriaId: categoria.id,
          preco,
          ordem: j,
        },
      });
    }
  }

  console.log("Criando formas de pagamento...");
  await db.formaPagamento.createMany({
    data: [
      { tenantId: tenant.id, nome: "Dinheiro", tipo: "DINHEIRO" },
      { tenantId: tenant.id, nome: "Pix", tipo: "PIX" },
      { tenantId: tenant.id, nome: "Cartão de Débito", tipo: "DEBITO", taxaPct: 1.5, prazoDias: 1 },
      { tenantId: tenant.id, nome: "Cartão de Crédito", tipo: "CREDITO", taxaPct: 3.2, prazoDias: 30 },
    ],
  });

  const totalProdutos = await db.produto.count({ where: { tenantId: tenant.id } });
  const totalMesas = await db.mesa.count({ where: { tenantId: tenant.id } });

  console.log(
    `\nPronto: ${totalMesas} mesas, ${totalProdutos} produtos, ${equipe.length} usuários.` +
      `\nLogin: dono@demo.com / senha demo1234 (PIN 1111 no PDV)`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
