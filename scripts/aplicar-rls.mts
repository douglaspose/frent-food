/**
 * Aplica o `prisma/rls.sql` num banco e cria a role da aplicação.
 *
 * O `rls.sql` sozinho não roda: a seção 1 cria a role com uma senha de
 * exemplo e dá `GRANT CONNECT` num banco chamado `gestao_restaurante`. Aqui a
 * senha vem de fora e o banco é o que estiver na URL — é o que permite aplicar
 * no banco de teste, no de homologação e no de produção com o mesmo arquivo.
 *
 * Uso:
 *   DATABASE_URL="postgres://postgres:...@host/banco" \
 *   SENHA_APP_GESTAO="..." npx tsx scripts/aplicar-rls.mts
 *
 * A URL precisa ser de um superusuário (ou do dono do banco): quem aplica
 * política não é quem vive sob ela. Depois, aponte a aplicação para
 * `app_gestao` e prove com `npm run rls:verificar`.
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import pg from "pg";

const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const senha = process.env.SENHA_APP_GESTAO;

if (!url) {
  console.error("Defina DATABASE_URL (ou TEST_DATABASE_URL) apontando para o banco.");
  process.exit(1);
}
if (!senha) {
  console.error("Defina SENHA_APP_GESTAO com a senha da role da aplicação.");
  process.exit(1);
}

const db = new pg.Client({ connectionString: url });
await db.connect();

const { rows: quem } = await db.query<{ db: string; su: string }>(
  "select current_database() db, current_setting('is_superuser') su"
);
console.log(`Aplicando em ${quem[0]!.db} (superusuário: ${quem[0]!.su})`);

/**
 * A role vem antes das políticas porque as políticas não a mencionam — elas
 * valem para todo mundo que não atravessa RLS. Criar depois funcionaria
 * igual; criar antes deixa o erro de senha aparecer sem ter mexido no banco.
 */
await db.query(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_gestao') THEN
      CREATE ROLE app_gestao LOGIN NOBYPASSRLS;
    END IF;
  END $$
`);
await db.query(`ALTER ROLE app_gestao WITH LOGIN NOBYPASSRLS PASSWORD ${literal(senha)}`);
await db.query(
  `DO $$ BEGIN
     EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_gestao', current_database());
   END $$`
);
await db.query(`GRANT USAGE ON SCHEMA public TO app_gestao`);
await db.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_gestao`);
await db.query(
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public
     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_gestao`
);
console.log("  role app_gestao pronta (LOGIN, NOBYPASSRLS)");

/**
 * Só as seções 2 em diante: a 1 é a criação da role, que acabou de ser feita
 * aqui com a senha de verdade e o nome certo do banco.
 */
const arquivo = await readFile("prisma/rls.sql", "utf8");
const corte = arquivo.indexOf("-- 2) Tabelas que carregam");
if (corte < 0) {
  console.error("Não achei a seção 2 em prisma/rls.sql — o arquivo mudou de forma.");
  process.exit(1);
}

await db.query(arquivo.slice(corte));
console.log("  políticas aplicadas");

const { rows: contagem } = await db.query<{ n: number }>(
  `select count(*)::int n from pg_policies where policyname = 'isolamento_tenant'`
);
console.log(`\n${contagem[0]!.n} tabelas com a política isolamento_tenant.\n`);

await db.end();

/** Escapa a senha como literal SQL: ALTER ROLE não aceita parâmetro. */
function literal(valor: string) {
  return `'${valor.replace(/'/g, "''")}'`;
}
