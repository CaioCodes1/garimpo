import { promises as dns } from "node:dns";
import { emTransacao, type Banco } from "../db/banco";
import type { EstadoVerificacao } from "../pontuador/nota";
import { alvoDaEmpresa, type Alvo } from "./alvo";
import { EnderecoInterno, getStatus } from "./http-seguro";

export { alvoDaEmpresa, type Alvo } from "./alvo";

/** O que uma verificação isolada concluiu, antes de olhar o histórico. */
export type Resultado = "ok" | "sem_https" | "sem_site" | "falha" | "incerto";

export type RespostaDns = "tem_ip" | "sem_ip" | "erro";

/**
 * Resposta de um pedido HTTP: o status, ou o motivo de não haver um.
 * - "cadeia_incompleta": o servidor não mandou o certificado intermediário. O Node recusa, mas os
 *   navegadores completam a cadeia sozinhos e abrem o site normalmente. Não é problema do cliente.
 * - "tempo_esgotado": não respondeu a tempo. Pode ser lentidão; não prova nada.
 * - "bloqueado": o domínio aponta para um endereço interno (rede local, loopback). Não acessamos,
 *   e por isso não sabemos nada sobre o site.
 * - null: recusou, resetou ou o certificado é de fato inválido (nome errado, vencido, autoassinado).
 */
export type RespostaHttp = number | "cadeia_incompleta" | "tempo_esgotado" | "bloqueado" | null;

/** Tudo que toca a rede passa por aqui, para os testes poderem simular. */
export interface Sonda {
  dns(host: string): Promise<RespostaDns>;
  http(url: string, seguirRedirecionamento: boolean): Promise<RespostaHttp>;
}

const responde = (r: RespostaHttp): r is number => typeof r === "number" && r < 500;

export async function verificarAlvo(alvo: Alvo, sonda: Sonda): Promise<Resultado> {
  const outro = alvo.host.startsWith("www.") ? alvo.host.slice(4) : `www.${alvo.host}`;
  const respostas = await Promise.all([sonda.dns(alvo.host), sonda.dns(outro)]);
  const hosts = [alvo.host, outro].filter((_, i) => respostas[i] === "tem_ip");
  if (hosts.length === 0) {
    if (respostas.includes("erro")) return "incerto";
    return alvo.origem === "email" ? "sem_site" : "falha";
  }
  // Lento ou bloqueado: nenhuma conclusão pode ser tirada a partir daí.
  let semCerteza = false;
  for (const host of hosts) {
    const https = await sonda.http(`https://${host}/`, true);
    // 4xx ainda é um servidor respondendo (proteção anti-robô, página raiz faltando): não dá para
    // afirmar que há problema, e afirmar problema sem certeza é o pior erro possível aqui.
    if (responde(https) || https === "cadeia_incompleta") return "ok";
    if (https === "tempo_esgotado" || https === "bloqueado") semCerteza = true;
  }
  for (const host of hosts) {
    const http = await sonda.http(`http://${host}/`, false);
    // HTTP responde, mas o HTTPS só demorou: talvez exista e esteja lento. Não afirma nada.
    if (responde(http)) return semCerteza ? "incerto" : "sem_https";
    if (http === "bloqueado") semCerteza = true;
  }
  return semCerteza ? "incerto" : "falha";
}

export interface Historico {
  falhas: number;
  primeiraFalhaEm: string | null;
}

const UMA_HORA = 60 * 60 * 1000;

/**
 * "fora_do_ar" só depois de duas falhas com pelo menos uma hora entre a primeira e a atual.
 * Qualquer sucesso zera o histórico.
 */
export function proximoEstado(
  resultado: Resultado,
  anterior: Historico | null,
  agora: Date,
): { estado: EstadoVerificacao } & Historico {
  // Incerteza não conta como falha nem zera o histórico.
  if (resultado === "incerto") {
    return { estado: "inconclusivo", falhas: anterior?.falhas ?? 0, primeiraFalhaEm: anterior?.primeiraFalhaEm ?? null };
  }
  if (resultado !== "falha") return { estado: resultado, falhas: 0, primeiraFalhaEm: null };
  const falhas = (anterior?.falhas ?? 0) + 1;
  const primeiraFalhaEm = anterior?.primeiraFalhaEm ?? agora.toISOString();
  const confirmado = falhas >= 2 && agora.getTime() - new Date(primeiraFalhaEm).getTime() >= UMA_HORA;
  return { estado: confirmado ? "fora_do_ar" : "inconclusivo", falhas, primeiraFalhaEm };
}

export function sondaReal(userAgent: string, tempoLimiteMs = 8_000): Sonda {
  return {
    async dns(host) {
      const tentar = async (fn: (h: string) => Promise<string[]>) => {
        try {
          return (await fn(host)).length > 0 ? "tem_ip" : "sem_ip";
        } catch (erro) {
          const codigo = (erro as NodeJS.ErrnoException).code;
          return codigo === "ENOTFOUND" || codigo === "ENODATA" ? "sem_ip" : "erro";
        }
      };
      const [v4, v6] = await Promise.all([tentar(dns.resolve4), tentar(dns.resolve6)]);
      if (v4 === "tem_ip" || v6 === "tem_ip") return "tem_ip";
      return v4 === "erro" && v6 === "erro" ? "erro" : "sem_ip";
    },
    async http(url, seguir) {
      try {
        return await getStatus(url, { seguirRedirecionamento: seguir, userAgent, tempoLimiteMs });
      } catch (erro) {
        return classificarErroHttp(erro);
      }
    },
  };
}

const ERROS_DE_CADEIA = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_GET_ISSUER_CERT",
]);

/** Traduz o erro da requisição para a sonda. O código vem em erro.code (node:https) ou erro.cause. */
export function classificarErroHttp(erro: unknown): RespostaHttp {
  const e = erro as { name?: string; code?: string; cause?: { code?: string; name?: string } };
  if (e instanceof EnderecoInterno || e.code === "EENDERECOINTERNO") return "bloqueado";
  if (e.name === "TimeoutError" || e.cause?.name === "TimeoutError" || e.code === "UND_ERR_CONNECT_TIMEOUT") {
    return "tempo_esgotado";
  }
  const codigo = e.code ?? e.cause?.code;
  if (codigo && ERROS_DE_CADEIA.has(codigo)) return "cadeia_incompleta";
  return null;
}

/** Antes de acusar sites alheios, confere se a internet daqui está funcionando. */
export async function internetFunciona(): Promise<boolean> {
  try {
    const r = await fetch("https://www.google.com/generate_204", { signal: AbortSignal.timeout(8_000) });
    return r.status === 204;
  } catch {
    return false;
  }
}

interface Pendente {
  cnpj: string;
  site_osm: string | null;
  email: string;
  email_repeticoes: number;
  alvo_anterior: string | null;
  estado_anterior: EstadoVerificacao | null;
  verificado_em: string | null;
  falhas: number | null;
  primeira_falha_em: string | null;
}

export interface OpcoesVerificacao {
  provedores: Set<string>;
  limiteContador: number;
  sonda: Sonda;
  agora?: () => Date;
  simultaneas?: number;
  /** Refaz verificações conclusivas mais velhas que isto. */
  validadeDias?: number;
  log?: (m: string) => void;
}

export async function verificarPendentes(db: Banco, o: OpcoesVerificacao): Promise<Record<EstadoVerificacao, number>> {
  const agora = o.agora ?? (() => new Date());
  const validade = new Date(agora().getTime() - (o.validadeDias ?? 30) * 86_400_000).toISOString();
  const candidatas = db
    .prepare(
      `SELECT e.cnpj, e.site_osm, e.email, e.email_repeticoes,
              v.alvo AS alvo_anterior, v.estado AS estado_anterior, v.verificado_em, v.falhas, v.primeira_falha_em
       FROM empresas e LEFT JOIN verificacoes v ON v.cnpj = e.cnpj
       WHERE e.situacao = 'ativa' AND (e.site_osm IS NOT NULL OR e.email <> '')`,
    )
    .all() as unknown as Pendente[];

  // Várias empresas podem usar o mesmo domínio: cada domínio é testado uma vez só.
  const porAlvo = new Map<string, { alvo: Alvo; empresas: Pendente[] }>();
  let pendentes = 0;
  for (const p of candidatas) {
    const alvo = alvoDaEmpresa(p.site_osm, p.email, p.email_repeticoes < o.limiteContador, o.provedores);
    if (!alvo) continue;
    const vale =
      p.alvo_anterior === alvo.host &&
      p.estado_anterior !== "inconclusivo" &&
      p.verificado_em !== null &&
      p.verificado_em >= validade;
    if (vale) continue;
    pendentes++;
    const chave = `${alvo.origem}:${alvo.host}`;
    const grupo = porAlvo.get(chave) ?? { alvo, empresas: [] };
    grupo.empresas.push(p);
    porAlvo.set(chave, grupo);
  }
  const grupos = [...porAlvo.values()];
  o.log?.(`${grupos.length} domínios para verificar (${pendentes} empresas).`);

  const gravar = db.prepare(
    `INSERT INTO verificacoes (cnpj, alvo, estado, falhas, primeira_falha_em, verificado_em) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (cnpj) DO UPDATE SET alvo = excluded.alvo, estado = excluded.estado, falhas = excluded.falhas,
       primeira_falha_em = excluded.primeira_falha_em, verificado_em = excluded.verificado_em`,
  );
  // Grava aos poucos: se o processo cair no meio, o que já foi verificado fica.
  let fila: ({ cnpj: string; alvo: string; estado: EstadoVerificacao } & Historico)[] = [];
  const descarregar = () => {
    if (fila.length === 0) return;
    const lote = fila;
    fila = [];
    const quando = agora().toISOString();
    emTransacao(db, () => {
      for (const r of lote) gravar.run(r.cnpj, r.alvo, r.estado, r.falhas, r.primeiraFalhaEm, quando);
    });
  };

  const contagem: Record<EstadoVerificacao, number> = { ok: 0, sem_https: 0, sem_site: 0, fora_do_ar: 0, inconclusivo: 0 };
  let proxima = 0;
  let feitos = 0;
  const trabalhador = async () => {
    while (proxima < grupos.length) {
      const { alvo, empresas } = grupos[proxima++]!;
      const resultado = await verificarAlvo(alvo, o.sonda);
      for (const p of empresas) {
        // Alvo novo (site mudou no OSM, e-mail mudou) não herda falhas do alvo antigo.
        const anterior = p.alvo_anterior === alvo.host && p.falhas !== null
          ? { falhas: p.falhas, primeiraFalhaEm: p.primeira_falha_em }
          : null;
        const proximo = proximoEstado(resultado, anterior, agora());
        contagem[proximo.estado]++;
        fila.push({ cnpj: p.cnpj, alvo: alvo.host, ...proximo });
      }
      if (++feitos % 50 === 0) {
        descarregar();
        o.log?.(`  ${feitos}/${grupos.length} domínios`);
      }
    }
  };
  await Promise.all(Array.from({ length: o.simultaneas ?? 10 }, trabalhador));
  descarregar();
  return contagem;
}
