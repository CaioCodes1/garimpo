import { acharRamo, type NomeModelo, type Ramo } from "../config";

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
}

/** Celular = 9 dígitos depois do DDD, começando com 9. */
export function ehCelular(telefone: string): boolean {
  const numero = telefone.slice(2);
  return telefone.length === 11 && numero.length === 9 && numero.startsWith("9");
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

export function dominioDoEmail(email: string): string {
  return email.split("@")[1]?.trim().toLowerCase() ?? "";
}

function sinalDeSite(e: EntradaNota, emailProprio: boolean, ctx: ContextoNota): Motivo {
  // 1. O verificador decide quando chegou a uma conclusão.
  switch (e.estadoVerificacao) {
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
  if (emailProprio && ctx.provedores.has(dominio)) {
    return { tipo: "site", texto: `e-mail @${dominio}, provavelmente sem site`, pontos: 40 };
  }
  // 3. Senão, não dá para afirmar nada.
  return { tipo: "site", texto: "não dá para saber se tem site", pontos: 15 };
}

export function calcularNota(e: EntradaNota, ctx: ContextoNota): ResultadoNota {
  const motivos: Motivo[] = [];
  const proprio = (valor: string, repeticoes: number) => valor !== "" && repeticoes < ctx.limiteContador;
  const emailProprio = proprio(e.email, e.emailRepeticoes);

  const site = sinalDeSite(e, emailProprio, ctx);
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
  const celular = telefones.find((t) => t.proprio && ehCelular(t.numero))?.numero ?? null;
  const temFixoProprio = telefones.some((t) => t.proprio && !ehCelular(t.numero));
  const temContador = telefones.some((t) => t.numero && !t.proprio) || (e.email !== "" && !emailProprio);
  if (celular) motivos.push({ tipo: "contato", texto: "dá para chamar no WhatsApp", pontos: 10 });
  else if (temFixoProprio) motivos.push({ tipo: "contato", texto: "só telefone fixo", pontos: 5 });
  if (temContador) motivos.push({ tipo: "contato", texto: "parte do contato é provavelmente do contador", pontos: 0 });

  const modelo: NomeModelo =
    e.estadoVerificacao === "sem_https" || e.estadoVerificacao === "fora_do_ar"
      ? "site-com-problema"
      : meses !== null && meses < 12
        ? "empresa-nova"
        : "sem-site";

  return { nota: Math.min(100, motivos.reduce((s, m) => s + m.pontos, 0)), motivos, modelo, celular };
}
