import { NextResponse, type NextRequest } from "next/server";

const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Nome do servidor sem a porta: "localhost:3000" → "localhost", "[::1]:3000" → "[::1]". */
export function nomeDoHost(cabecalhoHost: string | null): string {
  if (!cabecalhoHost) return "";
  const host = cabecalhoHost.trim().toLowerCase();
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  return host.split(":")[0]!;
}

/**
 * O painel é local e não tem login: só atende quem chama pelo nome local.
 * Isso barra o DNS rebinding — um site malicioso aberto no navegador que faz o próprio domínio
 * apontar para 127.0.0.1 para ler o painel. Nesse ataque o cabeçalho Host é o domínio do
 * atacante, e a requisição é recusada aqui.
 */
export function hostPermitido(cabecalhoHost: string | null): boolean {
  return HOSTS_LOCAIS.has(nomeDoHost(cabecalhoHost));
}

export function proxy(request: NextRequest) {
  if (!hostPermitido(request.headers.get("host"))) {
    return new NextResponse("Painel do garimpo: acesso só por http://localhost.", { status: 403 });
  }
  return NextResponse.next();
}
