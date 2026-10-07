import { agoraIso, emTransacao, type Banco } from "../db/banco";
import { limparRazaoSocial, normalizar, normalizarLogradouro, normalizarNomeEmpresa } from "../lib/texto";

type Fetch = typeof fetch;

export interface ElementoOsm {
  nome: string;
  rua: string;
  site: string | null;
  lat: number | null;
  lon: number | null;
}

interface RespostaOverpass {
  elements: {
    id: number;
    lat?: number;
    lon?: number;
    center?: { lat: number; lon: number };
    tags?: Record<string, string>;
  }[];
}

async function consultar(url: string, consulta: string, userAgent: string, f: Fetch): Promise<RespostaOverpass> {
  const esperas = [10_000, 30_000, 60_000];
  for (let tentativa = 0; ; tentativa++) {
    try {
      const resposta = await f(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": userAgent },
        body: new URLSearchParams({ data: consulta }),
        signal: AbortSignal.timeout(240_000),
      });
      // 429 e 504 são o servidor público dizendo "agora não": espera e tenta de novo.
      if (resposta.status === 429 || resposta.status >= 500) throw new Error(`HTTP ${resposta.status}`);
      if (!resposta.ok) throw new Error(`Overpass respondeu HTTP ${resposta.status}`);
      return (await resposta.json()) as RespostaOverpass;
    } catch (erro) {
      const espera = esperas[tentativa];
      if (espera === undefined) throw new Error(`OpenStreetMap indisponível: ${(erro as Error).message}`);
      await new Promise((r) => setTimeout(r, espera));
    }
  }
}

/** Acha a relação do município no OSM comparando nomes sem acento dentro da UF. */
export async function acharAreaMunicipio(
  url: string,
  municipio: string,
  uf: string,
  userAgent: string,
  f: Fetch = fetch,
): Promise<number | null> {
  const consulta = `[out:json][timeout:90];
area["ISO3166-2"="BR-${uf.toUpperCase()}"]->.uf;
rel(area.uf)["boundary"="administrative"]["admin_level"="8"];
out tags;`;
  const { elements } = await consultar(url, consulta, userAgent, f);
  const alvo = normalizar(municipio);
  const rel = elements.find((e) => normalizar(e.tags?.name ?? "") === alvo);
  // Áreas do Overpass derivadas de relações têm id = 3600000000 + id da relação.
  return rel ? 3_600_000_000 + rel.id : null;
}

export async function buscarComercios(url: string, areaId: number, userAgent: string, f: Fetch = fetch): Promise<ElementoOsm[]> {
  const consulta = `[out:json][timeout:180];
area(id:${areaId})->.a;
nwr(area.a)["name"]["addr:street"];
out tags center;`;
  const { elements } = await consultar(url, consulta, userAgent, f);
  return elements.map((e) => ({
    nome: e.tags?.name ?? "",
    rua: e.tags?.["addr:street"] ?? "",
    site: e.tags?.website ?? e.tags?.["contact:website"] ?? null,
    lat: e.lat ?? e.center?.lat ?? null,
    lon: e.lon ?? e.center?.lon ?? null,
  }));
}

interface EmpresaParaCruzar {
  cnpj: string;
  nome_fantasia: string;
  razao_social: string;
  logradouro: string;
}

/**
 * Cruza por nome normalizado E logradouro normalizado. Sem as duas coincidências, não cruza:
 * melhor não enriquecer do que enriquecer errado. Nome que aparece em dois lugares da mesma rua
 * também não cruza.
 */
export function cruzar(empresas: EmpresaParaCruzar[], elementos: ElementoOsm[]): Map<string, ElementoOsm> {
  const porNome = new Map<string, ElementoOsm[]>();
  for (const el of elementos) {
    const chave = normalizarNomeEmpresa(el.nome);
    if (!chave) continue;
    porNome.set(chave, [...(porNome.get(chave) ?? []), el]);
  }
  const resultado = new Map<string, ElementoOsm>();
  for (const emp of empresas) {
    const nomes = new Set(
      [emp.nome_fantasia, limparRazaoSocial(emp.razao_social)].map(normalizarNomeEmpresa).filter(Boolean),
    );
    const rua = normalizarLogradouro(emp.logradouro);
    const candidatos = [...nomes].flatMap((n) => porNome.get(n) ?? []).filter((el) => normalizarLogradouro(el.rua) === rua);
    if (candidatos.length === 1) resultado.set(emp.cnpj, candidatos[0]!);
  }
  return resultado;
}

export interface ResumoEnriquecimento {
  municipio: string;
  elementosOsm: number;
  cruzadas: number;
  comSite: number;
}

/** Enriquece cada município já importado. Um município que falha não impede os outros. */
export async function enriquecer(
  db: Banco,
  opcoes: { url: string; userAgent: string; log?: (m: string) => void },
  f: Fetch = fetch,
): Promise<ResumoEnriquecimento[]> {
  const log = opcoes.log ?? (() => {});
  const municipios = db
    .prepare(`SELECT DISTINCT municipio_nome, uf FROM empresas WHERE situacao = 'ativa'`)
    .all() as unknown as { municipio_nome: string; uf: string }[];
  const resumos: ResumoEnriquecimento[] = [];

  for (const { municipio_nome: municipio, uf } of municipios) {
    const area = await acharAreaMunicipio(opcoes.url, municipio, uf, opcoes.userAgent, f);
    if (area === null) {
      log(`Não achei ${municipio}/${uf} no OpenStreetMap; seguindo sem enriquecer.`);
      continue;
    }
    const elementos = await buscarComercios(opcoes.url, area, opcoes.userAgent, f);
    const empresas = db
      .prepare(
        `SELECT cnpj, nome_fantasia, razao_social, logradouro FROM empresas
         WHERE situacao = 'ativa' AND municipio_nome = ? AND uf = ?`,
      )
      .all(municipio, uf) as unknown as EmpresaParaCruzar[];
    const cruzadas = cruzar(empresas, elementos);

    const gravar = db.prepare(`UPDATE empresas SET lat = ?, lon = ?, site_osm = ?, atualizado_em = ? WHERE cnpj = ?`);
    const agora = agoraIso();
    let comSite = 0;
    emTransacao(db, () => {
      for (const [cnpj, el] of cruzadas) {
        if (el.site) comSite++;
        gravar.run(el.lat, el.lon, el.site, agora, cnpj);
      }
    });
    log(`${municipio}/${uf}: ${elementos.length} lugares no OSM, ${cruzadas.size} empresas cruzadas (${comSite} com site).`);
    resumos.push({ municipio: `${municipio}/${uf}`, elementosOsm: elementos.length, cruzadas: cruzadas.size, comSite });
  }
  return resumos;
}
