import { acharRamo, type Ramo } from "../config";
import { bairroExibicao, limparRazaoSocial, removerSufixoJuridico, tituloCaso } from "../lib/texto";
import { mesesDesde, textoTempoAberta } from "./nota";

const PORTES: Record<string, string> = { mei: "MEI", me: "microempresa", epp: "pequeno porte" };
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Nome fantasia; se vazio (ou só asteriscos, que a Receita usa), a razão social limpa. */
export function nomeExibicao(nomeFantasia: string, razaoSocial: string): string {
  return /\p{L}/u.test(nomeFantasia) ? tituloCaso(removerSufixoJuridico(nomeFantasia)) : limparRazaoSocial(razaoSocial);
}

/** "Salão de beleza · microempresa · Rudge Ramos" */
export function descricaoBreve(cnae: string, porte: string, bairro: string, ramos: Ramo[]): string {
  const partes = [acharRamo(cnae, ramos)?.rotulo ?? `CNAE ${cnae}`, PORTES[porte] ?? porte];
  if (bairro.trim()) partes.push(bairroExibicao(bairro));
  return partes.join(" · ");
}

/** "Aberta há 4 meses (jun/2026)" */
export function linhaTempoAberta(dataAbertura: string | null, hoje: Date): string {
  if (!dataAbertura) return "Data de abertura desconhecida";
  const [ano, mes] = dataAbertura.split("-");
  const texto = textoTempoAberta(mesesDesde(dataAbertura, hoje));
  return `Aberta ${texto} (${MESES[Number(mes) - 1]}/${ano})`;
}
