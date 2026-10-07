import type { Readable } from "node:stream";

/**
 * Lê um fluxo de bytes latin1 e devolve uma linha por vez (sem o \r\n).
 * Latin1 é um byte por caractere, então decodificar pedaço a pedaço é seguro.
 */
export async function* linhas(fluxo: Readable): AsyncGenerator<string> {
  const decoder = new TextDecoder("latin1");
  let resto = "";
  for await (const pedaco of fluxo) {
    resto += decoder.decode(pedaco as Uint8Array, { stream: true });
    let inicio = 0;
    let fim: number;
    while ((fim = resto.indexOf("\n", inicio)) !== -1) {
      const linha = resto.charCodeAt(fim - 1) === 13 ? resto.slice(inicio, fim - 1) : resto.slice(inicio, fim);
      if (linha.length > 0) yield linha;
      inicio = fim + 1;
    }
    resto = resto.slice(inicio);
  }
  resto += decoder.decode();
  if (resto.length > 0) yield resto.endsWith("\r") ? resto.slice(0, -1) : resto;
}

/**
 * Separa uma linha no formato da Receita: todos os campos entre aspas, separados por ';'
 * ("a";"b";"").  Aspas soltas dentro do texto acontecem e não quebram a separação, porque
 * o separador real é a sequência `";"`.
 */
export function separarCampos(linha: string): string[] {
  if (linha.startsWith('"') && linha.endsWith('"')) {
    return linha.slice(1, -1).split('";"');
  }
  return linha.split(";").map((campo) => campo.replace(/^"|"$/g, ""));
}

/** Índices das colunas usadas, conforme o layout dos dados abertos (inalterado desde 2021). */
export const COL_ESTAB = {
  cnpjBasico: 0,
  cnpjOrdem: 1,
  cnpjDv: 2,
  matrizFilial: 3,
  nomeFantasia: 4,
  situacao: 5,
  dataInicio: 10,
  cnaePrincipal: 11,
  tipoLogradouro: 13,
  logradouro: 14,
  numero: 15,
  complemento: 16,
  bairro: 17,
  cep: 18,
  uf: 19,
  municipio: 20,
  ddd1: 21,
  telefone1: 22,
  ddd2: 23,
  telefone2: 24,
  email: 27,
  total: 30,
} as const;

export const COL_EMPRESA = { cnpjBasico: 0, razaoSocial: 1, natureza: 2, porte: 5, total: 7 } as const;

export const COL_SIMPLES = { cnpjBasico: 0, opcaoMei: 4, total: 7 } as const;
