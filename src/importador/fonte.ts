/**
 * Listagem do compartilhamento público da Receita (Nextcloud) via WebDAV.
 * Desde jan/2026 os arquivos ficam em <webdav>/<AAAA-MM>/<Arquivo>.zip.
 */

export interface ArquivoRemoto {
  nome: string;
  tamanho: number;
}

export class FonteIndisponivel extends Error {
  constructor(base: string, detalhe: string) {
    super(
      `Não consegui listar os arquivos da Receita em ${base} (${detalhe}).\n` +
        "Se a Receita mudou o endereço de novo, atualize 'receita.webdav' em config/fontes.json.",
    );
    this.name = "FonteIndisponivel";
  }
}

type Fetch = typeof fetch;

async function propfind(url: string, base: string, f: Fetch): Promise<string> {
  let resposta: Response;
  try {
    resposta = await f(url, { method: "PROPFIND", headers: { Depth: "1" }, signal: AbortSignal.timeout(60_000) });
  } catch (erro) {
    throw new FonteIndisponivel(base, (erro as Error).message);
  }
  if (resposta.status !== 207) throw new FonteIndisponivel(base, `HTTP ${resposta.status}`);
  return resposta.text();
}

/** Cada <d:response> do XML vira { href, tamanho }. Regex basta: o XML do Nextcloud é estável e plano. */
function lerRespostas(xml: string): { href: string; tamanho: number }[] {
  return xml
    .split(/<d:response>/)
    .slice(1)
    .map((bloco) => ({
      href: decodeURIComponent(/<d:href>([^<]+)<\/d:href>/.exec(bloco)?.[1] ?? ""),
      tamanho: Number(/<d:getcontentlength>(\d+)</.exec(bloco)?.[1] ?? 0),
    }));
}

export async function listarMeses(base: string, f: Fetch = fetch): Promise<string[]> {
  const xml = await propfind(`${base}/`, base, f);
  const meses = lerRespostas(xml)
    .map((r) => /\/(\d{4}-\d{2})\/$/.exec(r.href)?.[1])
    .filter((m): m is string => Boolean(m));
  return [...new Set(meses)].sort();
}

export async function listarArquivos(base: string, mes: string, f: Fetch = fetch): Promise<ArquivoRemoto[]> {
  const xml = await propfind(`${base}/${mes}/`, base, f);
  return lerRespostas(xml)
    .map((r) => ({ nome: /\/([^/]+\.zip)$/i.exec(r.href)?.[1] ?? "", tamanho: r.tamanho }))
    .filter((a) => a.nome !== "");
}

/** Os arquivos que o garimpo usa. Sócios ficam de fora (não servem e pesam ~700 MB). */
export function arquivosNecessarios(todos: ArquivoRemoto[]): ArquivoRemoto[] {
  return todos.filter((a) => /^(Estabelecimentos\d|Empresas\d|Simples|Municipios)\.zip$/.test(a.nome));
}
