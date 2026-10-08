import type { Banco } from "../db/banco";
import { normalizarBairro, tituloCaso } from "../lib/texto";

export const STATUS = ["novo", "mensagem_enviada", "respondeu", "proposta", "fechado", "perdido", "nao_contatar"] as const;
export type Status = (typeof STATUS)[number];

export const ROTULO_STATUS: Record<Status, string> = {
  novo: "Novo",
  mensagem_enviada: "Mensagem enviada",
  respondeu: "Respondeu",
  proposta: "Proposta",
  fechado: "Fechado",
  perdido: "Perdido",
  nao_contatar: "Não contatar",
};

/** Faixas de idade do filtro: meses de aberta em [de, ate). */
export const FAIXAS_IDADE = {
  ate1: { rotulo: "Menos de 1 ano", de: 0, ate: 12 },
  "1a3": { rotulo: "1 a 3 anos", de: 12, ate: 36 },
  "3a5": { rotulo: "3 a 5 anos", de: 36, ate: 60 },
  mais5: { rotulo: "Mais de 5 anos", de: 60, ate: null },
} as const;
export type FaixaIdadeFiltro = keyof typeof FAIXAS_IDADE;

export interface Filtros {
  bairro?: string;
  ramo?: string;
  notaMin?: number;
  idade?: FaixaIdadeFiltro;
  /** Sem status: todos menos "não contatar". */
  status?: Status;
  busca?: string;
}

export interface Lead {
  cnpj: string;
  nome_fantasia: string;
  razao_social: string;
  porte: string;
  cnae: string;
  data_abertura: string | null;
  logradouro: string;
  numero: string;
  bairro: string;
  municipio_nome: string;
  uf: string;
  telefone1: string;
  telefone1_repeticoes: number;
  telefone2: string;
  telefone2_repeticoes: number;
  email: string;
  email_repeticoes: number;
  site_osm: string | null;
  nota: number;
  motivos: string;
  modelo: string;
  alvo: string | null;
  estado: string | null;
  status: Status;
  anotacoes: string;
  contatado_em: string | null;
}

function onde(db: Banco, f: Filtros, hoje: Date): { sql: string; params: (string | number)[] } {
  const partes = ["e.situacao = 'ativa'"];
  const params: (string | number)[] = [];
  if (f.status) {
    partes.push("COALESCE(f.status, 'novo') = ?");
    params.push(f.status);
  } else {
    partes.push("COALESCE(f.status, 'novo') <> 'nao_contatar'");
  }
  if (f.bairro) {
    const variantes = variantesDoBairro(db, f.bairro);
    if (variantes.length === 0) {
      partes.push("0");
    } else {
      partes.push(`e.bairro IN (${variantes.map(() => "?").join(",")})`);
      params.push(...variantes);
    }
  }
  if (f.ramo) {
    partes.push("e.cnae LIKE ?");
    params.push(`${f.ramo}%`);
  }
  if (f.notaMin) {
    partes.push("p.nota >= ?");
    params.push(f.notaMin);
  }
  if (f.idade) {
    const { de, ate } = FAIXAS_IDADE[f.idade];
    const mesesAtras = (n: number) => new Date(hoje.getFullYear(), hoje.getMonth() - n, hoje.getDate()).toISOString().slice(0, 10);
    partes.push("e.data_abertura <= ?");
    params.push(mesesAtras(de));
    if (ate !== null) {
      partes.push("e.data_abertura > ?");
      params.push(mesesAtras(ate));
    }
  }
  if (f.busca) {
    partes.push("(e.nome_fantasia LIKE ? OR e.razao_social LIKE ?)");
    params.push(`%${f.busca.toUpperCase()}%`, `%${f.busca.toUpperCase()}%`);
  }
  return { sql: partes.join(" AND "), params };
}

const BASE = `
  FROM empresas e
  JOIN pontuacoes p ON p.cnpj = e.cnpj
  LEFT JOIN verificacoes v ON v.cnpj = e.cnpj
  LEFT JOIN funil f ON f.cnpj = e.cnpj`;

export function listarLeads(db: Banco, f: Filtros, pagina: number, porPagina: number, hoje = new Date()) {
  const w = onde(db, f, hoje);
  const total = (db.prepare(`SELECT COUNT(*) AS n ${BASE} WHERE ${w.sql}`).get(...w.params) as { n: number }).n;
  const leads = db
    .prepare(
      `SELECT e.cnpj, e.nome_fantasia, e.razao_social, e.porte, e.cnae, e.data_abertura, e.logradouro, e.numero,
              e.bairro, e.municipio_nome, e.uf, e.telefone1, e.telefone1_repeticoes, e.telefone2, e.telefone2_repeticoes,
              e.email, e.email_repeticoes, e.site_osm, p.nota, p.motivos, p.modelo, v.alvo, v.estado,
              COALESCE(f.status, 'novo') AS status, COALESCE(f.anotacoes, '') AS anotacoes, f.contatado_em
       ${BASE} WHERE ${w.sql}
       ORDER BY p.nota DESC, (e.nome_fantasia GLOB '*[A-Za-z]*') DESC, e.data_abertura DESC, e.cnpj
       LIMIT ? OFFSET ?`,
    )
    .all(...w.params, porPagina, (pagina - 1) * porPagina) as unknown as Lead[];
  return { total, leads };
}

function bairrosCrus(db: Banco): { bairro: string; n: number }[] {
  return db
    .prepare(`SELECT bairro, COUNT(*) AS n FROM empresas WHERE situacao = 'ativa' AND bairro <> '' GROUP BY bairro`)
    .all() as unknown as { bairro: string; n: number }[];
}

/** Bairros agrupados pelas grafias ("Jd do Mar" + "Jardim do Mar"), com 3 ou mais empresas. */
export function bairros(db: Banco): { chave: string; rotulo: string; n: number }[] {
  const grupos = new Map<string, number>();
  for (const { bairro, n } of bairrosCrus(db)) {
    const chave = normalizarBairro(bairro);
    grupos.set(chave, (grupos.get(chave) ?? 0) + n);
  }
  return [...grupos]
    .filter(([, n]) => n >= 3)
    .map(([chave, n]) => ({ chave, rotulo: tituloCaso(chave), n }))
    .sort((a, b) => a.chave.localeCompare(b.chave));
}

/** As grafias do cadastro que caem na mesma chave de bairro. */
function variantesDoBairro(db: Banco, chave: string): string[] {
  return bairrosCrus(db)
    .map((b) => b.bairro)
    .filter((b) => normalizarBairro(b) === chave);
}

export function contagemFunil(db: Banco): Record<Status, number> {
  const linhas = db
    .prepare(
      `SELECT COALESCE(f.status, 'novo') AS status, COUNT(*) AS n
       FROM empresas e LEFT JOIN funil f ON f.cnpj = e.cnpj
       WHERE e.situacao = 'ativa' GROUP BY 1`,
    )
    .all() as unknown as { status: Status; n: number }[];
  const contagem = Object.fromEntries(STATUS.map((s) => [s, 0])) as Record<Status, number>;
  for (const l of linhas) contagem[l.status] = l.n;
  return contagem;
}

export function resumoBase(db: Banco): { municipios: string[]; ultimaImportacao: string | null } {
  const municipios = (
    db.prepare(`SELECT DISTINCT municipio_nome || '/' || uf AS m FROM empresas WHERE situacao = 'ativa' ORDER BY 1`).all() as {
      m: string;
    }[]
  ).map((r) => r.m);
  const ultima = db.prepare(`SELECT mes_referencia FROM importacoes WHERE terminada_em IS NOT NULL ORDER BY id DESC LIMIT 1`).get() as
    | { mes_referencia: string }
    | undefined;
  return { municipios, ultimaImportacao: ultima?.mes_referencia ?? null };
}

/** Grava o status. "Mensagem enviada" registra a data do primeiro contato. */
export function mudarStatus(db: Banco, cnpj: string, status: Status, agora = new Date()): void {
  db.prepare(
    `INSERT INTO funil (cnpj, status, contatado_em, atualizado_em) VALUES (@cnpj, @status, @contato, @agora)
     ON CONFLICT (cnpj) DO UPDATE SET status = excluded.status, atualizado_em = excluded.atualizado_em,
       contatado_em = COALESCE(funil.contatado_em, excluded.contatado_em)`,
  ).run({ cnpj, status, contato: status === "mensagem_enviada" ? agora.toISOString() : null, agora: agora.toISOString() });
}

export function salvarAnotacoes(db: Banco, cnpj: string, anotacoes: string, agora = new Date()): void {
  db.prepare(
    `INSERT INTO funil (cnpj, status, anotacoes, atualizado_em) VALUES (?, 'novo', ?, ?)
     ON CONFLICT (cnpj) DO UPDATE SET anotacoes = excluded.anotacoes, atualizado_em = excluded.atualizado_em`,
  ).run(cnpj, anotacoes.slice(0, 5000), agora.toISOString());
}
