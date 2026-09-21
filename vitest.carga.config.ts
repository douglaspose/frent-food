import "dotenv/config";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { urlAdmin, urlApp } from "./carga/banco";

/**
 * O dia simulado: `npm run teste:dia`.
 *
 * Separado da suíte normal porque tem outro propósito e outro custo. A suíte
 * prova regras, uma de cada vez, em segundos. Este aqui abre um restaurante
 * inteiro, põe vários garçons trabalhando ao mesmo tempo num dia de movimento
 * fora do normal e confere, no fim, se o dinheiro, o estoque e o diário
 * fecham — além de tentar deliberadamente quebrar o que puder.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["carga/**/*.test.ts"],
    globalSetup: ["carga/preparar-banco.ts"],
    // Os arquivos montam restaurantes próprios, mas dividem o banco: em
    // sequência, a medição de tempo de um não é contaminada pela carga do outro.
    fileParallelism: false,
    // Um dia cheio leva minutos, não segundos.
    testTimeout: 15 * 60 * 1000,
    hookTimeout: 5 * 60 * 1000,
    // A topologia de produção: as actions passam pela role da aplicação, sob
    // RLS; o `dbSemRls` usa o dono, no papel da role com BYPASSRLS.
    env: {
      DATABASE_URL: urlApp(),
      DATABASE_URL_SEM_RLS: urlAdmin(),
      CARGA_ADMIN_URL: urlAdmin(),
      NODE_ENV: "test",
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)),
    },
  },
});
