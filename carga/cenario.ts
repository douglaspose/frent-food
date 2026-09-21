import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PARAMETROS as CATALOGO } from "@/lib/parametros";
import {
  CARDAPIO,
  CATEGORIAS_COM_PONTO,
  CATEGORIAS_DO_BAR,
  FORMAS_DE_PAGAMENTO,
  PERMISSOES,
  ehAlcoolica,
} from "../prisma/dados-de-exemplo";
import { admin } from "./admin";
import { pessoa, type Pessoa } from "./usuarios-virtuais";

/**
 * Um restaurante pronto para abrir, com a equipe de um dia cheio.
 *
 * Os cargos, o cardápio e as formas de pagamento são os mesmos da demonstração
 * (`prisma/dados-de-exemplo.ts`): o que se testa aqui são as permissões que
 * uma instalação real tem, não uma versão inventada para o teste.
 */

export type Opcoes = {
  slug: string;
  nome: string;
  mesas: number;
  garcons: number;
  caixas: number;
  gerentes: number;
  /** Saldo inicial dos produtos com estoque controlado. */
  estoqueInicial: number;
  /** Primeiro octeto variável do IP, para os restaurantes não dividirem freio. */
  redeIp: number;
};

export type Membro = Pessoa & { usuarioId: string; cargo: string };

export async function montarRestaurante(o: Opcoes) {
  await admin.tenant.deleteMany({ where: { slug: o.slug } });

  const tenant = await admin.tenant.create({
    data: { slug: o.slug, nome: o.nome, plano: "pro" },
  });

  const unidade = await admin.unidade.create({
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

  await admin.parametroUnidade.createMany({
    data: CATALOGO.map((p) => ({
      tenantId: tenant.id,
      unidadeId: unidade.id,
      grupo: p.grupo,
      chave: p.chave,
      valor: p.padrao as never,
    })),
  });

  const cargos: Record<string, string> = {};
  for (const [nome, chaves] of Object.entries(PERMISSOES)) {
    const cargo = await admin.cargo.create({
      data: {
        tenantId: tenant.id,
        nome,
        nivel: Object.keys(PERMISSOES).indexOf(nome),
        permissoes: { create: chaves.map((chave) => ({ chave })) },
      },
    });
    cargos[nome] = cargo.id;
  }

  // PIN por faixa: o primeiro dígito diz o cargo, o que facilita ler o relatório.
  const vagas: [string, number, number][] = [
    ["PROPRIETARIO", 1, 1000],
    ["GERENTE", o.gerentes, 2000],
    ["CAIXA", o.caixas, 3000],
    ["GARCOM", o.garcons, 4000],
  ];

  const equipe: Membro[] = [];
  let ip = 1;
  for (const [cargo, quantos, base] of vagas) {
    for (let i = 1; i <= quantos; i++) {
      const pin = String(base + i);
      const nome = `${cargo.toLowerCase()} ${i}`;
      const usuario = await admin.usuario.create({
        data: {
          tenantId: tenant.id,
          nome,
          email: `${cargo.toLowerCase()}${i}@${o.slug}.com`,
          // Custo 4 e não 10: são dezenas de PINs e o bcrypt caro só atrasaria o
          // preparo. O login compara do mesmo jeito.
          pinHash: await bcrypt.hash(pin, 4),
          unidades: { create: { unidadeId: unidade.id, cargoId: cargos[cargo]! } },
        },
      });
      equipe.push({
        ...pessoa(nome, pin, `10.${o.redeIp}.0.${ip++}`, `${o.slug}.frentfood.test`),
        usuarioId: usuario.id,
        cargo,
      });
    }
  }

  const area = await admin.area.create({
    data: { tenantId: tenant.id, unidadeId: unidade.id, nome: "Salão", ordem: 1 },
  });
  await admin.mesa.createMany({
    data: Array.from({ length: o.mesas }, (_, i) => ({
      tenantId: tenant.id,
      unidadeId: unidade.id,
      areaId: area.id,
      numero: String(i + 1),
      capacidade: 4,
      qrToken: randomBytes(12).toString("base64url"),
    })),
  });
  const mesas = await admin.mesa.findMany({
    where: { unidadeId: unidade.id },
    orderBy: { numero: "asc" },
  });

  const bar = await admin.estacao.create({
    data: { tenantId: tenant.id, unidadeId: unidade.id, nome: "BAR", ordem: 1 },
  });
  const cozinha = await admin.estacao.create({
    data: { tenantId: tenant.id, unidadeId: unidade.id, nome: "COZINHA", ordem: 2 },
  });

  const cardapio = await admin.cardapio.create({
    data: { tenantId: tenant.id, unidadeId: unidade.id, nome: "Cardápio do Salão", canal: "SALAO" },
  });

  const itens: {
    cardapioItemId: string;
    produtoId: string;
    titulo: string;
    preco: number;
    exigePontoCarne: boolean;
    controlaEstoque: boolean;
  }[] = [];

  let codigo = 1;
  for (const [i, grupo] of CARDAPIO.entries()) {
    const categoria = await admin.categoriaProduto.create({
      data: { tenantId: tenant.id, nome: grupo.categoria, ordem: i },
    });
    for (const [j, [titulo, preco]] of grupo.itens.entries()) {
      // Bebida tem estoque de verdade: é o que se conta na geladeira no fim da
      // noite, e o que o dono confere contra o vendido.
      const controlaEstoque = CATEGORIAS_DO_BAR.has(grupo.categoria);
      const exigePontoCarne = CATEGORIAS_COM_PONTO.has(grupo.categoria);
      const produto = await admin.produto.create({
        data: {
          tenantId: tenant.id,
          codigo: String(codigo++),
          titulo,
          categoriaId: categoria.id,
          tipo: "VENDA",
          exigePontoCarne,
          maiorDeIdade: ehAlcoolica(titulo),
          controlaEstoque,
          estacoes: {
            create: { estacaoId: CATEGORIAS_DO_BAR.has(grupo.categoria) ? bar.id : cozinha.id },
          },
        },
      });
      const item = await admin.cardapioItem.create({
        data: {
          cardapioId: cardapio.id,
          produtoId: produto.id,
          categoriaId: categoria.id,
          preco,
          ordem: j,
        },
      });
      itens.push({
        cardapioItemId: item.id,
        produtoId: produto.id,
        titulo,
        preco,
        exigePontoCarne,
        controlaEstoque,
      });

      if (controlaEstoque) {
        await admin.estoqueSaldo.create({
          data: {
            tenantId: tenant.id,
            unidadeId: unidade.id,
            produtoId: produto.id,
            quantidade: o.estoqueInicial,
            custoMedio: 3,
          },
        });
        await admin.movimentoEstoque.create({
          data: {
            tenantId: tenant.id,
            unidadeId: unidade.id,
            produtoId: produto.id,
            tipo: "ENTRADA",
            quantidade: o.estoqueInicial,
            saldoDepois: o.estoqueInicial,
            custoUnitario: 3,
            motivo: "estoque de abertura do dia simulado",
          },
        });
      }
    }
  }

  await admin.formaPagamento.createMany({
    data: FORMAS_DE_PAGAMENTO.map((f) => ({ tenantId: tenant.id, ...f })),
  });
  const formas = await admin.formaPagamento.findMany({ where: { tenantId: tenant.id } });
  const forma = (tipo: string) => formas.find((f) => f.tipo === tipo)!;

  const porCargo = (cargo: string) => equipe.filter((m) => m.cargo === cargo);

  return {
    tenant,
    unidade,
    mesas,
    itens,
    cargos,
    formas: {
      dinheiro: forma("DINHEIRO"),
      pix: forma("PIX"),
      debito: forma("DEBITO"),
      credito: forma("CREDITO"),
    },
    equipe,
    proprietario: porCargo("PROPRIETARIO")[0]!,
    gerentes: porCargo("GERENTE"),
    caixas: porCargo("CAIXA"),
    garcons: porCargo("GARCOM"),
  };
}

export type Restaurante = Awaited<ReturnType<typeof montarRestaurante>>;
