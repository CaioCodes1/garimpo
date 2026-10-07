import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cruzar, type ElementoOsm } from "@/enriquecedor/osm";
import { baixarArquivo } from "@/importador/baixar";
import { arquivosNecessarios, FonteIndisponivel, listarArquivos, listarMeses } from "@/importador/fonte";
import { normalizarLogradouro, normalizarNomeEmpresa, tituloCaso } from "@/lib/texto";
import { pastaTemporaria } from "./fixtures/receita";

const BASE = "https://receita.exemplo/dav";

function resposta(href: string, tamanho?: number): string {
  return `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${
    tamanho !== undefined ? `<d:getcontentlength>${tamanho}</d:getcontentlength>` : ""
  }</d:prop></d:propstat></d:response>`;
}

function fetchFalso(xml: string, status = 207): typeof fetch {
  return (async () => new Response(`<d:multistatus>${xml}</d:multistatus>`, { status })) as typeof fetch;
}

describe("listagem WebDAV da Receita", () => {
  it("lista os meses em ordem", async () => {
    const xml = resposta("/dav/") + resposta("/dav/2026-09/") + resposta("/dav/2025-12/") + resposta("/dav/cnpj.tar.gz", 9);
    expect(await listarMeses(BASE, fetchFalso(xml))).toEqual(["2025-12", "2026-09"]);
  });
  it("lista arquivos com tamanho e filtra os necessários (sem sócios)", async () => {
    const xml = resposta("/dav/2026-09/") + resposta("/dav/2026-09/Empresas0.zip", 10) + resposta("/dav/2026-09/Socios0.zip", 5) +
      resposta("/dav/2026-09/Municipios.zip", 1) + resposta("/dav/2026-09/Estabelecimentos3.zip", 20);
    const todos = await listarArquivos(BASE, "2026-09", fetchFalso(xml));
    expect(arquivosNecessarios(todos).map((a) => a.nome)).toEqual(["Empresas0.zip", "Municipios.zip", "Estabelecimentos3.zip"]);
  });
  it("erro explica onde mudar o endereço", async () => {
    await expect(listarMeses(BASE, fetchFalso("", 404))).rejects.toBeInstanceOf(FonteIndisponivel);
    await expect(listarMeses(BASE, fetchFalso("", 404))).rejects.toThrow(/config\/fontes\.json/);
  });
});

describe("download retomável", () => {
  const conteudo = Buffer.from("0123456789abcdefghij");
  const servidor = (pedidos: (string | null)[]): typeof fetch =>
    (async (_url: string, init?: RequestInit) => {
      const range = (init?.headers as Record<string, string> | undefined)?.Range ?? null;
      pedidos.push(range);
      if (range) {
        const inicio = Number(/bytes=(\d+)-/.exec(range)![1]);
        return new Response(conteudo.subarray(inicio), { status: 206 });
      }
      return new Response(conteudo, { status: 200 });
    }) as typeof fetch;

  it("continua de onde parou", async () => {
    const destino = path.join(pastaTemporaria(), "Empresas0.zip");
    writeFileSync(destino, conteudo.subarray(0, 8));
    const pedidos: (string | null)[] = [];
    expect(await baixarArquivo("u", destino, conteudo.length, servidor(pedidos))).toBe("baixado");
    expect(pedidos).toEqual(["bytes=8-"]);
    expect(readFileSync(destino)).toEqual(conteudo);
  });
  it("não baixa de novo o que está completo", async () => {
    const destino = path.join(pastaTemporaria(), "x.zip");
    writeFileSync(destino, conteudo);
    const pedidos: (string | null)[] = [];
    expect(await baixarArquivo("u", destino, conteudo.length, servidor(pedidos))).toBe("ja_existia");
    expect(pedidos).toEqual([]);
  });
  it("arquivo maior que o do servidor recomeça do zero", async () => {
    const destino = path.join(pastaTemporaria(), "y.zip");
    writeFileSync(destino, Buffer.concat([conteudo, conteudo]));
    const pedidos: (string | null)[] = [];
    await baixarArquivo("u", destino, conteudo.length, servidor(pedidos));
    expect(pedidos).toEqual([null]);
    expect(statSync(destino).size).toBe(conteudo.length);
  });
});

describe("cruzamento com o OpenStreetMap", () => {
  const el = (nome: string, rua: string, site: string | null = null): ElementoOsm => ({ nome, rua, site, lat: -23.7, lon: -46.5 });
  const emp = (cnpj: string, fantasia: string, logradouro: string, razao = "X") => ({ cnpj, nome_fantasia: fantasia, razao_social: razao, logradouro });

  it("cruza por nome E rua, ignorando acento, caixa, sufixo jurídico e tipo de logradouro", () => {
    const r = cruzar([emp("1", "PADARIA DOCE PÃO", "AVENIDA KENNEDY")], [el("Padaria Doce Pão Ltda", "Av. Kennedy", "https://docepao.com.br")]);
    expect(r.get("1")?.site).toBe("https://docepao.com.br");
  });
  it("mesmo nome em outra rua não cruza", () => {
    expect(cruzar([emp("1", "PADARIA DOCE PAO", "RUA A")], [el("Padaria Doce Pão", "Rua B")]).size).toBe(0);
  });
  it("dois lugares iguais na mesma rua não cruzam (ambíguo)", () => {
    expect(cruzar([emp("1", "BAR", "RUA A")], [el("Bar", "Rua A"), el("Bar", "Rua A")]).size).toBe(0);
  });
  it("usa a razão social quando não há nome fantasia", () => {
    expect(cruzar([emp("1", "", "RUA A", "CANTINA DO JOAO LTDA")], [el("Cantina do João", "Rua A")]).size).toBe(1);
  });
});

describe("normalização de texto", () => {
  it("nome de empresa", () => expect(normalizarNomeEmpresa("Padaria Doce-Pão LTDA - ME")).toBe("padaria doce pao"));
  it("logradouro", () => {
    expect(normalizarLogradouro("AV. SENADOR VERGUEIRO")).toBe("senador vergueiro");
    expect(normalizarLogradouro("Rua")).toBe("rua");
  });
  it("título", () => expect(tituloCaso("CANTINA DO JOAO E FILHOS")).toBe("Cantina do Joao e Filhos"));
});
