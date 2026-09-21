import { bytesDaLogomarca } from "@/lib/logomarca";
import { doEndereco } from "@/lib/marca";

/**
 * Serve uma versão da logomarca da casa.
 *
 * Rota pública de propósito: o login é anterior à sessão e a tela do QR é
 * aberta pelo cliente na mesa. Uma logomarca é a coisa mais pública que um
 * restaurante tem, e o id do tenant é um cuid opaco — não dá para varrer.
 *
 * O cache é eterno porque a URL carrega a versão (`?v=` com o instante da
 * troca): o navegador guarda para sempre e mesmo assim vê a logo nova no
 * segundo em que ela é enviada, porque o endereço muda junto.
 */
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string; fundo: string }> }
) {
  const { id, fundo } = await params;

  const qual = doEndereco(fundo);
  if (!qual) return new Response("Fundo desconhecido", { status: 404 });

  const logo = await bytesDaLogomarca(id, qual);
  if (!logo) return new Response("Sem logomarca", { status: 404 });

  return new Response(new Uint8Array(logo.bytes), {
    headers: {
      "Content-Type": logo.tipo,
      "Cache-Control": "public, max-age=31536000, immutable",
      // A imagem é de uma empresa, mas o navegador não deve inferir tipo
      // nenhum a partir do conteúdo: o que vale é o que foi validado no envio.
      "X-Content-Type-Options": "nosniff",
    },
  });
}
