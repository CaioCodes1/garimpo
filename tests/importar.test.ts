import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { Ramo } from "@/config";
import { abrirBanco, type Banco } from "@/db/banco";
import { dataReceita, importarDePasta, montarTelefone, MunicipioNaoEncontrado } from "@/importador/importar";
import {
  escreverZip,
  linhaEmpresa,
  linhaEstab,
  linhaSimples,
  MUNICIPIOS,
  pastaTemporaria,
} from "./fixtures/receita";

const RAMOS: Ramo[] = [
  { prefixo: "9602501", rotulo: "Salão de beleza", peso: 20 },
  { prefixo: "5611", rotulo: "Restaurante, lanchonete ou bar", peso: 20 },
];

async function montarPasta(estabs: string[], empresas: string[], simples: string[]): Promise<string> {
  const pasta = pastaTemporaria();
  await escreverZip(path.join(pasta, "Municipios.zip"), MUNICIPIOS);
  // Divide em duas partes para exercitar a leitura de várias partes.
  const meio = Math.ceil(estabs.length / 2);
  await escreverZip(path.join(pasta, "Estabelecimentos0.zip"), estabs.slice(0, meio));
  await escreverZip(path.join(pasta, "Estabelecimentos1.zip"), estabs.slice(meio));
  await escreverZip(path.join(pasta, "Empresas0.zip"), empresas);
  await escreverZip(path.join(pasta, "Simples.zip"), simples);
  return pasta;
}

function importar(db: Banco, pasta: string, mes = "2026-09") {
  return importarDePasta({ db, pasta, cidade: "São Bernardo do Campo", uf: "sp", mes, ramos: RAMOS });
}

const cnpjs = (db: Banco) =>
  (db.prepare("SELECT cnpj FROM empresas WHERE situacao = 'ativa' ORDER BY cnpj").all() as { cnpj: string }[]).map((r) => r.cnpj);

describe("importador (zips no formato da Receita)", () => {
  let pasta: string;

  beforeAll(async () => {
    pasta = await montarPasta(
      [
        // 11111111: salão MEI, aberto em março, e-mail com acento no nome fantasia (latin1).
        linhaEstab({ basico: "11111111", fantasia: "STUDIO BELLA CABELEIREIROS", cnae: "9602501", ddd1: "11", tel1: "987654321", email: "STUDIOBELLA@GMAIL.COM", bairro: "RUDGE RAMOS" }),
        // 22222222: restaurante ME.
        linhaEstab({ basico: "22222222", fantasia: "CANTINA DO JOÃO", cnae: "5611201", ddd1: "11", tel1: "43210000", email: "contato@cantinadojoao.com.br" }),
        // 33333333: ramo fora da lista (desenvolvimento de software).
        linhaEstab({ basico: "33333333", cnae: "6201501" }),
        // 44444444: empresa grande (porte 05).
        linhaEstab({ basico: "44444444", fantasia: "REDE GRANDE", cnae: "5611201" }),
        // 55555555: baixada (situação 08).
        linhaEstab({ basico: "55555555", cnae: "9602501", situacao: "08" }),
        // 66666666: outra cidade.
        linhaEstab({ basico: "66666666", cnae: "9602501", municipio: "7071" }),
        // 77777777: associação (natureza 3xxx).
        linhaEstab({ basico: "77777777", cnae: "9602501" }),
        // 88888888: mesmo código de município, mas outra UF não pode entrar.
        linhaEstab({ basico: "88888888", cnae: "9602501", uf: "MG" }),
        // Linha malformada (colunas a menos) é ignorada sem derrubar a importação.
        '"99999999";"0001";"7075"',
      ],
      [
        linhaEmpresa("11111111", "11.111.111 MARIA DA SILVA", "2135", "01"),
        linhaEmpresa("22222222", "CANTINA DO JOAO LTDA", "2062", "03"),
        linhaEmpresa("44444444", "REDE GRANDE SA", "2054", "05"),
        linhaEmpresa("77777777", "ASSOCIACAO DE BELEZA", "3999", "01"),
        linhaEmpresa("88888888", "OUTRA UF LTDA", "2062", "01"),
      ],
      [linhaSimples("11111111", true), linhaSimples("22222222", false)],
    );
  });

  it("grava só as pequenas empresas ativas, do município e do ramo", async () => {
    const db = abrirBanco(":memory:");
    const resumo = await importar(db, pasta);
    expect(cnpjs(db)).toEqual(["11111111000100", "22222222000100"]);
    expect(resumo.gravadas).toBe(2);
    expect(resumo.linhasIgnoradas).toBe(1);
    expect(resumo.municipioNome).toBe("SAO BERNARDO DO CAMPO");
  });

  it("lê latin1, junta empresa + simples e monta contato", async () => {
    const db = abrirBanco(":memory:");
    await importar(db, pasta);
    const salao = db.prepare("SELECT * FROM empresas WHERE cnpj = '11111111000100'").get() as Record<string, unknown>;
    expect(salao).toMatchObject({
      porte: "mei",
      telefone1: "11987654321",
      email: "studiobella@gmail.com",
      data_abertura: "2026-03-01",
      logradouro: "RUA MARECHAL DEODORO",
      bairro: "RUDGE RAMOS",
    });
    const cantina = db.prepare("SELECT porte, nome_fantasia FROM empresas WHERE cnpj = '22222222000100'").get();
    expect(cantina).toEqual({ porte: "epp", nome_fantasia: "CANTINA DO JOÃO" });
  });

  it("reimportação preserva o funil e marca como encerrada quem sumiu, sem apagar", async () => {
    const db = abrirBanco(":memory:");
    await importar(db, pasta);
    db.prepare("INSERT INTO funil (cnpj, status, atualizado_em) VALUES (?, 'nao_contatar', ?)").run("11111111000100", "x");
    db.prepare("INSERT INTO funil (cnpj, status, anotacoes, atualizado_em) VALUES (?, 'proposta', 'ligar sexta', ?)").run("22222222000100", "x");

    // No mês seguinte, a cantina fecha (situação 08).
    const proximoMes = await montarPasta(
      [
        linhaEstab({ basico: "11111111", fantasia: "STUDIO BELLA", cnae: "9602501" }),
        linhaEstab({ basico: "22222222", cnae: "5611201", situacao: "08" }),
      ],
      [linhaEmpresa("11111111", "11.111.111 MARIA DA SILVA", "2135", "01"), linhaEmpresa("22222222", "CANTINA DO JOAO LTDA", "2062", "03")],
      [linhaSimples("11111111", true)],
    );
    const resumo = await importar(db, proximoMes, "2026-10");

    expect(resumo.encerradas).toBe(1);
    expect(db.prepare("SELECT situacao FROM empresas WHERE cnpj = '22222222000100'").get()).toEqual({ situacao: "encerrada" });
    expect(db.prepare("SELECT nome_fantasia FROM empresas WHERE cnpj = '11111111000100'").get()).toEqual({ nome_fantasia: "STUDIO BELLA" });
    expect(db.prepare("SELECT cnpj, status, anotacoes FROM funil ORDER BY cnpj").all()).toEqual([
      { cnpj: "11111111000100", status: "nao_contatar", anotacoes: "" },
      { cnpj: "22222222000100", status: "proposta", anotacoes: "ligar sexta" },
    ]);
  });

  it("conta contatos repetidos no município inteiro, inclusive fora do ramo (contador)", async () => {
    const contador = "escritorio@contabil.com.br";
    const outros = Array.from({ length: 5 }, (_, i) =>
      linhaEstab({ basico: `5000000${i}`, cnae: "6201501", email: contador, ddd1: "11", tel1: "40040000" }),
    );
    const p = await montarPasta(
      [linhaEstab({ basico: "11111111", cnae: "9602501", email: contador, ddd1: "11", tel1: "40040000" }), ...outros],
      [linhaEmpresa("11111111", "SALAO X", "2135", "01")],
      [linhaSimples("11111111", true)],
    );
    const db = abrirBanco(":memory:");
    await importar(db, p);
    expect(db.prepare("SELECT email_repeticoes, telefone1_repeticoes FROM empresas").get()).toEqual({
      email_repeticoes: 6,
      telefone1_repeticoes: 6,
    });
  });

  it("explica quando não acha o município e sugere parecidos", async () => {
    const db = abrirBanco(":memory:");
    const erro = importarDePasta({ db, pasta, cidade: "Bernardo", uf: "SP", mes: "x", ramos: RAMOS });
    await expect(erro).rejects.toBeInstanceOf(MunicipioNaoEncontrado);
    await expect(erro).rejects.toThrow(/SAO BERNARDO DO CAMPO/);
  });
});

describe("conversões da Receita", () => {
  it("monta telefone com DDD, tirando zeros à esquerda", () => {
    expect(montarTelefone("011", "987654321")).toBe("11987654321");
    expect(montarTelefone("11", "")).toBe("");
  });

  it("converte datas e trata 00000000 como ausente", () => {
    expect(dataReceita("20260315")).toBe("2026-03-15");
    expect(dataReceita("00000000")).toBeNull();
    expect(dataReceita("")).toBeNull();
  });
});
