import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

/**
 * Os endereços desta máquina na rede local.
 *
 * Em desenvolvimento o Next só entrega os arquivos de `/_next` para a origem
 * que ele mesmo serve. Abrindo pelo IP — que é como o celular chega — a página
 * aparece inteira e **sem JavaScript**: o teclado do PIN desenha e nenhum
 * número responde, porque a hidratação nunca acontece. O aviso sai no terminal
 * do `next dev`, não no navegador, então é fácil passar batido.
 *
 * Descobrir em vez de fixar porque o IP é do DHCP: reiniciar o roteador troca
 * o número e o celular pararia de funcionar de novo, sem nada ter mudado aqui.
 */
function enderecosDaRedeLocal() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i!.address);
}

const nextConfig: NextConfig = {
  // Só tem efeito em `next dev`; em produção a opção não existe.
  //
  // `127.0.0.1` entra à mão porque a busca acima descarta as interfaces
  // internas. O Next libera `localhost` sozinho, mas não o endereço numérico —
  // e os dois são hosts diferentes para o navegador. Abrir por ele dava
  // exatamente a página morta que este arquivo existe para evitar.
  allowedDevOrigins: ["127.0.0.1", ...enderecosDaRedeLocal()],
};

export default nextConfig;
