/**
 * Qual domínio verificar para cada empresa, e quando uma verificação ainda vale.
 * Sem rede: usado pelo verificador, pelo pontuador e pelo painel.
 */
import type { EstadoVerificacao } from "../pontuador/nota";

export interface Alvo {
  host: string;
  /** Domínio de e-mail sem endereço web = "tem domínio, sem site". Site do OSM sem endereço = falha. */
  origem: "email" | "osm";
}

export function dominioDoEmail(email: string): string {
  return email.split("@")[1]?.trim().toLowerCase() ?? "";
}

/** Distância de edição contando troca de duas letras vizinhas como 1 ("gmial" → "gmail"). */
function distancia(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + custo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

const SUFIXOS_COMUNS = new Set(["com", "com.br", "net", "net.br"]);

/**
 * Provedor gratuito, inclusive digitado errado no cadastro ("hootmail.com", "outook.com",
 * "icoud.com", "gmail.com.br"). Esses domínios de erro de digitação são de terceiros e respondem
 * com páginas estacionadas: verificá-los diria "tem site" ou "site com problema" sobre um site
 * que não é da empresa. Só compara nomes de provedor com 5+ letras e com 1 letra de diferença,
 * para não pegar domínios legítimos parecidos ("hotmart.com" está a 2 de "hotmail").
 */
export function ehProvedorGratuito(dominio: string, provedores: Set<string>): boolean {
  if (provedores.has(dominio)) return true;
  const ponto = dominio.indexOf(".");
  if (ponto < 1) return false;
  const nome = dominio.slice(0, ponto);
  const sufixo = dominio.slice(ponto + 1);
  if (!SUFIXOS_COMUNS.has(sufixo)) return false;
  for (const provedor of provedores) {
    const nomeProvedor = provedor.slice(0, provedor.indexOf("."));
    if (nomeProvedor.length >= 5 && distancia(nome, nomeProvedor) <= 1) return true;
  }
  return false;
}

export function alvoDaEmpresa(
  siteOsm: string | null,
  email: string,
  emailProprio: boolean,
  provedores: Set<string>,
): Alvo | null {
  if (siteOsm) {
    try {
      const url = new URL(/^https?:\/\//i.test(siteOsm) ? siteOsm : `https://${siteOsm}`);
      return { host: url.hostname.toLowerCase(), origem: "osm" };
    } catch {
      return null;
    }
  }
  const dominio = dominioDoEmail(email);
  if (!dominio || !emailProprio || !dominio.includes(".") || ehProvedorGratuito(dominio, provedores)) return null;
  return { host: dominio, origem: "email" };
}

/**
 * O estado gravado só vale se foi medido no alvo atual da empresa. Se o e-mail mudou, ou se o
 * domínio passou a ser reconhecido como provedor gratuito, a verificação antiga não diz nada.
 */
export function estadoVigente(
  alvoAtual: Alvo | null,
  alvoVerificado: string | null,
  estado: EstadoVerificacao | null,
): EstadoVerificacao | null {
  return alvoAtual && alvoVerificado === alvoAtual.host ? estado : null;
}
