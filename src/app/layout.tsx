import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Sistema de Gestão de Restaurantes",
    template: "%s · Gestão",
  },
  description: "Salão, cardápio, cozinha e caixa em um só lugar.",
  icons: {
    icon: [
      { url: "/icone-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icone-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    // O nome embaixo do ícone na tela de início. "Sistema de Gestão de
    // Restaurantes" não cabe ali: o iPhone corta no meio.
    title: "Gestão",
    // `default` mantém o conteúdo abaixo do relógio e da bateria. Com
    // `black-translucent` a tela subiria por baixo deles, e o cabeçalho de
    // cada ambiente ficaria escondido atrás da hora.
    statusBarStyle: "default",
  },
  other: {
    /**
     * O Next emite só `mobile-web-app-capable`, que é o nome novo. O Safari
     * passou a aceitá-lo no iOS 16.4; antes disso ele só abre em tela cheia
     * com a tag própria da Apple. Um iPhone velho de salão não é exceção.
     */
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  /**
   * `cover` é o que faz `env(safe-area-inset-bottom)` valer alguma coisa.
   *
   * Sem ele o valor é sempre zero, e o rodapé de navegação encostaria na
   * barra de gestos do iPhone — onde o deslize do sistema ganha do toque no
   * botão. É a mesma conta que reserva o espaço nas telas com barra.
   */
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
