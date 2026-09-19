import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { lerSessao } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage() {
  if (await lerSessao()) redirect("/pdv");

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-neutral-100">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-2xl font-bold tracking-tight">Gestão de Restaurantes</h1>
        <p className="mb-8 mt-1 text-center text-sm text-neutral-500">Entre para começar o turno</p>
        <LoginForm />
      </div>
    </main>
  );
}
