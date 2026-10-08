import { describe, expect, it } from "vitest";
import { bairros, contagemFunil, listarLeads, mudarStatus } from "@/consultas/painel";
import { abrirBanco } from "@/db/banco";
import { bairroExibicao, normalizarBairro } from "@/lib/texto";

function bancoCom(empresas: { cnpj: string; bairro: string; nota: number; abertura?: string }[]) {
  const db = abrirBanco(":memory:");
  db.prepare("INSERT INTO importacoes (municipio_codigo, municipio_nome, uf, mes_referencia, iniciada_em) VALUES ('1','X','SP','m','t')").run();
  const emp = db.prepare(
    `INSERT INTO empresas (cnpj, cnpj_basico, matriz, razao_social, nome_fantasia, natureza, porte, cnae, data_abertura, logradouro, numero,
      complemento, bairro, cep, uf, municipio_codigo, municipio_nome, telefone1, telefone2, email, situacao, importacao_id, atualizado_em)
     VALUES (?, '1', 1, 'R', 'LOJA', '2062', 'me', '9602501', ?, '', '', '', ?, '', 'SP', '1', 'X', '', '', '', 'ativa', 1, 't')`,
  );
  const nota = db.prepare("INSERT INTO pontuacoes (cnpj, nota, motivos, modelo, calculado_em) VALUES (?, ?, '[]', 'sem-site', 't')");
  for (const e of empresas) {
    emp.run(e.cnpj, e.abertura ?? "2020-01-01", e.bairro);
    nota.run(e.cnpj, e.nota);
  }
  return db;
}

describe("bairros", () => {
  it("normaliza as abreviações do cadastro", () => {
    expect(normalizarBairro("Jd. do Mar")).toBe("jardim do mar");
    expect(normalizarBairro("JD DO MAR")).toBe("jardim do mar");
    expect(normalizarBairro("BAIRRO JARDIM DO MAR")).toBe("jardim do mar");
    expect(normalizarBairro("Pque.res.tiradentes")).toBe("parque residencial tiradentes");
    expect(bairroExibicao("VL EUCLIDES")).toBe("Vila Euclides");
  });

  it("agrupa as grafias no filtro e encontra todas elas", () => {
    const db = bancoCom([
      { cnpj: "1", bairro: "JD DO MAR", nota: 90 },
      { cnpj: "2", bairro: "JARDIM DO MAR", nota: 80 },
      { cnpj: "3", bairro: "JD. DO MAR", nota: 70 },
      { cnpj: "4", bairro: "CENTRO", nota: 60 },
    ]);
    expect(bairros(db)).toEqual([{ chave: "jardim do mar", rotulo: "Jardim do Mar", n: 3 }]);
    expect(listarLeads(db, { bairro: "jardim do mar" }, 1, 10).leads.map((l) => l.cnpj)).toEqual(["1", "2", "3"]);
  });
});

describe("listagem e funil", () => {
  it("ordena por nota e filtra nota mínima e faixa de idade", () => {
    const db = bancoCom([
      { cnpj: "1", bairro: "A", nota: 50, abertura: "2026-09-01" },
      { cnpj: "2", bairro: "A", nota: 95, abertura: "2019-01-01" },
      { cnpj: "3", bairro: "A", nota: 80, abertura: "2024-08-01" },
      { cnpj: "4", bairro: "A", nota: 70, abertura: "2023-10-07" },
    ]);
    const hoje = new Date(2026, 9, 7);
    expect(listarLeads(db, {}, 1, 10, hoje).leads.map((l) => l.cnpj)).toEqual(["2", "3", "4", "1"]);
    expect(listarLeads(db, { notaMin: 70 }, 1, 10, hoje).total).toBe(3);
    expect(listarLeads(db, { idade: "ate1" }, 1, 10, hoje).leads.map((l) => l.cnpj)).toEqual(["1"]);
    expect(listarLeads(db, { idade: "1a3" }, 1, 10, hoje).leads.map((l) => l.cnpj)).toEqual(["3"]);
    // Aberta há exatamente 3 anos já é da faixa seguinte.
    expect(listarLeads(db, { idade: "3a5" }, 1, 10, hoje).leads.map((l) => l.cnpj)).toEqual(["4"]);
    expect(listarLeads(db, { idade: "mais5" }, 1, 10, hoje).leads.map((l) => l.cnpj)).toEqual(["2"]);
  });

  it("'não contatar' some da listagem padrão e só aparece filtrando por ele", () => {
    const db = bancoCom([
      { cnpj: "1", bairro: "A", nota: 90 },
      { cnpj: "2", bairro: "A", nota: 80 },
    ]);
    mudarStatus(db, "1", "nao_contatar");
    expect(listarLeads(db, {}, 1, 10).leads.map((l) => l.cnpj)).toEqual(["2"]);
    expect(listarLeads(db, { status: "nao_contatar" }, 1, 10).leads.map((l) => l.cnpj)).toEqual(["1"]);
    expect(contagemFunil(db)).toMatchObject({ novo: 1, nao_contatar: 1 });
  });

  it("'mensagem enviada' grava a data do primeiro contato e não a sobrescreve depois", () => {
    const db = bancoCom([{ cnpj: "1", bairro: "A", nota: 90 }]);
    mudarStatus(db, "1", "mensagem_enviada", new Date("2026-10-07T10:00:00Z"));
    mudarStatus(db, "1", "respondeu", new Date("2026-10-08T10:00:00Z"));
    mudarStatus(db, "1", "mensagem_enviada", new Date("2026-10-09T10:00:00Z"));
    expect(db.prepare("SELECT status, contatado_em FROM funil").get()).toEqual({
      status: "mensagem_enviada",
      contatado_em: "2026-10-07T10:00:00.000Z",
    });
  });
});
