/**
 * Sobe o Next contra o banco com RLS ligado, pela role `app_gestao`.
 *
 * O `npm run dev` normal conecta no `prisma dev`, que roda como superusuário e
 * atravessa toda política — ali o isolamento parece funcionar mesmo quando não
 * está. Este script existe para ver o sistema como o cliente vai vê-lo: se
 * algum caminho esquecer de declarar o restaurante, a tela vem vazia aqui, e
 * não em produção.
 *
 * Não mexe no `.env`: as variáveis são trocadas só neste processo, e o Next
 * respeita o que já está no ambiente em vez de sobrescrever com o arquivo.
 *
 * Uso: node scripts/dev-com-rls.mjs [porta]
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

/**
 * Caminhos derivados do arquivo, não do diretório de onde foi chamado: este
 * script é lançado pelo painel de preview, que roda a partir da pasta de cima.
 */
const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
dotenv.config({ path: join(raiz, ".env"), quiet: true });

const faltando = ["RLS_DATABASE_URL", "TEST_DATABASE_URL"].filter((v) => !process.env[v]);
if (faltando.length > 0) {
  console.error(`Defina ${faltando.join(" e ")} no .env — veja o .env.example.`);
  process.exit(1);
}

const porta = process.argv[2] ?? "3002";

// A aplicação vive sob as políticas...
process.env.DATABASE_URL = process.env.RLS_DATABASE_URL;
// ...e só a descoberta do restaurante atravessa.
process.env.DATABASE_URL_SEM_RLS = process.env.TEST_DATABASE_URL;

console.log(`Next em http://localhost:${porta} — banco sob RLS, como app_gestao.\n`);

spawn("npx", ["next", "dev", "-p", porta], {
  cwd: raiz,
  stdio: "inherit",
  shell: process.platform === "win32",
}).on("exit", (codigo) => process.exit(codigo ?? 0));
