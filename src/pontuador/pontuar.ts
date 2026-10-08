import { agoraIso, emTransacao, type Banco } from "../db/banco";
import { calcularNota, type ContextoNota, type EstadoVerificacao } from "./nota";

interface Linha {
  cnpj: string;
  email: string;
  email_repeticoes: number;
  telefone1: string;
  telefone1_repeticoes: number;
  telefone2: string;
  telefone2_repeticoes: number;
  data_abertura: string | null;
  cnae: string;
  site_osm: string | null;
  alvo: string | null;
  estado: EstadoVerificacao | null;
}

/** Recalcula a nota de todas as empresas ativas. É barato: roda inteiro a cada vez. */
export function pontuarTodas(db: Banco, ctx: ContextoNota): number {
  const linhas = db
    .prepare(
      `SELECT e.cnpj, e.email, e.email_repeticoes, e.telefone1, e.telefone1_repeticoes,
              e.telefone2, e.telefone2_repeticoes, e.data_abertura, e.cnae, e.site_osm, v.alvo, v.estado
       FROM empresas e LEFT JOIN verificacoes v ON v.cnpj = e.cnpj
       WHERE e.situacao = 'ativa'`,
    )
    .all() as unknown as Linha[];

  const gravar = db.prepare(
    `INSERT INTO pontuacoes (cnpj, nota, motivos, modelo, calculado_em) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (cnpj) DO UPDATE SET nota = excluded.nota, motivos = excluded.motivos,
       modelo = excluded.modelo, calculado_em = excluded.calculado_em`,
  );
  const agora = agoraIso();
  emTransacao(db, () => {
    for (const l of linhas) {
      const r = calcularNota(
        {
          email: l.email,
          emailRepeticoes: l.email_repeticoes,
          telefone1: l.telefone1,
          telefone1Repeticoes: l.telefone1_repeticoes,
          telefone2: l.telefone2,
          telefone2Repeticoes: l.telefone2_repeticoes,
          dataAbertura: l.data_abertura,
          cnae: l.cnae,
          siteOsm: l.site_osm,
          alvoVerificado: l.alvo,
          estadoVerificacao: l.estado,
        },
        ctx,
      );
      gravar.run(l.cnpj, r.nota, JSON.stringify(r.motivos), r.modelo, agora);
    }
  });
  return linhas.length;
}
