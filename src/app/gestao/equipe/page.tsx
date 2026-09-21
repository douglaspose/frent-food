import type { Metadata } from "next";
import { db } from "@/lib/db";
import { sessaoDaTela, temPermissao } from "@/lib/session";
import { EquipeTela } from "./equipe-tela";

export const metadata: Metadata = { title: "Equipe" };
export const dynamic = "force-dynamic";

export default async function EquipePage() {
  const sessao = await sessaoDaTela();

  const [usuarios, cargos] = await Promise.all([
    db.usuario.findMany({
      where: { tenantId: sessao.tenantId },
      orderBy: [{ ativo: "desc" }, { nome: "asc" }],
      include: { unidades: { include: { cargo: { select: { id: true, nome: true } } } } },
    }),
    db.cargo.findMany({
      where: { tenantId: sessao.tenantId },
      orderBy: { nivel: "asc" },
      select: { id: true, nome: true },
    }),
  ]);

  return (
    <EquipeTela
      podeEditar={temPermissao(sessao, "usuario.editar")}
      cargos={cargos}
      usuarioAtualId={sessao.usuarioId}
      usuarios={usuarios.map((u) => ({
        id: u.id,
        nome: u.nome,
        email: u.email,
        cargoId: u.unidades[0]?.cargo.id ?? "",
        cargoNome: u.unidades[0]?.cargo.nome ?? "—",
        temPin: Boolean(u.pinHash),
        ativo: u.ativo,
      }))}
    />
  );
}
