import { db } from "./db";
import { atravessandoRestaurantes } from "./tenant-atual";

/**
 * Freio contra força bruta no login.
 *
 * Um PIN de 4 dígitos tem 10 mil combinações: sem freio, um script acerta em
 * minutos. Com 5 tentativas por janela de 15 minutos, a mesma varredura levaria
 * semanas.
 *
 * O estado mora no Postgres, e não na memória do processo, porque memória não
 * resolve o ataque paciente: duas instâncias atrás de um balanceador contariam
 * cinco tentativas **cada**, e reiniciar a aplicação zerava o castigo de quem
 * estava no meio da varredura. Quem ataca não precisa saber disso para se
 * beneficiar — basta insistir.
 */

const MAX_TENTATIVAS = 5;
const JANELA_MS = 15 * 60 * 1000;
const EXPURGO_A_CADA = 200;

/**
 * O freio conta tentativas por origem — um IP, não um restaurante. Sua tabela
 * não tem `tenantId` e é a única, junto com `tenants`, que o RLS deixa de
 * fora; a lista está no `rls.test.ts`.
 *
 * A marca existe para a distinção entre "atravessa de propósito" e "esqueceu
 * de declarar" continuar valendo: estas consultas acontecem antes do login,
 * quando não há restaurante nenhum para declarar, e sem a marca apareceriam
 * como descuido a cada tentativa de entrar.
 */
const semDono = <T>(fn: () => Promise<T>) =>
  atravessandoRestaurantes("freio de tentativas: conta por IP, não por restaurante", fn);

let operacoes = 0;

export type Veredito =
  | { bloqueado: false; restantes: number }
  | { bloqueado: true; segundosRestantes: number };

function liberado(): Veredito {
  return { bloqueado: false, restantes: MAX_TENTATIVAS };
}

function julgar(tentativas: number, expiraEm: Date, agora: number): Veredito {
  if (expiraEm.getTime() <= agora) return liberado();

  return tentativas >= MAX_TENTATIVAS
    ? { bloqueado: true, segundosRestantes: Math.ceil((expiraEm.getTime() - agora) / 1000) }
    : { bloqueado: false, restantes: MAX_TENTATIVAS - tentativas };
}

/**
 * Soma uma falha e devolve o veredito já atualizado.
 *
 * Tudo num comando só, de propósito. Ler-somar-gravar em três passos deixaria
 * duas tentativas simultâneas lerem o mesmo valor e gravarem o mesmo número —
 * duas tentativas custando uma, que é exatamente o que um ataque em paralelo
 * procura. Aqui o banco serializa no bloqueio da linha.
 *
 * O `CASE` cuida da janela vencida: em vez de apagar e recriar (duas idas, e
 * uma corrida no meio), a mesma linha volta a contar do um.
 */
export async function registrarFalha(chave: string, agora = Date.now()): Promise<Veredito> {
  const momento = new Date(agora);
  const novoFim = new Date(agora + JANELA_MS);

  const [linha] = await semDono(
    () => db.$queryRaw<{ tentativas: number; expiraEm: Date }[]>`
      INSERT INTO freios_de_tentativa (chave, tentativas, "expiraEm")
      VALUES (${chave}, 1, ${novoFim})
      ON CONFLICT (chave) DO UPDATE SET
        tentativas = CASE
          WHEN freios_de_tentativa."expiraEm" <= ${momento} THEN 1
          ELSE freios_de_tentativa.tentativas + 1
        END,
        "expiraEm" = CASE
          WHEN freios_de_tentativa."expiraEm" <= ${momento} THEN ${novoFim}
          ELSE freios_de_tentativa."expiraEm"
        END
      RETURNING tentativas, "expiraEm"
    `
  );

  await talvezExpurgar(momento);

  return julgar(linha.tentativas, linha.expiraEm, agora);
}

export async function verificar(chave: string, agora = Date.now()): Promise<Veredito> {
  const registro = await semDono(() =>
    db.freioDeTentativas.findUnique({
      where: { chave },
      select: { tentativas: true, expiraEm: true },
    })
  );

  if (!registro) return liberado();
  return julgar(registro.tentativas, registro.expiraEm, agora);
}

/** Login certo zera o contador — quem sabe a senha não deve ficar de castigo. */
export async function limparFalhas(chave: string) {
  await semDono(() => db.freioDeTentativas.deleteMany({ where: { chave } }));
}

/**
 * Varre as linhas vencidas de vez em quando.
 *
 * Uma por acesso seria desperdício, e um agendador seria peça nova para
 * manter. Como cada linha morre sozinha em 15 minutos, o atraso do expurgo não
 * afeta ninguém — só o tamanho da tabela.
 */
async function talvezExpurgar(agora: Date) {
  if (++operacoes % EXPURGO_A_CADA !== 0) return;
  await semDono(() => db.freioDeTentativas.deleteMany({ where: { expiraEm: { lte: agora } } }));
}

/** Só para os testes: devolve o freio ao estado inicial. */
export async function zerarTudo() {
  await semDono(() => db.freioDeTentativas.deleteMany({}));
  operacoes = 0;
}
