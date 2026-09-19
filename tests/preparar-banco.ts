import { execFileSync } from "node:child_process";
import pg from "pg";

/**
 * Deixa a base de teste limpa e com as migrations aplicadas antes da suíte.
 *
 * Recriar o schema a cada execução é de propósito: teste que herda sujeira da
 * rodada anterior passa ou falha por motivo errado.
 */
export default async function preparar() {
  const url = process.env.TEST_DATABASE_URL ?? process.env.SHADOW_DATABASE_URL;
  if (!url) {
    throw new Error(
      "Defina TEST_DATABASE_URL (ou SHADOW_DATABASE_URL) para rodar os testes de banco."
    );
  }

  if (url === process.env.DATABASE_URL_DESENVOLVIMENTO) {
    throw new Error("A base de teste não pode ser a base de desenvolvimento.");
  }

  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  await cliente.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await cliente.end();

  // `migrate deploy` não usa banco-sombra; deixá-la apontando para a mesma
  // base faria o Prisma recusar o comando.
  // O tipo de process.env é estreitado pelo Next; aqui é um mapa comum.
  const ambiente: Record<string, string | undefined> = { ...process.env, DATABASE_URL: url };
  delete ambiente.SHADOW_DATABASE_URL;

  try {
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      env: ambiente as NodeJS.ProcessEnv,
      stdio: "pipe",
      shell: process.platform === "win32",
    });
  } catch (e) {
    const detalhe = e as { stdout?: Buffer; stderr?: Buffer };
    // A mensagem do Prisma vem nos buffers; sem isto o erro chega ilegível.
    throw new Error(
      `Falha ao preparar a base de teste:\n${detalhe.stderr?.toString() ?? ""}${detalhe.stdout?.toString() ?? ""}`
    );
  }
}
