import { acharRamo, type Ramo } from "../config";

export type Porte = "mei" | "me" | "epp";

const SITUACAO_ATIVA = "02";

/** Regras 1 e 2: estabelecimento ativo do município (código da Receita + UF). */
export function ativoNoMunicipio(municipio: string, uf: string, situacao: string, codigos: Set<string>, ufAlvo: string): boolean {
  return codigos.has(municipio) && uf === ufAlvo && situacao === SITUACAO_ATIVA;
}

/** Regra 5: CNAE principal está na lista de ramos. Devolve o ramo, ou undefined se não está. */
export function ramoAceito(cnae: string, ramos: Ramo[]): Ramo | undefined {
  return acharRamo(cnae, ramos);
}

/**
 * Regras 3 e 4: porte pequeno e natureza jurídica empresarial.
 * Porte é da empresa inteira (CNPJ básico), então filial de empresa grande já cai aqui.
 */
export function porteElegivel(natureza: string, porte: string, mei: boolean): Porte | undefined {
  if (!natureza.startsWith("2")) return undefined;
  if (mei) return "mei";
  if (porte === "01") return "me";
  if (porte === "03") return "epp";
  return undefined;
}
