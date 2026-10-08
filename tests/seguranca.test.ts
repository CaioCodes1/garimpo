import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hostPermitido } from "@/proxy";
import { criarLookupSeguro, EnderecoInterno, getStatus, ipPublico, type FuncaoLookup } from "@/verificador/http-seguro";
import { classificarErroHttp, verificarAlvo, type Sonda } from "@/verificador/verificar";

describe("ipPublico", () => {
  it("recusa loopback, rede privada, CGNAT, link-local e metadados de nuvem", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.5.4", "192.168.0.1", "100.64.0.1", "169.254.169.254", "0.0.0.0", "224.0.0.1"]) {
      expect(ipPublico(ip), ip).toBe(false);
    }
    for (const ip of ["::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:192.168.1.1"]) {
      expect(ipPublico(ip), ip).toBe(false);
    }
  });
  it("aceita endereços da internet", () => {
    for (const ip of ["8.8.8.8", "200.160.2.3", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect(ipPublico(ip), ip).toBe(true);
    }
  });
  it("recusa o que não é IP", () => {
    expect(ipPublico("localhost")).toBe(false);
  });
});

describe("lookup seguro", () => {
  const resolverCom =
    (enderecos: { address: string; family: number }[]): FuncaoLookup =>
    (_host, _opcoes, callback) =>
      callback(null, enderecos);

  it("domínio que só aponta para dentro da rede é barrado", async () => {
    const lookup = criarLookupSeguro(resolverCom([{ address: "192.168.0.1", family: 4 }]));
    const erro = await new Promise((resolve) => lookup("roteador.exemplo", {}, (e) => resolve(e)));
    expect(erro).toBeInstanceOf(EnderecoInterno);
  });
  it("com endereços mistos, usa só o público", async () => {
    const lookup = criarLookupSeguro(resolverCom([{ address: "127.0.0.1", family: 4 }, { address: "8.8.8.8", family: 4 }]));
    const endereco = await new Promise((resolve) => lookup("misto.exemplo", {}, (_e, end) => resolve(end)));
    expect(endereco).toBe("8.8.8.8");
  });
});

describe("GET seguro contra um servidor de verdade", () => {
  let servidor: http.Server;
  let porta: number;
  /** Lookup de teste: manda qualquer nome para o servidor local, como um DNS de atacante faria. */
  const lookupParaLocal: FuncaoLookup = (_host, opcoes, callback) =>
    opcoes.all ? callback(null, [{ address: "127.0.0.1", family: 4 }]) : callback(null, "127.0.0.1", 4);
  const opcoes = { seguirRedirecionamento: true, userAgent: "teste", tempoLimiteMs: 2000 };

  beforeAll(async () => {
    servidor = http.createServer((req, res) => {
      if (req.url === "/fim") return res.writeHead(204).end();
      if (req.url === "/relativo") return res.writeHead(302, { Location: "/fim" }).end();
      if (req.url === "/para-dentro") return res.writeHead(302, { Location: `http://127.0.0.1:${porta}/fim` }).end();
      if (req.url === "/lento") return; // nunca responde
      res.writeHead(200).end("ok");
    });
    await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
    porta = (servidor.address() as AddressInfo).port;
  });
  afterAll(() => {
    servidor.closeAllConnections();
    servidor.close();
  });

  it("não acessa IP interno escrito na URL", async () => {
    await expect(getStatus(`http://127.0.0.1:${porta}/`, opcoes)).rejects.toBeInstanceOf(EnderecoInterno);
  });
  it("não acessa nome que o DNS resolve para dentro da máquina (localhost)", async () => {
    await expect(getStatus(`http://localhost:${porta}/`, opcoes)).rejects.toBeInstanceOf(EnderecoInterno);
  });
  it("segue redirecionamento relativo", async () => {
    expect(await getStatus(`http://site.exemplo:${porta}/relativo`, { ...opcoes, lookup: lookupParaLocal })).toBe(204);
  });
  it("não segue redirecionamento para dentro da rede", async () => {
    await expect(getStatus(`http://site.exemplo:${porta}/para-dentro`, { ...opcoes, lookup: lookupParaLocal })).rejects.toBeInstanceOf(
      EnderecoInterno,
    );
  });
  it("recusa protocolo que não é http(s)", async () => {
    await expect(getStatus("file:///etc/passwd", opcoes)).rejects.toThrow(/protocolo/);
  });
  it("tempo esgotado vira 'tempo_esgotado' para a sonda", async () => {
    const erro = await getStatus(`http://site.exemplo:${porta}/lento`, { ...opcoes, tempoLimiteMs: 200, lookup: lookupParaLocal }).catch((e) => e);
    expect(classificarErroHttp(erro)).toBe("tempo_esgotado");
  });
  it("endereço interno vira 'bloqueado' para a sonda", async () => {
    const erro = await getStatus(`http://localhost:${porta}/`, opcoes).catch((e) => e);
    expect(classificarErroHttp(erro)).toBe("bloqueado");
  });
  it("cadeia de certificado incompleta (erro do node:https) é reconhecida", () => {
    expect(classificarErroHttp(Object.assign(new Error("x"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" }))).toBe("cadeia_incompleta");
  });
});

describe("verificador diante de domínio bloqueado", () => {
  it("não conclui nada: nunca 'sem_https' nem 'falha'", async () => {
    const sonda: Sonda = { dns: async () => "tem_ip", http: async () => "bloqueado" };
    expect(await verificarAlvo({ host: "interno.com.br", origem: "email" }, sonda)).toBe("incerto");
  });
});

describe("painel só atende pelo nome local", () => {
  it("aceita localhost, 127.0.0.1 e [::1], com ou sem porta", () => {
    for (const host of ["localhost:3000", "localhost", "127.0.0.1:3000", "[::1]:3000", "LOCALHOST:3000"]) {
      expect(hostPermitido(host), host).toBe(true);
    }
  });
  it("recusa qualquer outro nome (DNS rebinding) e cabeçalho ausente", () => {
    for (const host of ["evil.com", "localhost.evil.com", "127.0.0.1.nip.io:3000", "192.168.0.10:3000", "", null]) {
      expect(hostPermitido(host), String(host)).toBe(false);
    }
  });
});
