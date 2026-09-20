"use client";

import { useState, useTransition } from "react";
import { entrarComPin, entrarComSenha } from "./actions";

const TECLAS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export function LoginForm() {
  const [modo, setModo] = useState<"pin" | "senha">("pin");
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function digitar(tecla: string) {
    setErro(null);
    const novo = (pin + tecla).slice(0, 6);
    setPin(novo);
    // O PIN do seed tem 4 dígitos e envia sozinho — ninguém aperta "OK" num
    // teclado numérico de PDV.
    if (novo.length === 4) enviarPin(novo);
  }

  function enviarPin(valor: string) {
    iniciar(async () => {
      const r = await entrarComPin(valor);
      if (r?.erro) {
        setErro(r.erro);
        setPin("");
      }
    });
  }

  function enviarSenha() {
    setErro(null);
    iniciar(async () => {
      const r = await entrarComSenha(email, senha);
      if (r?.erro) setErro(r.erro);
    });
  }

  return (
    <div>
      <div className="mb-6 flex gap-2 rounded-lg bg-neutral-900 p-1">
        {(["pin", "senha"] as const).map((m) => (
          <button
            key={m}
            onClick={() => {
              setModo(m);
              setErro(null);
            }}
            className={`flex-1 rounded-md py-2 text-sm font-semibold transition ${
              modo === m ? "bg-orange-700 text-white" : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {m === "pin" ? "PIN (salão)" : "E-mail e senha"}
          </button>
        ))}
      </div>

      {modo === "pin" ? (
        <div>
          <div className="mb-6 flex justify-center gap-3">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={`h-4 w-4 rounded-full transition ${
                  pin.length > i ? "bg-orange-500" : "bg-neutral-800"
                }`}
              />
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3">
            {TECLAS.map((t) => (
              <button
                key={t}
                onClick={() => digitar(t)}
                disabled={pendente}
                className="h-16 rounded-xl bg-neutral-900 text-2xl font-semibold transition hover:bg-neutral-800 active:bg-neutral-700 disabled:opacity-50"
              >
                {t}
              </button>
            ))}
            <button
              onClick={() => setPin("")}
              className="h-16 rounded-xl bg-neutral-900 text-sm font-semibold text-neutral-400 transition hover:bg-neutral-800"
            >
              Limpar
            </button>
            <button
              onClick={() => digitar("0")}
              disabled={pendente}
              className="h-16 rounded-xl bg-neutral-900 text-2xl font-semibold transition hover:bg-neutral-800 active:bg-neutral-700 disabled:opacity-50"
            >
              0
            </button>
            <button
              onClick={() => setPin(pin.slice(0, -1))}
              className="h-16 rounded-xl bg-neutral-900 text-xl text-neutral-400 transition hover:bg-neutral-800"
            >
              ←
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="username"
            placeholder="E-mail"
            className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 placeholder:text-neutral-600 focus:border-orange-600 focus:outline-none"
          />
          <input
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && enviarSenha()}
            type="password"
            autoComplete="current-password"
            placeholder="Senha"
            className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 placeholder:text-neutral-600 focus:border-orange-600 focus:outline-none"
          />
          <button
            onClick={enviarSenha}
            disabled={pendente || !email || !senha}
            className="w-full rounded-lg bg-orange-700 py-3 font-semibold text-white transition hover:bg-orange-600 disabled:opacity-40"
          >
            {pendente ? "Entrando..." : "Entrar"}
          </button>
        </div>
      )}

      {erro && <p className="mt-4 text-center text-sm text-red-400">{erro}</p>}
    </div>
  );
}
