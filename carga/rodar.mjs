/**
 * `npm run teste:dia`: os ataques primeiro, o dia cheio por último.
 *
 * A ordem importa e o vitest não a garante — ele põe na frente o arquivo que
 * demorou ou falhou na rodada anterior. Os dois montam o restaurante "demo"
 * (o único em que o login funciona hoje), e quem roda por último fica no banco.
 * Tem de ser o dia cheio: é sobre ele que o agente navega depois, pelo
 * servidor `carga`, vendo um sábado de verdade em vez de meia dúzia de
 * comandas adulteradas.
 *
 * Cada etapa recria o banco (o `globalSetup`), então uma não herda a sujeira
 * da outra. As duas rodam sempre — a segunda não pode deixar de rodar porque a
 * primeira achou problema — e o resultado de cada uma fica em JSON em
 * `relatorios/teste-do-dia/`, para comparar uma rodada com a anterior.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const etapas = [
  ["carga/ataques.test.ts", "ataques.json"],
  ["carga/dia-cheio.test.ts", "dia-cheio.json"],
];

let falhou = false;
for (const [arquivo, saida] of etapas) {
  console.log(`\n=== ${arquivo} ===\n`);
  const r = spawnSync(
    "npx",
    [
      "vitest",
      "run",
      "--config",
      "vitest.carga.config.ts",
      arquivo,
      "--reporter=default",
      "--reporter=json",
      `--outputFile.json=relatorios/teste-do-dia/${saida}`,
    ],
    { cwd: raiz, stdio: "inherit", shell: process.platform === "win32" }
  );
  if (r.status !== 0) falhou = true;
}

process.exit(falhou ? 1 : 0);
