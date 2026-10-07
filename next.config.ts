import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O painel só roda local; não há por que mandar telemetria nem cabeçalho de versão.
  poweredByHeader: false,
};

export default nextConfig;
