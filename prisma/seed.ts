import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { PARAMETROS as CATALOGO } from "../src/lib/parametros";
import { PERMISSOES, CARDAPIO, CATEGORIAS_DO_BAR, CATEGORIAS_COM_PONTO, ehAlcoolica, FORMAS_DE_PAGAMENTO } from "./dados-de-exemplo";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

/**
 * Os parâmetros vêm do catálogo, não de uma cópia aqui.
 *
 * A lista vivia duplicada neste arquivo, e foi assim que `kds.alertaRetiradaMin`
 * acabou lido pelo KDS e nunca criado pelo seed.
 */
const PARAMETROS = CATALOGO.map((p) => ({ grupo: p.grupo, chave: p.chave, valor: p.padrao }));

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
          exigePontoCarne: CATEGORIAS_COM_PONTO.has(grupo.categoria),
          maiorDeIdade: ehAlcoolica(titulo),
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
    data: FORMAS_DE_PAGAMENTO.map((f) => ({ tenantId: tenant.id, ...f })),
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
