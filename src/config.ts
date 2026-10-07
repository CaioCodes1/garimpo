import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface Ramo {
  prefixo: string;
  rotulo: string;
  peso: number;
}

export interface ConfigRamos {
  limiteContador: number;
  ramos: Ramo[];
}

export interface Fontes {
  receita: { webdav: string };
  overpass: string;
  userAgent: string;
}

export interface Perfil {
  nome: string;
  profissao: string;
  cidade: string;
  portfolio: string;
}

export type NomeModelo = "empresa-nova" | "sem-site" | "site-com-problema";

function raiz(): string {
  return process.env.GARIMPO_RAIZ ?? process.cwd();
}

let envCarregado = false;
/** Lê o .env da raiz uma vez (o Next já faz isso sozinho; os comandos de terminal não). */
function carregarEnv(): void {
  if (envCarregado) return;
  envCarregado = true;
  const arquivo = path.join(/*turbopackIgnore: true*/ raiz(), ".env");
  if (existsSync(arquivo)) process.loadEnvFile(arquivo);
}

function lerJson<T>(...partes: string[]): T {
  const arquivo = path.join(/*turbopackIgnore: true*/ raiz(), ...partes);
  return JSON.parse(readFileSync(arquivo, "utf8")) as T;
}

/** Pasta dos dados baixados e do banco. Na máquina do autor fica no D:, via GARIMPO_DADOS. */
export function pastaDados(): string {
  carregarEnv();
  return path.resolve(/*turbopackIgnore: true*/ process.env.GARIMPO_DADOS ?? path.join(raiz(), "dados"));
}

export function lerRamos(): ConfigRamos {
  return lerJson<ConfigRamos>("config", "ramos.json");
}

export function lerFontes(): Fontes {
  return lerJson<Fontes>("config", "fontes.json");
}

export function lerProvedoresEmail(): Set<string> {
  return new Set(lerJson<string[]>("config", "provedores-email.json"));
}

/** perfil.json fica fora do git; sem ele, usa o exemplo e o painel avisa. */
export function lerPerfil(): { perfil: Perfil; exemplo: boolean } {
  const real = path.join(/*turbopackIgnore: true*/ raiz(), "config", "perfil.json");
  if (existsSync(real)) return { perfil: lerJson<Perfil>("config", "perfil.json"), exemplo: false };
  return { perfil: lerJson<Perfil>("config", "perfil.exemplo.json"), exemplo: true };
}

export function lerModelos(): Record<NomeModelo, string> {
  const ler = (nome: NomeModelo) =>
    readFileSync(path.join(/*turbopackIgnore: true*/ raiz(), "config", "modelos", `${nome}.md`), "utf8").trim();
  return {
    "empresa-nova": ler("empresa-nova"),
    "sem-site": ler("sem-site"),
    "site-com-problema": ler("site-com-problema"),
  };
}

/** O ramo do prefixo mais longo que casa com o CNAE, ou undefined se o CNAE não é aceito. */
export function acharRamo(cnae: string, ramos: Ramo[]): Ramo | undefined {
  let melhor: Ramo | undefined;
  for (const ramo of ramos) {
    if (cnae.startsWith(ramo.prefixo) && (!melhor || ramo.prefixo.length > melhor.prefixo.length)) {
      melhor = ramo;
    }
  }
  return melhor;
}
