import { db } from "@/lib/db";

/** Cria um restaurante isolado para o teste, com unidade, cargo e usuário. */
export async function criarRestaurante(slug: string) {
  await db.tenant.deleteMany({ where: { slug } });

  const tenant = await db.tenant.create({ data: { slug, nome: `Teste ${slug}` } });

  const unidade = await db.unidade.create({
    data: { tenantId: tenant.id, codigo: "001", nome: "Matriz", taxaServicoPct: 10 },
  });

  const cargo = await db.cargo.create({
    data: {
      tenantId: tenant.id,
      nome: "GERENTE",
      permissoes: { create: [{ chave: "*" }] },
    },
  });

  const usuario = await db.usuario.create({
    data: {
      tenantId: tenant.id,
      nome: "Usuário de Teste",
      email: `teste@${slug}.com`,
      unidades: { create: { unidadeId: unidade.id, cargoId: cargo.id } },
    },
  });

  const estacao = await db.estacao.create({
    data: { tenantId: tenant.id, unidadeId: unidade.id, nome: "COZINHA" },
  });

  return { tenant, unidade, cargo, usuario, estacao };
}

export async function criarProduto(
  tenantId: string,
  titulo: string,
  extras: { controlaEstoque?: boolean; unidadeMedida?: "KG" | "UN" } = {}
) {
  return db.produto.create({
    data: {
      tenantId,
      titulo,
      unidadeMedida: extras.unidadeMedida ?? "UN",
      controlaEstoque: extras.controlaEstoque ?? false,
    },
  });
}

export async function limpar(slug: string) {
  await db.tenant.deleteMany({ where: { slug } });
}
