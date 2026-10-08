/**
 * GET que só fala com endereços públicos da internet.
 *
 * Os domínios verificados vêm de dados públicos (e-mail do cadastro da Receita, site no
 * OpenStreetMap). Qualquer pessoa pode abrir um CNPJ com um domínio que aponta para 127.0.0.1 ou
 * 192.168.0.1: sem esta barreira, o verificador faria requisições para dentro da rede de quem
 * usa a ferramenta (SSRF). A checagem acontece na resolução de nome de cada conexão — inclusive
 * de cada redirecionamento —, então um domínio que muda de IP entre a checagem e a conexão
 * (DNS rebinding) também é barrado.
 */
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";

const INTERNOS = new BlockList();
for (const [rede, prefixo] of [
  ["0.0.0.0", 8], // "esta rede"
  ["10.0.0.0", 8], // privada
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (inclui metadados de nuvem 169.254.169.254)
  ["172.16.0.0", 12], // privada
  ["192.0.0.0", 24], // reservada IETF
  ["192.168.0.0", 16], // privada
  ["198.18.0.0", 15], // testes de desempenho
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reservada
] as const) {
  INTERNOS.addSubnet(rede, prefixo, "ipv4");
}
for (const [rede, prefixo] of [
  ["::", 128], // não especificado
  ["::1", 128], // loopback
  ["fc00::", 7], // privada (ULA)
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  INTERNOS.addSubnet(rede, prefixo, "ipv6");
}

/** true se o IP é da internet pública; false para loopback, rede privada, link-local etc. */
export function ipPublico(ip: string): boolean {
  const versao = isIP(ip);
  if (versao === 4) return !INTERNOS.check(ip, "ipv4");
  if (versao === 6) {
    // IPv4 embutido em IPv6 (::ffff:127.0.0.1) vale pelo IPv4.
    const embutido = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
    if (embutido) return ipPublico(embutido);
    return !INTERNOS.check(ip, "ipv6");
  }
  return false;
}

export class EnderecoInterno extends Error {
  readonly code = "EENDERECOINTERNO";
  constructor(host: string) {
    super(`${host} aponta para um endereço interno; não acesso`);
  }
}

type CallbackLookup = (erro: NodeJS.ErrnoException | null, endereco: string | LookupAddress[], familia?: number) => void;
export type FuncaoLookup = (host: string, opcoes: LookupOptions, callback: CallbackLookup) => void;

/** Resolve o nome e descarta endereços internos; se não sobrar nenhum, falha. */
export function criarLookupSeguro(resolver: FuncaoLookup = dnsLookup as unknown as FuncaoLookup): FuncaoLookup {
  return (host, opcoes, callback) => {
    resolver(host, { ...opcoes, all: true }, (erro, enderecos) => {
      if (erro) return callback(erro, "");
      const publicos = (enderecos as LookupAddress[]).filter((e) => ipPublico(e.address));
      if (publicos.length === 0) return callback(new EnderecoInterno(host), "");
      if (opcoes.all) return callback(null, publicos);
      callback(null, publicos[0]!.address, publicos[0]!.family);
    });
  };
}

export interface OpcoesGet {
  seguirRedirecionamento: boolean;
  userAgent: string;
  tempoLimiteMs: number;
  /** Para testes; o padrão é o lookup seguro sobre o DNS do sistema. */
  lookup?: FuncaoLookup;
  maxRedirecionamentos?: number;
}

/**
 * Faz um GET e devolve só o status. O corpo nunca é lido (é descartado), então resposta enorme
 * ou maliciosa não ocupa memória.
 */
export function getStatus(url: string, opcoes: OpcoesGet): Promise<number> {
  const lookup = opcoes.lookup ?? criarLookupSeguro();
  const restantes = opcoes.maxRedirecionamentos ?? 5;
  return new Promise((resolve, reject) => {
    let alvo: URL;
    try {
      alvo = new URL(url);
    } catch (erro) {
      return reject(erro);
    }
    if (alvo.protocol !== "http:" && alvo.protocol !== "https:") {
      return reject(new Error(`protocolo não permitido: ${alvo.protocol}`));
    }
    // Endereço IP literal na URL não passa pelo DNS: checa aqui.
    const hostLiteral = alvo.hostname.replace(/^\[|\]$/g, "");
    if (isIP(hostLiteral) && !ipPublico(hostLiteral)) return reject(new EnderecoInterno(hostLiteral));

    const modulo = alvo.protocol === "https:" ? https : http;
    const requisicao = modulo.get(
      alvo,
      {
        lookup: lookup as unknown as http.RequestOptions["lookup"],
        headers: { "User-Agent": opcoes.userAgent, Accept: "text/html,*/*" },
        signal: AbortSignal.timeout(opcoes.tempoLimiteMs),
      },
      (resposta) => {
        resposta.resume();
        const status = resposta.statusCode ?? 0;
        const destino = resposta.headers.location;
        if (opcoes.seguirRedirecionamento && status >= 300 && status < 400 && destino && restantes > 0) {
          getStatus(new URL(destino, alvo).href, { ...opcoes, lookup, maxRedirecionamentos: restantes - 1 }).then(resolve, reject);
          return;
        }
        resolve(status);
      },
    );
    requisicao.on("error", reject);
  });
}
