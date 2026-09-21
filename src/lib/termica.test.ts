import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { converterParaTermica } from "./termica";

/**
 * Impressora térmica é o periférico que menos se tem à mão para testar, e o
 * erro só aparece no papel, longe de quem escreveu o código. Estes testes
 * conferem o que dá para conferir sem papel: o cabeçalho que a impressora lê
 * e quais pontos ela vai queimar.
 */

/** Um quadrado de uma cor só, no formato que o conversor recebe. */
async function quadrado(cor: string, lado = 64, alfa = 1) {
  return new Uint8Array(
    await sharp({
      create: { width: lado, height: lado, channels: 4, background: { ...corDe(cor), alpha: alfa } },
    })
      .png()
      .toBuffer()
  );
}

function corDe(hex: string) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/** Só o bitmap: pula os 3 bytes de alinhamento e os 8 do `GS v 0`. */
function bitmap(escpos: string, largura: number, altura: number) {
  return Buffer.from(escpos, "base64").subarray(11, 11 + (largura / 8) * altura);
}

describe("converterParaTermica", () => {
  it("abre centralizando e fecha voltando à esquerda", async () => {
    const r = await converterParaTermica(await quadrado("#000000"));
    const bytes = Buffer.from(r.escpos, "base64");

    expect([...bytes.subarray(0, 3)]).toEqual([0x1b, 0x61, 0x01]);
    // Fecha com ESC a 0 e uma quebra: sem devolver o alinhamento, o cupom
    // inteiro sairia centralizado e o layout de 48 colunas perderia o sentido.
    expect([...bytes.subarray(-4)]).toEqual([0x1b, 0x61, 0x00, 0x0a]);
  });

  it("escreve o cabeçalho GS v 0 com largura em bytes e altura em linhas", async () => {
    const r = await converterParaTermica(await quadrado("#000000"));
    const bytes = Buffer.from(r.escpos, "base64");

    expect([...bytes.subarray(3, 7)]).toEqual([0x1d, 0x76, 0x30, 0x00]);
    // Os dois pares seguintes são little-endian: bytes por linha, depois linhas.
    expect(bytes[7]! | (bytes[8]! << 8)).toBe(r.largura / 8);
    expect(bytes[9]! | (bytes[10]! << 8)).toBe(r.altura);
  });

  it("queima todo ponto de uma imagem preta", async () => {
    const r = await converterParaTermica(await quadrado("#000000"));
    const dados = bitmap(r.escpos, r.largura, r.altura);

    // Cada bit em 1 é um ponto queimado. A imagem é quadrada e a largura é
    // arredondada para fechar byte, então a sobra à direita fica branca.
    const queimados = dados.reduce((n, b) => n + b.toString(2).split("1").length - 1, 0);
    expect(queimados).toBe(r.altura * r.altura);
  });

  it("não queima nada numa imagem branca", async () => {
    const r = await converterParaTermica(await quadrado("#ffffff"));
    expect(bitmap(r.escpos, r.largura, r.altura).every((b) => b === 0)).toBe(true);
  });

  /**
   * O erro mais provável do arquivo inteiro. Logo boa é PNG com fundo
   * transparente; sem achatar sobre branco, o transparente entra como preto e
   * a casa recebe um retângulo queimado de ponta a ponta no lugar da marca.
   */
  it("trata fundo transparente como papel, não como tinta", async () => {
    const r = await converterParaTermica(await quadrado("#000000", 64, 0));
    expect(bitmap(r.escpos, r.largura, r.altura).every((b) => b === 0)).toBe(true);
  });

  it("cabe no papel: nunca passa de 384 pontos, e a largura fecha byte", async () => {
    const largo = new Uint8Array(
      await sharp({ create: { width: 2000, height: 400, channels: 3, background: "#000000" } })
        .png()
        .toBuffer()
    );
    const r = await converterParaTermica(largo);

    expect(r.largura).toBeLessThanOrEqual(384);
    expect(r.largura % 8).toBe(0);
    expect(r.altura).toBeLessThanOrEqual(240);
  });

  it("não estica imagem pequena", async () => {
    const r = await converterParaTermica(await quadrado("#000000", 40));
    // 40 pontos não fecham byte: sobe para 40, que é múltiplo de 8 — e não
    // para os 384 da largura máxima.
    expect(r.largura).toBe(40);
    expect(r.altura).toBe(40);
  });
});
