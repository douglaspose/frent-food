import { execFileSync } from "node:child_process";
import pg from "pg";
import { BANCO_DE_CARGA, senhaDaApp, urlAdmin } from "./banco";

/**
 * Recria o banco de carga do zero antes de cada rodada, já com o RLS ligado.
 *
 * Do zero de propósito: um dia simulado que herda as comandas do anterior
 * confere invariantes sobre dados que não produziu, e uma divergência de caixa
 * passaria a ter duas explicações possíveis em vez de uma.
 *
 * Com RLS porque é assim que o sistema roda em produção. Rodando como dono do
 * banco, como a suíte normal, a falha que só existe com o isolamento ligado —
 * uma tela que não declara o restaurante e passa a ver nada — ficaria
 * invisível até o primeiro cliente.
 */
export default async function preparar() {
  const admin = urlAdmin();

  // O banco pode ainda não existir na primeira rodada. Para criá-lo é preciso
  // conectar em outro — não se cria um banco estando dentro dele.
  const postgres = new URL(admin);
  postgres.pathname = "/postgres";
  const c = new pg.Client({ connectionString: postgres.toString() });
  await c.connect();
  const existe = await c.query("select 1 from pg_database where datname = $1", [BANCO_DE_CARGA]);
  if (!existe.rowCount) await c.query(`CREATE DATABASE ${BANCO_DE_CARGA}`);
  await c.end();

  const banco = new pg.Client({ connectionString: admin });
  await banco.connect();
  await banco.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await banco.end();

  const ambiente: Record<string, string | undefined> = { ...process.env, DATABASE_URL: admin };
  // `migrate deploy` não usa banco-sombra; com ela apontada, o Prisma recusa.
  delete ambiente.SHADOW_DATABASE_URL;

  rodar(["prisma", "migrate", "deploy"], ambiente, "aplicar as migrações");
  rodar(
    ["tsx", "scripts/aplicar-rls.mts"],
    { ...ambiente, SENHA_APP_GESTAO: senhaDaApp() },
    "ligar o RLS"
  );
}

function rodar(args: string[], env: Record<string, string | undefined>, oQue: string) {
  try {
    execFileSync("npx", args, {
      env: env as NodeJS.ProcessEnv,
      stdio: "pipe",
      shell: process.platform === "win32",
    });
  } catch (e) {
    const detalhe = e as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(
      `Falha ao ${oQue} no banco de carga:\n${detalhe.stderr?.toString() ?? ""}${detalhe.stdout?.toString() ?? ""}`
    );
  }
}
