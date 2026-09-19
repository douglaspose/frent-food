/**
 * Chave de acesso da NFC-e — 44 dígitos que identificam a nota no Brasil
 * inteiro. Mesmo emitindo por gateway, montamos e conferimos a chave aqui:
 * é ela que vai impressa no cupom, no QR Code, e é por ela que o cliente
 * consulta a nota no site da SEFAZ.
 *
 * Composição:
 *   cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) cDV(1)
 */

export const MODELO_NFCE = "65";

/** Emissão normal ou em contingência offline (quando a SEFAZ não responde). */
export const TP_EMIS = { NORMAL: "1", CONTINGENCIA_OFFLINE: "9" } as const;

/** Códigos de UF do IBGE — os dois primeiros dígitos da chave. */
export const CODIGO_UF: Record<string, string> = {
  RO: "11", AC: "12", AM: "13", RR: "14", PA: "15", AP: "16", TO: "17",
  MA: "21", PI: "22", CE: "23", RN: "24", PB: "25", PE: "26", AL: "27",
  SE: "28", BA: "29", MG: "31", ES: "32", RJ: "33", SP: "35", PR: "41",
  SC: "42", RS: "43", MS: "50", MT: "51", GO: "52", DF: "53",
};

export function somenteDigitos(valor: string) {
  return valor.replace(/\D/g, "");
}

function preencher(valor: string | number, tamanho: number) {
  return String(valor).slice(-tamanho).padStart(tamanho, "0");
}

/**
 * Dígito verificador por módulo 11, com pesos 2 a 9 girando da direita para a
 * esquerda. Resto 0 ou 1 vira dígito 0 — regra do manual, não simplificação.
 */
export function digitoVerificador(chave43: string) {
  if (chave43.length !== 43) throw new Error("A chave sem dígito deve ter 43 caracteres.");

  let soma = 0;
  let peso = 2;

  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += Number(chave43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }

  const resto = soma % 11;
  return resto <= 1 ? "0" : String(11 - resto);
}

export type DadosChave = {
  uf: string;
  emissao: Date;
  cnpj: string;
  serie: number;
  numero: number;
  /// Código numérico aleatório da nota — impede adivinhar a chave da próxima.
  codigoNumerico: number;
  tipoEmissao?: string;
};

export function montarChave(dados: DadosChave) {
  const cUF = CODIGO_UF[dados.uf.toUpperCase()];
  if (!cUF) throw new Error(`UF desconhecida: ${dados.uf}`);

  const cnpj = somenteDigitos(dados.cnpj);
  if (cnpj.length !== 14) throw new Error("CNPJ deve ter 14 dígitos.");

  const ano = String(dados.emissao.getFullYear()).slice(-2);
  const mes = preencher(dados.emissao.getMonth() + 1, 2);

  const chave43 =
    cUF +
    ano +
    mes +
    cnpj +
    MODELO_NFCE +
    preencher(dados.serie, 3) +
    preencher(dados.numero, 9) +
    (dados.tipoEmissao ?? TP_EMIS.NORMAL) +
    preencher(dados.codigoNumerico, 8);

  return chave43 + digitoVerificador(chave43);
}

export function chaveValida(chave: string) {
  const limpa = somenteDigitos(chave);
  if (limpa.length !== 44) return false;
  return digitoVerificador(limpa.slice(0, 43)) === limpa[43];
}

/** Formata em blocos de 4 para o cliente conseguir digitar no site da SEFAZ. */
export function formatarChave(chave: string) {
  return somenteDigitos(chave).replace(/(\d{4})(?=\d)/g, "$1 ");
}

/**
 * Código numérico da nota. Aleatório de propósito: sequencial permitiria
 * adivinhar a chave das notas seguintes e consultá-las na SEFAZ.
 */
export function gerarCodigoNumerico() {
  return Math.floor(Math.random() * 100_000_000);
}
