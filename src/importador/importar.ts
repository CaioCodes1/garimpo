import { readdirSync } from "node:fs";
import path from "node:path";
import type { Ramo } from "../config";
import { agoraIso, emTransacao, type Banco } from "../db/banco";
import { normalizar } from "../lib/texto";
import { COL_EMPRESA, COL_ESTAB, COL_SIMPLES, linhas, separarCampos } from "./csv-receita";
import { ativoNoMunicipio, porteElegivel, ramoAceito } from "./elegibilidade";
import { abrirPrimeiraEntrada } from "./zip";

export interface OpcoesImportacao {
  db: Banco;
  /** Pasta com os zips do mês. */
  pasta: string;
  cidade: string;
  uf: string;
  mes: string;
  ramos: Ramo[];
  log?: (msg: string) => void;
}

export interface ResumoImportacao {
  importacaoId: number;
  municipioCodigo: string;
  municipioNome: string;
  ativosNoMunicipio: number;
  noRamo: number;
  gravadas: number;
  encerradas: number;
  linhasIgnoradas: number;
}

export class MunicipioNaoEncontrado extends Error {
  constructor(cidade: string, sugestoes: string[]) {
    super(
      `Não achei o município "${cidade}" na tabela da Receita.` +
        (sugestoes.length ? ` Parecidos: ${sugestoes.slice(0, 8).join(", ")}.` : ""),
    );
    this.name = "MunicipioNaoEncontrado";
  }
}

interface Estabelecimento {
  cnpj: string;
  cnpjBasico: string;
  matriz: boolean;
  nomeFantasia: string;
  cnae: string;
  dataAbertura: string | null;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cep: string;
  uf: string;
  municipio: string;
  telefone1: string;
  telefone2: string;
  email: string;
}

interface DadosEmpresa {
  razaoSocial: string;
  natureza: string;
  porte: string;
}

function zipsDe(pasta: string, prefixo: string): string[] {
  return readdirSync(pasta)
    .filter((nome) => new RegExp(`^${prefixo}\\d*\\.zip$`, "i").test(nome))
    .sort()
    .map((nome) => path.join(pasta, nome));
}

/** DDD + número, só dígitos. O DDD às vezes vem com zeros à esquerda. */
export function montarTelefone(ddd: string, numero: string): string {
  const n = numero.replace(/\D/g, "");
  if (!n) return "";
  return ddd.replace(/\D/g, "").replace(/^0+/, "") + n;
}

/** "20260315" → "2026-03-15"; "00000000" ou vazio → null. */
export function dataReceita(valor: string): string | null {
  if (!/^\d{8}$/.test(valor) || valor === "00000000") return null;
  return `${valor.slice(0, 4)}-${valor.slice(4, 6)}-${valor.slice(6, 8)}`;
}

async function resolverMunicipio(pasta: string, cidade: string): Promise<Map<string, string>> {
  const [zip] = zipsDe(pasta, "Municipios");
  if (!zip) throw new Error(`Municipios.zip não está em ${pasta}`);
  const alvo = normalizar(cidade);
  const achados = new Map<string, string>();
  const parecidos: string[] = [];
  for await (const linha of linhas(await abrirPrimeiraEntrada(zip))) {
    const [codigo, nome] = separarCampos(linha);
    if (!codigo || !nome) continue;
    const n = normalizar(nome);
    if (n === alvo) achados.set(codigo, nome);
    else if (n.includes(alvo) || alvo.includes(n)) parecidos.push(nome);
  }
  if (achados.size === 0) throw new MunicipioNaoEncontrado(cidade, parecidos);
  // Pode haver homônimos em estados diferentes; a UF desempata na leitura dos estabelecimentos.
  return achados;
}

export async function importarDePasta(opcoes: OpcoesImportacao): Promise<ResumoImportacao> {
  const { db, pasta, uf, mes, ramos } = opcoes;
  const log = opcoes.log ?? (() => {});
  const ufAlvo = uf.toUpperCase();

  const municipios = await resolverMunicipio(pasta, opcoes.cidade);
  const codigos = new Set(municipios.keys());
  const municipioNome = [...municipios.values()][0]!;
  // Pré-filtro barato: só separa colunas das linhas que contêm o código entre aspas.
  const marcas = [...codigos].map((c) => `"${c}"`);
  log(`Município: ${municipioNome}/${ufAlvo} (código Receita ${[...codigos].join(", ")})`);

  const inicio = agoraIso();
  const importacaoId = Number(
    db
      .prepare(
        `INSERT INTO importacoes (municipio_codigo, municipio_nome, uf, mes_referencia, iniciada_em)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run([...codigos].join(","), municipioNome, ufAlvo, mes, inicio).lastInsertRowid,
  );

  // 1. Estabelecimentos: regras 1, 2 e 5; e a contagem de contatos repetidos (contador).
  const estabelecimentos = new Map<string, Estabelecimento>();
  const repeticoes = new Map<string, number>();
  const contar = (chave: string, valor: string) => {
    if (valor) repeticoes.set(chave + valor, (repeticoes.get(chave + valor) ?? 0) + 1);
  };
  let ativosNoMunicipio = 0;
  let linhasIgnoradas = 0;

  for (const zip of zipsDe(pasta, "Estabelecimentos")) {
    const antes = ativosNoMunicipio;
    for await (const linha of linhas(await abrirPrimeiraEntrada(zip))) {
      if (!marcas.some((m) => linha.includes(m))) continue;
      const c = separarCampos(linha);
      if (c.length !== COL_ESTAB.total) {
        linhasIgnoradas++;
        continue;
      }
      const at = (i: number) => (c[i] ?? "").trim();
      if (!ativoNoMunicipio(at(COL_ESTAB.municipio), at(COL_ESTAB.uf), at(COL_ESTAB.situacao), codigos, ufAlvo)) continue;
      ativosNoMunicipio++;

      const email = at(COL_ESTAB.email).toLowerCase();
      const telefone1 = montarTelefone(at(COL_ESTAB.ddd1), at(COL_ESTAB.telefone1));
      const telefone2 = montarTelefone(at(COL_ESTAB.ddd2), at(COL_ESTAB.telefone2));
      contar("e:", email);
      contar("t:", telefone1);
      if (telefone2 !== telefone1) contar("t:", telefone2);

      const cnae = at(COL_ESTAB.cnaePrincipal);
      if (!ramoAceito(cnae, ramos)) continue;

      const tipo = at(COL_ESTAB.tipoLogradouro);
      const logradouro = at(COL_ESTAB.logradouro);
      estabelecimentos.set(at(COL_ESTAB.cnpjBasico) + at(COL_ESTAB.cnpjOrdem) + at(COL_ESTAB.cnpjDv), {
        cnpj: at(COL_ESTAB.cnpjBasico) + at(COL_ESTAB.cnpjOrdem) + at(COL_ESTAB.cnpjDv),
        cnpjBasico: at(COL_ESTAB.cnpjBasico),
        matriz: at(COL_ESTAB.matrizFilial) === "1",
        nomeFantasia: at(COL_ESTAB.nomeFantasia),
        cnae,
        dataAbertura: dataReceita(at(COL_ESTAB.dataInicio)),
        logradouro: tipo && !logradouro.startsWith(tipo) ? `${tipo} ${logradouro}` : logradouro,
        numero: at(COL_ESTAB.numero),
        complemento: at(COL_ESTAB.complemento),
        bairro: at(COL_ESTAB.bairro),
        cep: at(COL_ESTAB.cep),
        uf: at(COL_ESTAB.uf),
        municipio: at(COL_ESTAB.municipio),
        telefone1,
        telefone2,
        email,
      });
    }
    log(`${path.basename(zip)}: +${ativosNoMunicipio - antes} ativos no município (${estabelecimentos.size} no ramo até agora)`);
  }

  // 2. Empresas e Simples: só os CNPJs básicos que passaram; regras 3 e 4.
  const basicos = new Set([...estabelecimentos.values()].map((e) => e.cnpjBasico));
  const empresas = new Map<string, DadosEmpresa>();
  for (const zip of zipsDe(pasta, "Empresas")) {
    for await (const linha of linhas(await abrirPrimeiraEntrada(zip))) {
      if (!basicos.has(linha.slice(1, 9))) continue;
      const c = separarCampos(linha);
      if (c.length !== COL_EMPRESA.total) {
        linhasIgnoradas++;
        continue;
      }
      empresas.set(c[COL_EMPRESA.cnpjBasico]!, {
        razaoSocial: c[COL_EMPRESA.razaoSocial]!.trim(),
        natureza: c[COL_EMPRESA.natureza]!.trim(),
        porte: c[COL_EMPRESA.porte]!.trim(),
      });
    }
    log(`${path.basename(zip)}: ${empresas.size} empresas cruzadas até agora`);
  }

  const meis = new Set<string>();
  for (const zip of zipsDe(pasta, "Simples")) {
    for await (const linha of linhas(await abrirPrimeiraEntrada(zip))) {
      if (!basicos.has(linha.slice(1, 9))) continue;
      const c = separarCampos(linha);
      if (c.length === COL_SIMPLES.total && c[COL_SIMPLES.opcaoMei] === "S") meis.add(c[COL_SIMPLES.cnpjBasico]!);
    }
    log(`${path.basename(zip)}: ${meis.size} MEIs entre os candidatos`);
  }

  // 3. Grava. Nunca toca em lat/lon/site_osm (do enriquecedor) nem no funil (do usuário).
  const upsert = db.prepare(`
    INSERT INTO empresas (
      cnpj, cnpj_basico, matriz, razao_social, nome_fantasia, natureza, porte, cnae, data_abertura,
      logradouro, numero, complemento, bairro, cep, uf, municipio_codigo, municipio_nome,
      telefone1, telefone2, email, email_repeticoes, telefone1_repeticoes, telefone2_repeticoes,
      situacao, importacao_id, atualizado_em
    ) VALUES (
      @cnpj, @cnpj_basico, @matriz, @razao_social, @nome_fantasia, @natureza, @porte, @cnae, @data_abertura,
      @logradouro, @numero, @complemento, @bairro, @cep, @uf, @municipio_codigo, @municipio_nome,
      @telefone1, @telefone2, @email, @email_repeticoes, @telefone1_repeticoes, @telefone2_repeticoes,
      'ativa', @importacao_id, @atualizado_em
    )
    ON CONFLICT (cnpj) DO UPDATE SET
      cnpj_basico = excluded.cnpj_basico, matriz = excluded.matriz, razao_social = excluded.razao_social,
      nome_fantasia = excluded.nome_fantasia, natureza = excluded.natureza, porte = excluded.porte,
      cnae = excluded.cnae, data_abertura = excluded.data_abertura, logradouro = excluded.logradouro,
      numero = excluded.numero, complemento = excluded.complemento, bairro = excluded.bairro,
      cep = excluded.cep, uf = excluded.uf, municipio_codigo = excluded.municipio_codigo,
      municipio_nome = excluded.municipio_nome, telefone1 = excluded.telefone1, telefone2 = excluded.telefone2,
      email = excluded.email, email_repeticoes = excluded.email_repeticoes,
      telefone1_repeticoes = excluded.telefone1_repeticoes, telefone2_repeticoes = excluded.telefone2_repeticoes,
      situacao = 'ativa', importacao_id = excluded.importacao_id, atualizado_em = excluded.atualizado_em
  `);

  const agora = agoraIso();
  const rep = (chave: string, valor: string) => (valor ? (repeticoes.get(chave) ?? 0) : 0);
  const { gravadas, encerradas } = emTransacao(db, () => {
    let gravadas = 0;
    for (const e of estabelecimentos.values()) {
      const dados = empresas.get(e.cnpjBasico);
      if (!dados) continue;
      const porte = porteElegivel(dados.natureza, dados.porte, meis.has(e.cnpjBasico));
      if (!porte) continue;
      upsert.run({
        cnpj: e.cnpj,
        cnpj_basico: e.cnpjBasico,
        matriz: e.matriz ? 1 : 0,
        razao_social: dados.razaoSocial,
        nome_fantasia: e.nomeFantasia,
        natureza: dados.natureza,
        porte,
        cnae: e.cnae,
        data_abertura: e.dataAbertura,
        logradouro: e.logradouro,
        numero: e.numero,
        complemento: e.complemento,
        bairro: e.bairro,
        cep: e.cep,
        uf: e.uf,
        municipio_codigo: e.municipio,
        municipio_nome: municipioNome,
        telefone1: e.telefone1,
        telefone2: e.telefone2,
        email: e.email,
        email_repeticoes: rep(`e:${e.email}`, e.email),
        telefone1_repeticoes: rep(`t:${e.telefone1}`, e.telefone1),
        telefone2_repeticoes: rep(`t:${e.telefone2}`, e.telefone2),
        importacao_id: importacaoId,
        atualizado_em: agora,
      });
      gravadas++;
    }
    // Quem estava ativo e não veio nesta importação deixou de ser ativo e elegível. Não apaga.
    const marcadores = [...codigos].map(() => "?").join(",");
    const encerradas = Number(
      db
        .prepare(
          `UPDATE empresas SET situacao = 'encerrada', atualizado_em = ?
           WHERE municipio_codigo IN (${marcadores}) AND uf = ? AND situacao = 'ativa' AND importacao_id <> ?`,
        )
        .run(agora, ...codigos, ufAlvo, importacaoId).changes,
    );
    db.prepare(`UPDATE importacoes SET terminada_em = ?, linhas_lidas = ?, gravadas = ? WHERE id = ?`).run(
      agoraIso(),
      ativosNoMunicipio,
      gravadas,
      importacaoId,
    );
    return { gravadas, encerradas };
  });

  log(`Gravadas ${gravadas} empresas elegíveis; ${encerradas} marcadas como encerradas.`);
  return {
    importacaoId,
    municipioCodigo: [...codigos].join(","),
    municipioNome,
    ativosNoMunicipio,
    noRamo: estabelecimentos.size,
    gravadas,
    encerradas,
    linhasIgnoradas,
  };
}
