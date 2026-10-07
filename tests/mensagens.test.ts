import path from "node:path";
import { describe, expect, it } from "vitest";
import { lerModelos, type NomeModelo } from "@/config";
import { gerarMensagem, LINHA_DE_SAIDA, linkPesquisaGoogle, linkWhatsApp, type DadosMensagem } from "@/mensagens/mensagens";

process.env.GARIMPO_RAIZ = path.resolve(__dirname, "..");
const modelos = lerModelos();
const perfil = { nome: "Caio", profissao: "desenvolvedor de sites", cidade: "São Bernardo do Campo", portfolio: "https://exemplo.com" };
const dados: DadosMensagem = {
  nome: "Studio Bella",
  ramoRotulo: "Salão de beleza",
  bairro: "RUDGE RAMOS",
  municipio: "SAO BERNARDO DO CAMPO",
  tempoAberta: "há 4 meses",
  site: "studiobella.com.br",
  estadoVerificacao: "fora_do_ar",
};
const nomes: NomeModelo[] = ["empresa-nova", "sem-site", "site-com-problema"];

describe.each(nomes)("modelo %s", (modelo) => {
  const texto = gerarMensagem(modelos, modelo, dados, perfil);
  const linhas = texto.split("\n");

  it("tem no máximo 5 linhas", () => expect(linhas.length).toBeLessThanOrEqual(5));
  it("termina com a linha de saída", () => expect(linhas.at(-1)).toBe(LINHA_DE_SAIDA));
  it("a penúltima linha termina em pergunta (e não em preço)", () => {
    expect(linhas.at(-2)).toMatch(/\?$/);
    expect(texto).not.toMatch(/R\$/);
  });
  it("não sobra variável sem preencher", () => expect(texto).not.toMatch(/\{\w+\}/));
  it("cita a empresa e o portfólio", () => {
    expect(texto).toContain("Studio Bella");
    expect(texto).toContain("https://exemplo.com");
  });
});

describe("conteúdo específico", () => {
  it("empresa nova cita bairro e tempo", () => {
    expect(gerarMensagem(modelos, "empresa-nova", dados, perfil)).toContain("abriu há 4 meses no bairro Rudge Ramos");
  });
  it("sem bairro, cita a cidade", () => {
    expect(gerarMensagem(modelos, "empresa-nova", { ...dados, bairro: "" }, perfil)).toContain("em Sao Bernardo do Campo");
  });
  it("site com problema diz qual problema, e só o confirmado", () => {
    expect(gerarMensagem(modelos, "site-com-problema", dados, perfil)).toContain("(studiobella.com.br) e ele não abriu");
    expect(gerarMensagem(modelos, "site-com-problema", { ...dados, estadoVerificacao: "sem_https" }, perfil)).toContain(
      '"não seguro"',
    );
  });
});

describe("links", () => {
  it("WhatsApp leva o DDI 55 e o texto codificado", () => {
    expect(linkWhatsApp("11987654321", "Oi, tudo bem?")).toBe("https://wa.me/5511987654321?text=Oi%2C%20tudo%20bem%3F");
  });
  it("pesquisa no Google com nome e cidade", () => {
    expect(linkPesquisaGoogle("Studio Bella", "SAO BERNARDO DO CAMPO")).toBe(
      "https://www.google.com/search?q=Studio%20Bella%20Sao%20Bernardo%20do%20Campo",
    );
  });
});
