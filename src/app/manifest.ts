import type { MetadataRoute } from "next";

/**
 * O que o celular guarda quando alguém escolhe "Adicionar à Tela de Início".
 *
 * `standalone` é o ponto: sem a barra de endereço, sobram uns 90px de altura
 * numa tela onde o mapa de mesas disputa cada linha — e o garçom deixa de
 * poder sair do sistema sem querer, digitando outro endereço.
 *
 * `start_url` aponta para o salão, não para a raiz: quem instala isto no
 * telefone trabalha nas mesas. Quem não tiver turno aberto cai no login pelo
 * middleware, como em qualquer outra entrada.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sistema de Gestão de Restaurantes",
    short_name: "Gestão",
    description: "Salão, cardápio, cozinha e caixa em um só lugar.",
    lang: "pt-BR",
    start_url: "/pdv",
    scope: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icone-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icone-512.png", sizes: "512x512", type: "image/png" },
      // `maskable` deixa o Android recortar no formato do sistema sem cortar
      // as mesas: o desenho já nasce com margem sobrando dos quatro lados.
      { src: "/icone-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
