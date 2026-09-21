import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { sessaoDaTela, temPermissao } from "@/lib/session";
import { versoesDaLogomarca } from "@/lib/logomarca";
import { COR_DE_FUNDO_PADRAO } from "@/lib/marca";
import { MarcaTela } from "./marca-tela";

export const metadata: Metadata = { title: "Logomarca" };
export const dynamic = "force-dynamic";

export default async function MarcaPage() {
  const sessao = await sessaoDaTela();
  if (!temPermissao(sessao, "unidade.configurar")) redirect("/gestao");

  const marca = await versoesDaLogomarca(sessao.tenantId);

  return (
    <MarcaTela
      claro={marca?.claro ?? null}
      escuro={marca?.escuro ?? null}
      corInicial={marca?.corDeFundo ?? COR_DE_FUNDO_PADRAO}
      nome={marca?.nome ?? "Sua empresa"}
    />
  );
}
