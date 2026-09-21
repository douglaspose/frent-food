import sharp from "sharp";

/**
 * Uma imagem virando o bitmap de 1 bit que uma impressora térmica entende.
 *
 * Fica separado de `marca-impressa.ts` porque aqui não há banco nem sessão:
 * entra imagem, sai ESC/POS. É o que permite conferir a conversão num teste,
 * que é o único jeito de saber como a logo vai sair no papel sem ter o papel.
 */

export type Raster = {
  /** Os bytes ESC/POS, em base64: alinhamento + `GS v 0` + o bitmap. */
  escpos: string;
  largura: number;
  altura: number;
};

/**
 * 384 pontos de 576.
 *
 * O papel de 80mm tem 576 pontos de largura. A logo ocupar os 576 seria uma
 * faixa de ponta a ponta no topo do cupom — dois terços é o que se vê nos
 * cupons que as casas imprimem, e ainda dá margem para o corte torto.
 *
 * Múltiplo de 8 porque o ESC/POS empacota oito pontos por byte: largura que
 * não fecha byte sai com lixo na borda direita.
 */
const LARGURA = 384;

/** Altura máxima: logo é cabeçalho, não pôster. */
const ALTURA_MAXIMA = 240;

/**
 * Acima disto o ponto é claro e o papel fica em branco.
 *
 * O valor é alto de propósito. Térmica queima mais do que o esperado, e
 * cinza-médio que no monitor parece de leve sai quase preto no papel.
 */
const CORTE = 190;

/**
 * Difusão de erro Floyd–Steinberg.
 *
 * O corte seco resolve texto e traço, mas a sombra de um desenho vira mancha
 * chapada nele. A difusão espalha o erro de cada ponto para os vizinhos e
 * devolve o cinza como textura, que é como jornal imprime foto há um século.
 *
 * Trabalha sobre uma cópia em ponto flutuante porque o erro acumulado
 * estoura o byte nos dois sentidos, e saturar no caminho é o que produz as
 * faixas horizontais que denunciam uma difusão mal feita.
 */
function difundir(cinza: Uint8Array, largura: number, altura: number) {
  const erro = Float32Array.from(cinza);
  const preto = new Uint8Array(largura * altura);

  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const i = y * largura + x;
      const antigo = erro[i]!;
      const novo = antigo < CORTE ? 0 : 255;
      preto[i] = novo === 0 ? 1 : 0;

      const sobra = antigo - novo;
      // Os pesos são os do Floyd–Steinberg: 7/16 à direita, e 3/16, 5/16 e
      // 1/16 na linha de baixo.
      if (x + 1 < largura) erro[i + 1]! += (sobra * 7) / 16;
      if (y + 1 < altura) {
        if (x > 0) erro[i + largura - 1]! += (sobra * 3) / 16;
        erro[i + largura]! += (sobra * 5) / 16;
        if (x + 1 < largura) erro[i + largura + 1]! += (sobra * 1) / 16;
      }
    }
  }

  return preto;
}

/**
 * Empacota o bitmap no comando de raster do ESC/POS.
 *
 * `GS v 0` é o comando que toda térmica de 80mm entende, incluindo as clones
 * chinesas que são a maioria do mercado brasileiro. As alternativas mais
 * novas (`GS ( L`) são mais capazes e menos suportadas — e aqui o que se
 * imprime é uma logo, não um gráfico.
 */
function empacotar(preto: Uint8Array, largura: number, altura: number) {
  const bytesPorLinha = largura / 8;
  const dados = Buffer.alloc(bytesPorLinha * altura);

  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      if (!preto[y * largura + x]) continue;
      // O bit mais significativo é o ponto mais à esquerda do byte.
      dados[y * bytesPorLinha + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }

  return Buffer.concat([
    // ESC a 1 — centraliza. Sem isto a logo sai colada na margem esquerda.
    Buffer.from([0x1b, 0x61, 0x01]),
    Buffer.from([
      0x1d,
      0x76,
      0x30,
      0x00,
      bytesPorLinha & 0xff,
      (bytesPorLinha >> 8) & 0xff,
      altura & 0xff,
      (altura >> 8) & 0xff,
    ]),
    dados,
    // ESC a 0 — devolve o alinhamento à esquerda, senão o cupom inteiro sai
    // centralizado e o layout de 48 colunas perde o sentido.
    Buffer.from([0x1b, 0x61, 0x00]),
    Buffer.from("\n"),
  ]);
}

export async function converterParaTermica(imagem: Uint8Array): Promise<Raster> {
  const { data, info } = await sharp(imagem)
    // O papel é branco: o que era transparente tem de virar branco, não preto.
    // Sem isto, um PNG com fundo transparente sai como um retângulo queimado.
    .flatten({ background: "#ffffff" })
    .resize({
      width: LARGURA,
      height: ALTURA_MAXIMA,
      fit: "inside",
      withoutEnlargement: true,
      background: "#ffffff",
    })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // A largura precisa fechar byte. Sobrando pontos, completa com branco à
  // direita — em vez de esticar a imagem, que deformaria a marca.
  const largura = Math.ceil(info.width / 8) * 8;
  const altura = info.height;

  const cinza = new Uint8Array(largura * altura).fill(255);
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < info.width; x++) {
      cinza[y * largura + x] = data[y * info.width + x]!;
    }
  }

  const preto = difundir(cinza, largura, altura);

  return {
    escpos: empacotar(preto, largura, altura).toString("base64"),
    largura,
    altura,
  };
}
