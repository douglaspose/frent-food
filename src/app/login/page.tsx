import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { sessaoAtiva } from "@/lib/session";
import { headers } from "next/headers";
import { LoginForm } from "./login-form";
import { logomarcaPeloEndereco } from "@/lib/logomarca";
import { FUNDO_ESCURO } from "@/lib/marca";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage() {
  // Conferida no banco: um cookie de quem foi desligado não pode prender o
  // tablet num PDV que o recusa.
  if (await sessaoAtiva()) redirect("/pdv");

  // Sem sessão, quem diz de qual casa é a tela é o endereço. A tela é preta:
  // o que serve aqui é a versão de fundo escuro.
  const marca = await logomarcaPeloEndereco((await headers()).get("host"), FUNDO_ESCURO);

  return (
    <main className="flex min-h-tela items-center justify-center bg-neutral-950 px-6 text-neutral-100">
      <div className="w-full max-w-sm">
        {/*
          A marca da casa, quando ela existe.

          É a primeira tela que a equipe vê no turno, e nela a marca tem o
          espaço que não tem em lugar nenhum: nada disputa com ela aqui. Por
          isso é aqui que ela aparece maior.

          O retângulo de cor, quando entra, não ocupa a largura toda: uma
          faixa de ponta a ponta numa tela preta viraria uma tarja. E ele só
          entra se faltar a versão de fundo escuro — com ela, a logo é
          desenhada direto no preto da tela.
        */}
        {marca?.src ? (
          <span
            className={`mx-auto mb-6 flex w-fit items-center justify-center ${
              marca.corDeFundo ? "rounded-xl px-6 py-4" : ""
            }`}
            style={marca.corDeFundo ? { backgroundColor: marca.corDeFundo } : undefined}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={marca.src}
              alt={marca.nome}
              className="max-h-28 max-w-[18rem] object-contain"
            />
          </span>
        ) : (
          <h1 className="text-center text-2xl font-bold tracking-tight">
            {marca?.nome ?? "Gestão de Restaurantes"}
          </h1>
        )}
        <p className="mb-8 mt-1 text-center text-sm text-neutral-500">Entre para começar o turno</p>
        <LoginForm />
      </div>
    </main>
  );
}
