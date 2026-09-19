import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { exigirSessao, temPermissao } from "@/lib/session";
import { lerAjustes } from "@/lib/parametros-servidor";
import { AjustesTela } from "./ajustes-tela";

export const metadata: Metadata = { title: "Ajustes" };
export const dynamic = "force-dynamic";

export default async function AjustesPage() {
  const sessao = await exigirSessao();
  /**
   * Configurar é do dono, não de quem opera. Estes interruptores mudam o
   * comportamento de todo mundo no salão — desligar a exigência de motivo no
   * desconto é o tipo de coisa que quem dá desconto não deveria poder fazer.
   */
  if (!temPermissao(sessao, "unidade.configurar")) redirect("/gestao");

  return <AjustesTela valores={await lerAjustes(sessao.unidadeId)} />;
}
