/**
 * O sistema de pé sobre o dia simulado, para o passeio pelas telas.
 *
 * `next start` na porta 3003, com o build de produção, apontando para o
 * `gestao_carga` — que depois do `npm run teste:dia` tem um sábado inteiro de
 * movimento: centenas de comandas, pagamentos, sangria, caixa fechado. O agente
 * de testes navega e mexe aqui à vontade.
 *
 * Nunca no `gestao_dev`: aquele é o banco da demonstração, e o servidor da
 * porta 3001 continua sendo dele.
 *
 * Mesma topologia do simulador: a aplicação entra como `app_gestao`, sob RLS;
 * o `dbSemRls` usa o dono do banco. Pede o build pronto (`npm run build`).
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";

// A raiz do projeto sai do próprio arquivo, e não da pasta de onde ele foi
// chamado: o `launch.json` da pasta-mãe roda tudo a partir de `Projetos_Claude`,
// e lá não há `.env` nem `next` deste projeto.
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(raiz, ".env"), quiet: true });

function comBanco(url, banco) {
  const u = new URL(url);
  u.pathname = `/${banco}`;
  return u.toString();
}

for (const nome of ["TEST_DATABASE_URL", "RLS_DATABASE_URL", "AUTH_SECRET"]) {
  if (!process.env[nome]) {
    console.error(`Defina ${nome} no .env: o servidor de carga depende dela.`);
    process.exit(1);
  }
}

const env = {
  ...process.env,
  DATABASE_URL: comBanco(process.env.RLS_DATABASE_URL, "gestao_carga"),
  DATABASE_URL_SEM_RLS: comBanco(process.env.TEST_DATABASE_URL, "gestao_carga"),
  NEXT_PUBLIC_APP_URL: "http://localhost:3003",
  PORT: "3003",
};

const filho = spawn("npx", ["next", "start", "-p", "3003"], {
  cwd: raiz,
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});
filho.on("exit", (codigo) => process.exit(codigo ?? 0));
