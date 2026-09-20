import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * O script de RLS é uma lista escrita à mão que precisa acompanhar o schema.
 *
 * Tabela nova sem política não dá erro em lugar nenhum: o banco segue
 * funcionando, o script segue aplicando, e aquela tabela simplesmente entrega
 * os dados de todos os restaurantes no dia em que uma consulta escapar do
 * guarda de aplicação. Este teste é o que transforma esse esquecimento em
 * suíte vermelha.
 *
 * Foi assim que `notas_fiscais` e `perfis_fiscais` apareceram: estavam no
 * schema com `tenantId` e fora do script.
 */

const schema = readFileSync("prisma/schema.prisma", "utf8");
const sql = readFileSync("prisma/rls.sql", "utf8");

type Modelo = { nome: string; tabela: string; temTenantId: boolean };

const modelos: Modelo[] = schema
  .split(/\nmodel /)
  .slice(1)
  .map((bloco) => ({
    nome: bloco.slice(0, bloco.indexOf(" ")).trim(),
    tabela: /@@map\("([^"]+)"\)/.exec(bloco)?.[1] ?? bloco.slice(0, bloco.indexOf(" ")).trim(),
    temTenantId: /^\s*tenantId\s+String/m.test(bloco),
  }));

/**
 * Tabelas que não pertencem a restaurante nenhum, e por isso não entram no
 * script. A lista existe para a isenção ser uma decisão escrita, e não um
 * esquecimento que passou: quem acrescentar um nome aqui tem que dizer por quê.
 *
 * - `tenants` tem política própria, testada mais abaixo.
 * - `freios_de_tentativa` é o contador de força bruta, consultado **antes**
 *   do login, quando ainda não se sabe de quem é a tentativa. Não guarda dado
 *   de negócio — só uma chave de origem e um número — e amarrá-la a um tenant
 *   daria a quem ataca um jeito de escolher qual contador gastar.
 */
const SEM_DONO = new Set(["tenants", "freios_de_tentativa"]);

/** Toda tabela citada entre aspas simples no script. */
const noScript = new Set([...sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!));

describe("script de RLS", () => {
  it("cobre toda tabela que carrega tenantId", () => {
    const faltando = modelos
      .filter((m) => m.temTenantId && !noScript.has(m.tabela))
      .map((m) => `${m.tabela} (model ${m.nome})`);

    expect(faltando, `acrescente ao prisma/rls.sql: ${faltando.join(", ")}`).toEqual([]);
  });

  it("cobre também as tabelas-filhas, que não têm tenantId", () => {
    /**
     * Estas não podem ser esquecidas por não terem a coluna: `cardapio_itens`
     * sem política entrega cardápio e preço de todo mundo, e `composicoes`
     * entrega a ficha técnica — a receita da casa.
     */
    const semTenantId = modelos.filter((m) => !m.temTenantId && !SEM_DONO.has(m.tabela));
    const faltando = semTenantId.filter((m) => !noScript.has(m.tabela)).map((m) => m.tabela);

    expect(faltando, `tabela-filha sem política: ${faltando.join(", ")}`).toEqual([]);
  });

  it("protege a própria tabela de restaurantes", () => {
    // Sem isto, uma consulta escapada devolve a lista de clientes do SaaS.
    expect(sql).toMatch(/ALTER TABLE tenants ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/CREATE POLICY isolamento_tenant ON tenants/);
  });

  it("usa FORCE em toda tabela, para o dono da tabela não escapar", () => {
    // Sem FORCE, o dono do schema — que é quem roda as migrations — ignora a
    // política, e um script de manutenção passaria por cima sem avisar.
    expect(sql).toMatch(/FORCE ROW LEVEL SECURITY/);
  });

  it("lê o tenant com fallback, para consulta sem tenant voltar vazia", () => {
    /**
     * `current_setting('app.tenant_id')` sem o segundo argumento **lança** se a
     * variável não existir. Dentro de uma política, isso derruba a consulta com
     * erro em vez de devolver nada — e a diferença entre "erro" e "vazio" é a
     * diferença entre o restaurante parar e o restaurante ficar protegido.
     */
    expect(sql).not.toMatch(/current_setting\('app\.tenant_id'\)/);
    expect(sql).toMatch(/current_setting\(''app\.tenant_id'', true\)|current_setting\('app\.tenant_id', true\)/);
  });

  it("cria a role da aplicação sem permissão de ignorar RLS", () => {
    expect(sql).toMatch(/CREATE ROLE app_gestao .*NOBYPASSRLS/);
  });
});
