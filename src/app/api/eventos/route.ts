import { assinar, type Evento } from "@/lib/eventos";
import { lerSessao } from "@/lib/session";

export const dynamic = "force-dynamic";
// SSE precisa do runtime Node: o stream fica aberto durante todo o turno.
export const runtime = "nodejs";

/** Proxies costumam cortar conexão parada. Um comentário a cada 25s a mantém. */
const BATIDA_MS = 25_000;

/**
 * Fluxo de eventos da unidade do usuário logado.
 *
 * `lerSessao` e não `exigirSessao`: sem sessão isto responde 401, não um
 * redirecionamento para a tela de login — o EventSource seguiria o redirect,
 * receberia HTML e tentaria de novo em laço.
 */
export async function GET(requisicao: Request) {
  const sessao = await lerSessao();
  if (!sessao) return new Response("sem sessão", { status: 401 });

  const unidadeId = sessao.unidadeId;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controle) {
      let vivo = true;

      const enviar = (texto: string) => {
        if (!vivo) return;
        try {
          controle.enqueue(encoder.encode(texto));
        } catch {
          // Cliente sumiu entre o evento e a escrita — encerra sem barulho.
          encerrar();
        }
      };

      const cancelarAssinatura = assinar(unidadeId, (evento: Evento) => {
        enviar(`event: mudanca\ndata: ${JSON.stringify({ motivo: evento.motivo })}\n\n`);
      });

      const batida = setInterval(() => enviar(": batida\n\n"), BATIDA_MS);

      function encerrar() {
        if (!vivo) return;
        vivo = false;
        clearInterval(batida);
        cancelarAssinatura();
        requisicao.signal.removeEventListener("abort", encerrar);
        try {
          controle.close();
        } catch {
          // Já fechado pelo lado do cliente.
        }
      }

      // Fechar a aba, trocar de tela ou perder a rede: tudo chega aqui como
      // abort. Sem isto, cada tablet deixaria um assinante órfão para trás.
      requisicao.signal.addEventListener("abort", encerrar);

      // Primeiro evento imediato: confirma ao cliente que a conexão vale, para
      // ele desligar a sincronização periódica só quando ela é de fato supérflua.
      enviar("event: pronto\ndata: {}\n\n");
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx só para de bufferizar o stream com isto (ou proxy_buffering off).
      "X-Accel-Buffering": "no",
    },
  });
}
