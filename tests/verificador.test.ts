import { describe, expect, it } from "vitest";
import { abrirBanco } from "@/db/banco";
import {
  alvoDaEmpresa,
  proximoEstado,
  verificarAlvo,
  verificarPendentes,
  type RespostaDns,
  type Sonda,
} from "@/verificador/verificar";

function sonda(dns: Record<string, RespostaDns>, http: Record<string, number | null>): Sonda {
  return {
    dns: async (host) => dns[host] ?? "sem_ip",
    http: async (url) => (url in http ? http[url]! : null),
  };
}

const provedores = new Set(["gmail.com"]);

describe("alvo", () => {
  it("prefere o site do OSM", () => {
    expect(alvoDaEmpresa("https://www.loja.com.br/contato", "a@b.com", true, provedores)).toEqual({ host: "www.loja.com.br", origem: "osm" });
    expect(alvoDaEmpresa("loja.com.br", "", true, provedores)).toEqual({ host: "loja.com.br", origem: "osm" });
  });
  it("usa o domínio do e-mail próprio, nunca de provedor gratuito ou de contador", () => {
    expect(alvoDaEmpresa(null, "contato@loja.com.br", true, provedores)).toEqual({ host: "loja.com.br", origem: "email" });
    expect(alvoDaEmpresa(null, "loja@gmail.com", true, provedores)).toBeNull();
    expect(alvoDaEmpresa(null, "contato@contabil.com.br", false, provedores)).toBeNull();
    expect(alvoDaEmpresa(null, "", true, provedores)).toBeNull();
  });
});

describe("uma verificação", () => {
  const email = { host: "loja.com.br", origem: "email" as const };

  it("HTTPS respondendo = ok (inclusive 403 de proteção anti-robô)", async () => {
    expect(await verificarAlvo(email, sonda({ "loja.com.br": "tem_ip" }, { "https://loja.com.br/": 200 }))).toBe("ok");
    expect(await verificarAlvo(email, sonda({ "loja.com.br": "tem_ip" }, { "https://loja.com.br/": 403 }))).toBe("ok");
  });
  it("tenta o www quando o domínio puro não tem endereço", async () => {
    expect(await verificarAlvo(email, sonda({ "www.loja.com.br": "tem_ip" }, { "https://www.loja.com.br/": 200 }))).toBe("ok");
  });
  it("só HTTP responde = sem_https", async () => {
    expect(await verificarAlvo(email, sonda({ "loja.com.br": "tem_ip" }, { "http://loja.com.br/": 200 }))).toBe("sem_https");
  });
  it("domínio de e-mail sem endereço web = sem_site", async () => {
    expect(await verificarAlvo(email, sonda({}, {}))).toBe("sem_site");
  });
  it("site do OSM sem endereço = falha (não 'sem site')", async () => {
    expect(await verificarAlvo({ host: "loja.com.br", origem: "osm" }, sonda({}, {}))).toBe("falha");
  });
  it("erro de DNS não conclui nada", async () => {
    expect(await verificarAlvo(email, sonda({ "loja.com.br": "erro" }, {}))).toBe("erro_dns");
  });
  it("servidor com erro 5xx = falha", async () => {
    expect(
      await verificarAlvo(email, sonda({ "loja.com.br": "tem_ip" }, { "https://loja.com.br/": 503, "http://loja.com.br/": 503 })),
    ).toBe("falha");
  });
});

describe("fora do ar só com duas falhas separadas por 1 hora", () => {
  const t0 = new Date("2026-10-07T10:00:00Z");
  const depois = (min: number) => new Date(t0.getTime() + min * 60_000);

  it("primeira falha é inconclusiva", () => {
    expect(proximoEstado("falha", null, t0)).toEqual({ estado: "inconclusivo", falhas: 1, primeiraFalhaEm: t0.toISOString() });
  });
  it("segunda falha em menos de 1 hora ainda é inconclusiva", () => {
    const anterior = { falhas: 1, primeiraFalhaEm: t0.toISOString() };
    expect(proximoEstado("falha", anterior, depois(30)).estado).toBe("inconclusivo");
  });
  it("segunda falha depois de 1 hora confirma fora_do_ar", () => {
    const anterior = { falhas: 1, primeiraFalhaEm: t0.toISOString() };
    expect(proximoEstado("falha", anterior, depois(61)).estado).toBe("fora_do_ar");
  });
  it("sucesso zera o histórico", () => {
    expect(proximoEstado("ok", { falhas: 3, primeiraFalhaEm: t0.toISOString() }, depois(5))).toEqual({
      estado: "ok",
      falhas: 0,
      primeiraFalhaEm: null,
    });
  });
  it("erro de DNS não conta como falha", () => {
    expect(proximoEstado("erro_dns", { falhas: 1, primeiraFalhaEm: "x" }, t0)).toEqual({ estado: "inconclusivo", falhas: 1, primeiraFalhaEm: "x" });
  });
});

describe("verificarPendentes (com banco)", () => {
  it("grava, e só confirma fora_do_ar na segunda passada uma hora depois", async () => {
    const db = abrirBanco(":memory:");
    db.prepare("INSERT INTO importacoes (municipio_codigo, municipio_nome, uf, mes_referencia, iniciada_em) VALUES ('1','X','SP','m','t')").run();
    const inserir = db.prepare(
      `INSERT INTO empresas (cnpj, cnpj_basico, matriz, razao_social, nome_fantasia, natureza, porte, cnae, logradouro, numero,
        complemento, bairro, cep, uf, municipio_codigo, municipio_nome, telefone1, telefone2, email, situacao, importacao_id, atualizado_em)
       VALUES (?, '1', 1, 'R', '', '2062', 'me', '9602501', '', '', '', '', '', 'SP', '1', 'X', '', '', ?, 'ativa', 1, 't')`,
    );
    inserir.run("1", "a@caiu.com.br");
    inserir.run("2", "b@gmail.com");
    const s = sonda({ "caiu.com.br": "tem_ip" }, {});
    let agora = new Date("2026-10-07T10:00:00Z");
    const opcoes = { provedores, limiteContador: 5, sonda: s, agora: () => agora };

    expect((await verificarPendentes(db, opcoes)).inconclusivo).toBe(1);
    agora = new Date("2026-10-07T11:30:00Z");
    expect((await verificarPendentes(db, opcoes)).fora_do_ar).toBe(1);
    expect(db.prepare("SELECT cnpj, estado, falhas FROM verificacoes").all()).toEqual([{ cnpj: "1", estado: "fora_do_ar", falhas: 2 }]);
  });

  it("testa cada domínio uma vez só, mesmo com várias empresas usando o mesmo", async () => {
    const db = abrirBanco(":memory:");
    db.prepare("INSERT INTO importacoes (municipio_codigo, municipio_nome, uf, mes_referencia, iniciada_em) VALUES ('1','X','SP','m','t')").run();
    const inserir = db.prepare(
      `INSERT INTO empresas (cnpj, cnpj_basico, matriz, razao_social, nome_fantasia, natureza, porte, cnae, logradouro, numero,
        complemento, bairro, cep, uf, municipio_codigo, municipio_nome, telefone1, telefone2, email, situacao, importacao_id, atualizado_em)
       VALUES (?, '1', 1, 'R', '', '2062', 'me', '9602501', '', '', '', '', '', 'SP', '1', 'X', '', '', ?, 'ativa', 1, 't')`,
    );
    for (const cnpj of ["1", "2", "3"]) inserir.run(cnpj, `loja${cnpj}@rede.com.br`);
    let consultasDns = 0;
    const s: Sonda = {
      dns: async (host) => {
        consultasDns++;
        return host === "rede.com.br" ? "tem_ip" : "sem_ip";
      },
      http: async () => 200,
    };
    expect((await verificarPendentes(db, { provedores, limiteContador: 5, sonda: s })).ok).toBe(3);
    expect(consultasDns).toBe(2); // rede.com.br e www.rede.com.br, uma vez cada
  });
});
