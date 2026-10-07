import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pastaDados } from "../config";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS importacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  municipio_codigo TEXT NOT NULL,
  municipio_nome TEXT NOT NULL,
  uf TEXT NOT NULL,
  mes_referencia TEXT NOT NULL,
  iniciada_em TEXT NOT NULL,
  terminada_em TEXT,
  linhas_lidas INTEGER NOT NULL DEFAULT 0,
  gravadas INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS empresas (
  cnpj TEXT PRIMARY KEY,
  cnpj_basico TEXT NOT NULL,
  matriz INTEGER NOT NULL,
  razao_social TEXT NOT NULL,
  nome_fantasia TEXT NOT NULL,
  natureza TEXT NOT NULL,
  porte TEXT NOT NULL CHECK (porte IN ('mei', 'me', 'epp')),
  cnae TEXT NOT NULL,
  data_abertura TEXT,
  logradouro TEXT NOT NULL,
  numero TEXT NOT NULL,
  complemento TEXT NOT NULL,
  bairro TEXT NOT NULL,
  cep TEXT NOT NULL,
  uf TEXT NOT NULL,
  municipio_codigo TEXT NOT NULL,
  municipio_nome TEXT NOT NULL,
  telefone1 TEXT NOT NULL,
  telefone2 TEXT NOT NULL,
  email TEXT NOT NULL,
  -- quantos estabelecimentos ativos do município usam o mesmo contato (detecção de contador)
  email_repeticoes INTEGER NOT NULL DEFAULT 0,
  telefone1_repeticoes INTEGER NOT NULL DEFAULT 0,
  telefone2_repeticoes INTEGER NOT NULL DEFAULT 0,
  situacao TEXT NOT NULL CHECK (situacao IN ('ativa', 'encerrada')),
  lat REAL,
  lon REAL,
  site_osm TEXT,
  importacao_id INTEGER NOT NULL REFERENCES importacoes(id),
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS empresas_municipio ON empresas (municipio_codigo, situacao);

CREATE TABLE IF NOT EXISTS verificacoes (
  cnpj TEXT PRIMARY KEY REFERENCES empresas(cnpj),
  alvo TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('ok', 'sem_https', 'sem_site', 'fora_do_ar', 'inconclusivo')),
  falhas INTEGER NOT NULL DEFAULT 0,
  primeira_falha_em TEXT,
  verificado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pontuacoes (
  cnpj TEXT PRIMARY KEY REFERENCES empresas(cnpj),
  nota INTEGER NOT NULL,
  motivos TEXT NOT NULL,
  modelo TEXT NOT NULL,
  calculado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pontuacoes_nota ON pontuacoes (nota DESC);

-- Única tabela escrita pelo usuário. Nenhum módulo de importação ou cálculo escreve aqui.
CREATE TABLE IF NOT EXISTS funil (
  cnpj TEXT PRIMARY KEY REFERENCES empresas(cnpj),
  status TEXT NOT NULL CHECK (status IN
    ('novo', 'mensagem_enviada', 'respondeu', 'proposta', 'fechado', 'perdido', 'nao_contatar')),
  anotacoes TEXT NOT NULL DEFAULT '',
  contatado_em TEXT,
  atualizado_em TEXT NOT NULL
);
`;

export type Banco = DatabaseSync;

export function caminhoBanco(): string {
  return path.join(/*turbopackIgnore: true*/ pastaDados(), "garimpo.db");
}

export function abrirBanco(caminho = caminhoBanco()): Banco {
  if (caminho !== ":memory:") mkdirSync(path.dirname(/*turbopackIgnore: true*/ caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  return db;
}

export function emTransacao<T>(db: Banco, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const resultado = fn();
    db.exec("COMMIT");
    return resultado;
  } catch (erro) {
    db.exec("ROLLBACK");
    throw erro;
  }
}

export function agoraIso(): string {
  return new Date().toISOString();
}
