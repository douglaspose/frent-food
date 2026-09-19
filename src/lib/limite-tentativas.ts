/**
 * Freio contra força bruta no login.
 *
 * Um PIN de 4 dígitos tem 10 mil combinações: sem freio, um script acerta em
 * minutos. Com 5 tentativas por janela de 15 minutos, a mesma varredura levaria
 * semanas.
 *
 * O estado mora em memória de propósito — a aplicação roda como um processo só
 * na VPS. Se um dia virar mais de uma instância, isto precisa migrar para o
 * Postgres ou Redis, senão cada instância conta separado.
 */

const MAX_TENTATIVAS = 5;
const JANELA_MS = 15 * 60 * 1000;
const LIMPEZA_A_CADA = 500;

type Registro = { tentativas: number; expiraEm: number };

const registros = new Map<string, Registro>();
let operacoes = 0;

/** Remove entradas vencidas para o mapa não crescer para sempre. */
function limpar(agora: number) {
  for (const [chave, registro] of registros) {
    if (registro.expiraEm <= agora) registros.delete(chave);
  }
}

export type Veredito =
  | { bloqueado: false; restantes: number }
  | { bloqueado: true; segundosRestantes: number };

export function registrarFalha(chave: string, agora = Date.now()): Veredito {
  if (++operacoes % LIMPEZA_A_CADA === 0) limpar(agora);

  const atual = registros.get(chave);
  const registro =
    atual && atual.expiraEm > agora
      ? { tentativas: atual.tentativas + 1, expiraEm: atual.expiraEm }
      : { tentativas: 1, expiraEm: agora + JANELA_MS };

  registros.set(chave, registro);

  return registro.tentativas >= MAX_TENTATIVAS
    ? { bloqueado: true, segundosRestantes: Math.ceil((registro.expiraEm - agora) / 1000) }
    : { bloqueado: false, restantes: MAX_TENTATIVAS - registro.tentativas };
}

export function verificar(chave: string, agora = Date.now()): Veredito {
  const registro = registros.get(chave);
  if (!registro || registro.expiraEm <= agora) return { bloqueado: false, restantes: MAX_TENTATIVAS };

  return registro.tentativas >= MAX_TENTATIVAS
    ? { bloqueado: true, segundosRestantes: Math.ceil((registro.expiraEm - agora) / 1000) }
    : { bloqueado: false, restantes: MAX_TENTATIVAS - registro.tentativas };
}

/** Login certo zera o contador — quem sabe a senha não deve ficar de castigo. */
export function limparFalhas(chave: string) {
  registros.delete(chave);
}

/** Só para os testes: devolve o freio ao estado inicial. */
export function zerarTudo() {
  registros.clear();
  operacoes = 0;
}
