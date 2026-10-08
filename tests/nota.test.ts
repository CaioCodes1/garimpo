import { describe, expect, it } from "vitest";
import type { Ramo } from "@/config";
import { descricaoBreve, linhaTempoAberta, nomeExibicao } from "@/pontuador/descricao";
import { calcularNota, celularNormalizado, ehCelular, mesesDesde, textoTempoAberta, type EntradaNota } from "@/pontuador/nota";

const RAMOS: Ramo[] = [
  { prefixo: "9602501", rotulo: "Salão de beleza", peso: 20 },
  { prefixo: "4781", rotulo: "Loja de roupas", peso: 10 },
];
const ctx = {
  ramos: RAMOS,
  limiteContador: 5,
  provedores: new Set(["gmail.com", "hotmail.com", "outlook.com"]),
  hoje: new Date(2026, 9, 7), // 07/10/2026
};

const base: EntradaNota = {
  email: "",
  emailRepeticoes: 0,
  telefone1: "",
  telefone1Repeticoes: 0,
  telefone2: "",
  telefone2Repeticoes: 0,
  dataAbertura: "2015-01-01",
  cnae: "4781400",
  siteOsm: null,
  alvoVerificado: null,
  estadoVerificacao: null,
};
/** Empresa com e-mail de domínio próprio, verificado nesse mesmo domínio. */
const comDominio = { email: "a@loja.com.br", alvoVerificado: "loja.com.br" };

const pontos = (e: Partial<EntradaNota>, tipo: string) =>
  calcularNota({ ...base, ...e }, ctx).motivos.filter((m) => m.tipo === tipo).reduce((s, m) => s + m.pontos, 0);

describe("sinal de site (um só, nesta ordem: verificador → e-mail → desconhecido)", () => {
  it("e-mail de provedor gratuito vale 40", () => {
    expect(pontos({ email: "loja@gmail.com", emailRepeticoes: 1 }, "site")).toBe(40);
  });
  it("verificador sem_site vale 40", () => {
    expect(pontos({ ...comDominio, estadoVerificacao: "sem_site" }, "site")).toBe(40);
  });
  it("sem_https e fora_do_ar valem 30", () => {
    expect(pontos({ ...comDominio, estadoVerificacao: "sem_https" }, "site")).toBe(30);
    expect(pontos({ ...comDominio, estadoVerificacao: "fora_do_ar" }, "site")).toBe(30);
  });
  it("site do OSM funcionando vale 0, mesmo com e-mail @gmail (o verificador decide)", () => {
    expect(
      pontos({ email: "loja@gmail.com", emailRepeticoes: 1, siteOsm: "https://loja.com.br", alvoVerificado: "loja.com.br", estadoVerificacao: "ok" }, "site"),
    ).toBe(0);
  });
  it("verificação feita em outro domínio não vale (e-mail mudou ou virou provedor gratuito)", () => {
    expect(pontos({ email: "a@novo.com.br", alvoVerificado: "antigo.com.br", estadoVerificacao: "ok" }, "site")).toBe(15);
    expect(pontos({ email: "a@hootmail.com", emailRepeticoes: 1, alvoVerificado: "hootmail.com", estadoVerificacao: "sem_https" }, "site")).toBe(40);
  });
  it("provedor gratuito digitado errado conta como gratuito", () => {
    for (const email of ["a@hootmail.com", "a@outook.com", "a@homtmail.com", "a@gmail.com.br"]) {
      expect(pontos({ email, emailRepeticoes: 1 }, "site"), email).toBe(40);
    }
  });
  it("inconclusivo cai para a pista do e-mail", () => {
    expect(pontos({ email: "loja@gmail.com", emailRepeticoes: 1, estadoVerificacao: "inconclusivo" }, "site")).toBe(40);
  });
  it("sem e-mail, ou e-mail de contador, vale 15", () => {
    expect(pontos({}, "site")).toBe(15);
    expect(pontos({ email: "contador@gmail.com", emailRepeticoes: 5 }, "site")).toBe(15);
  });
});

describe("idade", () => {
  it("menos de 6 meses vale 30; até 1 ano 20; até 3 anos 10; mais, 0", () => {
    expect(pontos({ dataAbertura: "2026-06-01" }, "idade")).toBe(30);
    expect(pontos({ dataAbertura: "2026-01-01" }, "idade")).toBe(20);
    expect(pontos({ dataAbertura: "2024-01-01" }, "idade")).toBe(10);
    expect(pontos({ dataAbertura: "2015-01-01" }, "idade")).toBe(0);
  });
});

describe("ramo e contato", () => {
  it("usa o peso do ramo", () => {
    expect(pontos({ cnae: "9602501" }, "ramo")).toBe(20);
    expect(pontos({ cnae: "4781400" }, "ramo")).toBe(10);
  });
  it("celular próprio vale 10 e vira link de WhatsApp", () => {
    const r = calcularNota({ ...base, telefone1: "1143210000", telefone2: "11987654321" }, ctx);
    expect(r.celular).toBe("11987654321");
    expect(pontos({ telefone1: "11987654321" }, "contato")).toBe(10);
  });
  it("só fixo próprio vale 5", () => {
    expect(pontos({ telefone1: "1143210000" }, "contato")).toBe(5);
  });
  it("celular do contador não conta e gera aviso", () => {
    const r = calcularNota({ ...base, telefone1: "11987654321", telefone1Repeticoes: 9 }, ctx);
    expect(r.celular).toBeNull();
    expect(r.motivos.map((m) => m.texto)).toContain("parte do contato é provavelmente do contador");
  });
});

describe("nota total e modelo", () => {
  it("lead quente: salão novo, @gmail, celular = 100", () => {
    const r = calcularNota(
      { ...base, cnae: "9602501", dataAbertura: "2026-06-01", email: "bella@gmail.com", emailRepeticoes: 1, telefone1: "11987654321" },
      ctx,
    );
    expect(r.nota).toBe(100);
    expect(r.modelo).toBe("empresa-nova");
  });
  it("site com problema usa o modelo próprio", () => {
    expect(calcularNota({ ...base, ...comDominio, estadoVerificacao: "fora_do_ar" }, ctx).modelo).toBe("site-com-problema");
  });
  it("empresa antiga sem pista usa sem-site", () => {
    expect(calcularNota(base, ctx).modelo).toBe("sem-site");
  });
});

describe("tempo e descrição", () => {
  it("conta meses completos", () => {
    expect(mesesDesde("2026-06-07", ctx.hoje)).toBe(4);
    expect(mesesDesde("2026-06-08", ctx.hoje)).toBe(3);
    expect(mesesDesde("2026-10-01", ctx.hoje)).toBe(0);
  });
  it("escreve o tempo em português", () => {
    expect(textoTempoAberta(0)).toBe("há menos de um mês");
    expect(textoTempoAberta(1)).toBe("há 1 mês");
    expect(textoTempoAberta(4)).toBe("há 4 meses");
    expect(textoTempoAberta(14)).toBe("há 1 ano");
    expect(textoTempoAberta(40)).toBe("há 3 anos");
  });
  it("monta a linha de tempo com mês/ano", () => {
    expect(linhaTempoAberta("2026-06-01", ctx.hoje)).toBe("Aberta há 4 meses (jun/2026)");
    expect(linhaTempoAberta(null, ctx.hoje)).toBe("Data de abertura desconhecida");
  });
  it("monta a descrição breve", () => {
    expect(descricaoBreve("9602501", "mei", "RUDGE RAMOS", RAMOS)).toBe("Salão de beleza · MEI · Rudge Ramos");
    expect(descricaoBreve("4781400", "me", "", RAMOS)).toBe("Loja de roupas · microempresa");
  });
  it("usa a razão social limpa quando não há nome fantasia", () => {
    expect(nomeExibicao("STUDIO BELLA", "X")).toBe("Studio Bella");
    expect(nomeExibicao("", "11.111.111 MARIA DA SILVA")).toBe("Maria da Silva");
    expect(nomeExibicao("********", "PADARIA PAO BOM LTDA")).toBe("Padaria Pao Bom");
  });
  it("tira o sufixo jurídico do nome fantasia também, mesmo empilhado", () => {
    expect(nomeExibicao("NATALIA PAULETI HARMONIZACAO LTDA", "X")).toBe("Natalia Pauleti Harmonizacao");
    expect(nomeExibicao("CANTINA DO JOAO LTDA - ME", "X")).toBe("Cantina do Joao");
    expect(nomeExibicao("LTDA", "X")).toBe("Ltda");
  });
  it("mantém maiúscula depois de ponto", () => {
    expect(nomeExibicao("D.FERNANDES DA COSTA", "X")).toBe("D.Fernandes da Costa");
  });
  it("reconhece celular", () => {
    expect(ehCelular("11987654321")).toBe(true);
    expect(ehCelular("1143210000")).toBe(false);
    expect(ehCelular("")).toBe(false);
  });
  it("devolve o 9 que a Receita corta do celular (número guardado com 8 dígitos)", () => {
    expect(celularNormalizado("1166602592")).toBe("11966602592");
    expect(celularNormalizado("1198765432")).toBe("11998765432");
    expect(celularNormalizado("11987654321")).toBe("11987654321");
    expect(celularNormalizado("1152916729")).toBeNull();
    expect(celularNormalizado("1121234567")).toBeNull();
  });
  it("celular de 8 dígitos da Receita vira WhatsApp com o 9", () => {
    expect(calcularNota({ ...base, telefone1: "1166602592" }, ctx).celular).toBe("11966602592");
  });
});
