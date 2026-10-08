import { acharRamo, type NomeModelo, type Ramo } from "../config";
import { alvoDaEmpresa, dominioDoEmail, ehProvedorGratuito, estadoVigente } from "../verificador/alvo";

export { dominioDoEmail } from "../verificador/alvo";

export type EstadoVerificacao = "ok" | "sem_https" | "sem_site" | "fora_do_ar" | "inconclusivo";

export interface EntradaNota {
  email: string;
  emailRepeticoes: number;
  telefone1: string;
  telefone1Repeticoes: number;
  telefone2: string;
  telefone2Repeticoes: number;
  dataAbertura: string | null;
  cnae: string;
  siteOsm: string | null;
  /** Domínio em que a verificação gravada foi feita; ela só vale se for o alvo atual. */
  alvoVerificado: string | null;
  estadoVerificacao: EstadoVerificacao | null;
}

export interface Motivo {
  tipo: "site" | "idade" | "ramo" | "contato";
  texto: string;
  pontos: number;
}

export interface ContextoNota {
  ramos: Ramo[];
  limiteContador: number;
  provedores: Set<string>;
  hoje: Date;
}

export interface ResultadoNota {
  nota: number;
  motivos: Motivo[];
  modelo: NomeModelo;
  /** Celular próprio (DDD + número), quando há: é o que vira link do WhatsApp. */
  celular: string | null;
  /** A verificação que valeu para a nota (null se não havia uma para o alvo atual). */
  estado: EstadoVerificacao | null;
  /** O domínio que representa o site da empresa, quando há. */
  alvo: string | null;
}

/**
 * Celular no formato atual (DDD + 9 dígitos), ou null se o número é fixo.
 * A Receita guarda no máximo 8 dígitos no número, então o 9 do celular (obrigatório desde 2016)
 * fica de fora: "11" + "66602592". Número de 8 dígitos começando com 6, 7, 8 ou 9 é celular
 * (fixo começa com 2, 3, 4 ou 5), e basta pôr o 9 na frente.
 */
export function celularNormalizado(telefone: string): string | null {
  if (telefone.length === 11 && telefone[2] === "9") return telefone;
  if (telefone.length === 10 && "6789".includes(telefone[2]!)) return `${telefone.slice(0, 2)}9${telefone.slice(2)}`;
  return null;
}

export function ehCelular(telefone: string): boolean {
  return celularNormalizado(telefone) !== null;
}

export function mesesDesde(dataIso: string, hoje: Date): number {
  const [a, m, d] = dataIso.split("-").map(Number) as [number, number, number];
  let meses = (hoje.getFullYear() - a) * 12 + (hoje.getMonth() + 1 - m);
  if (hoje.getDate() < d) meses--;
  return Math.max(0, meses);
}

/** "há 4 meses", "há 1 ano", "há menos de um mês". */
export function textoTempoAberta(meses: number): string {
  if (meses < 1) return "há menos de um mês";
  if (meses < 12) return meses === 1 ? "há 1 mês" : `há ${meses} meses`;
  const anos = Math.floor(meses / 12);
  return anos === 1 ? "há 1 ano" : `há ${anos} anos`;
}

function sinalDeSite(e: EntradaNota, estado: EstadoVerificacao | null, emailProprio: boolean, ctx: ContextoNota): Motivo {
  // 1. O verificador decide quando chegou a uma conclusão sobre o alvo atual.
  switch (estado) {
    case "ok":
      return { tipo: "site", texto: "já tem site funcionando", pontos: 0 };
    case "sem_site":
      return { tipo: "site", texto: "tem domínio, mas não tem site", pontos: 40 };
    case "sem_https":
      return { tipo: "site", texto: "site sem HTTPS (o navegador mostra \"não seguro\")", pontos: 30 };
    case "fora_do_ar":
      return { tipo: "site", texto: "site fora do ar", pontos: 30 };
    default:
      break;
  }
  // 2. Senão, vale a pista do e-mail.
  const dominio = dominioDoEmail(e.email);
  if (emailProprio && ehProvedorGratuito(dominio, ctx.provedores)) {
    return { tipo: "site", texto: `e-mail @${dominio}, provavelmente sem site`, pontos: 40 };
  }
  // 3. Senão, não dá para afirmar nada.
  return { tipo: "site", texto: "não dá para saber se tem site", pontos: 15 };
}

export function calcularNota(e: EntradaNota, ctx: ContextoNota): ResultadoNota {
  const motivos: Motivo[] = [];
  const proprio = (valor: string, repeticoes: number) => valor !== "" && repeticoes < ctx.limiteContador;
  const emailProprio = proprio(e.email, e.emailRepeticoes);
  const alvo = alvoDaEmpresa(e.siteOsm, e.email, emailProprio, ctx.provedores);
  const estado = estadoVigente(alvo, e.alvoVerificado, e.estadoVerificacao);

  const site = sinalDeSite(e, estado, emailProprio, ctx);
  motivos.push(site);

  const meses = e.dataAbertura ? mesesDesde(e.dataAbertura, ctx.hoje) : null;
  if (meses !== null) {
    const pontos = meses < 6 ? 30 : meses < 12 ? 20 : meses < 36 ? 10 : 0;
    if (pontos > 0) motivos.push({ tipo: "idade", texto: `aberta ${textoTempoAberta(meses)}`, pontos });
  }

  const ramo = acharRamo(e.cnae, ctx.ramos);
  if (ramo) motivos.push({ tipo: "ramo", texto: `ramo: ${ramo.rotulo.toLowerCase()}`, pontos: ramo.peso });

  const telefones = [
    { numero: e.telefone1, proprio: proprio(e.telefone1, e.telefone1Repeticoes) },
    { numero: e.telefone2, proprio: proprio(e.telefone2, e.telefone2Repeticoes) },
  ];
  const proprioCelular = telefones.find((t) => t.proprio && ehCelular(t.numero));
  const celular = proprioCelular ? celularNormalizado(proprioCelular.numero) : null;
  const temFixoProprio = telefones.some((t) => t.proprio && !ehCelular(t.numero));
  const temContador = telefones.some((t) => t.numero && !t.proprio) || (e.email !== "" && !emailProprio);
  if (celular) motivos.push({ tipo: "contato", texto: "dá para chamar no WhatsApp", pontos: 10 });
  else if (temFixoProprio) motivos.push({ tipo: "contato", texto: "só telefone fixo", pontos: 5 });
  if (temContador) motivos.push({ tipo: "contato", texto: "parte do contato é provavelmente do contador", pontos: 0 });

  const modelo: NomeModelo =
    estado === "sem_https" || estado === "fora_do_ar"
      ? "site-com-problema"
      : meses !== null && meses < 12
        ? "empresa-nova"
        : "sem-site";

  return {
    nota: Math.min(100, motivos.reduce((s, m) => s + m.pontos, 0)),
    motivos,
    modelo,
    celular,
    estado,
    alvo: alvo?.host ?? null,
  };
}
