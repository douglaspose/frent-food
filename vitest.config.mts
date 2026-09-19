import "dotenv/config";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Os testes de banco rodam contra uma base separada (por padrão a segunda
 * instância do `prisma dev`). Apontar para o banco de desenvolvimento
 * apagaria os dados de trabalho no meio de um teste.
 */
const bancoDeTeste = process.env.TEST_DATABASE_URL ?? process.env.SHADOW_DATABASE_URL ?? "";

export default defineConfig({
  test: {
    environment: "node",
    // Testes de banco compartilham a mesma base: em paralelo um apagaria os
    // dados do outro no meio da execução.
    fileParallelism: false,
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    globalSetup: ["tests/preparar-banco.ts"],
    env: { DATABASE_URL: bancoDeTeste, NODE_ENV: "test" },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Os testes rodam em Node puro, sem a fronteira cliente/servidor do Next
      // que o pacote 'server-only' existe para proteger.
      "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)),
    },
  },
});
