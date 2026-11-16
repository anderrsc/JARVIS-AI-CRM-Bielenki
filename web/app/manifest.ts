import type { MetadataRoute } from "next";

// Instalável no celular (Adicionar à tela inicial): abre direto na conversa, em tela cheia.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "JARVIS",
    short_name: "JARVIS",
    description: "Assessor executivo — Marquinhos Calhas e Esquadrias e Bielenki Metal",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#050b12",
    theme_color: "#050b12",
    lang: "pt-BR",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
