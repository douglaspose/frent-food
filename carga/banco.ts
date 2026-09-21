/**
 * Onde o dia simulado acontece: `gestao_carga`, no mesmo Postgres dos testes.
 *
 * Banco próprio, e nunca o de desenvolvimento. Um dia cheio grava centenas de
 * comandas e milhares de itens; rodar isso no `gestao_dev` enterraria os dados
 * de demonstração sob uma operação inventada. E também nunca o `gestao_teste`:
 * a suíte normal apaga o schema dele no começo de cada execução, e as duas
 * rodando juntas apagariam o trabalho uma da outra.
 *
 * A topologia é a de produção, com três endereços para o mesmo banco:
 *
 *   - **app** — `app_gestao`, sem BYPASSRLS. É por onde passam as server
 *     actions. O RLS vale aqui como vale no servidor: uma consulta que esquece
 *     de declarar o restaurante volta vazia, e o dia simulado vê isso.
 *   - **semRls** — o dono do banco, no papel da role com BYPASSRLS que o
 *     `dbSemRls` usa em produção (login, rota da logo).
 *   - **admin** — também o dono, mas para o simulador: montar o restaurante e,
 *     no fim, conferir tudo enxergando todos os restaurantes.
 *
 * Os endereços saem das variáveis que já existem, trocando só o nome do banco —
 * nada de credencial nova para configurar.
 */

function comBanco(url: string, banco: string) {
  const u = new URL(url);
  u.pathname = `/${banco}`;
  return u.toString();
}

function exigir(nome: string) {
  const valor = process.env[nome];
  if (!valor) throw new Error(`Defina ${nome}: o banco de carga é derivado dela.`);
  return valor;
}

export const BANCO_DE_CARGA = "gestao_carga";

/** O dono do banco. */
export function urlAdmin() {
  return comBanco(exigir("TEST_DATABASE_URL"), BANCO_DE_CARGA);
}

/** A role da aplicação, sob RLS. */
export function urlApp() {
  return comBanco(exigir("RLS_DATABASE_URL"), BANCO_DE_CARGA);
}

/** A senha da role da aplicação, para o `aplicar-rls` recriá-la igual. */
export function senhaDaApp() {
  return decodeURIComponent(new URL(exigir("RLS_DATABASE_URL")).password);
}
