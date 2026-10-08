import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O painel só roda local; não há por que anunciar a versão.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Nenhum outro site pode embutir o painel num iframe e induzir cliques.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Ao abrir o WhatsApp ou o Google, o endereço do painel (com filtros) não vai junto.
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
