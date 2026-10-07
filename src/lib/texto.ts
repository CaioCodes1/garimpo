/** Remove acentos (NFD + tira as marcas combinantes). */
export function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "");
}

/** Forma canônica para comparar nomes: sem acento, minúscula, só letras/dígitos e espaço simples. */
export function normalizar(texto: string): string {
  return semAcento(texto)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const SUFIXOS_JURIDICOS = new Set(["ltda", "me", "epp", "eireli", "mei", "sa", "s a", "slu", "ss"]);

/** Nome normalizado sem sufixo jurídico ("Padaria Doce Pão Ltda - ME" → "padaria doce pao"). */
export function normalizarNomeEmpresa(texto: string): string {
  const palavras = normalizar(texto).split(" ");
  while (palavras.length > 1 && SUFIXOS_JURIDICOS.has(palavras[palavras.length - 1]!)) palavras.pop();
  return palavras.join(" ");
}

const TIPOS_LOGRADOURO = new Set([
  "rua", "r", "avenida", "av", "travessa", "tv", "alameda", "al", "estrada", "est",
  "praca", "pc", "rodovia", "rod", "viela", "largo", "lg", "via", "passagem", "vila",
]);

/** Logradouro sem o tipo na frente ("Av. Kennedy" e "AVENIDA KENNEDY" → "kennedy"). */
export function normalizarLogradouro(texto: string): string {
  const palavras = normalizar(texto).split(" ").filter(Boolean);
  while (palavras.length > 1 && TIPOS_LOGRADOURO.has(palavras[0]!)) palavras.shift();
  return palavras.join(" ");
}

const MINUSCULAS = new Set(["de", "da", "do", "das", "dos", "e", "em", "a", "o"]);

/** "PADARIA DOCE PAO DE MEL" → "Padaria Doce Pao de Mel". */
export function tituloCaso(texto: string): string {
  return texto
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ");
}

/**
 * Nome para exibir quando não há nome fantasia.
 * A razão social de MEI começa com o CNPJ básico ("12.345.678 MARIA DA SILVA");
 * o sufixo jurídico também sai.
 */
export function limparRazaoSocial(razao: string): string {
  const semCnpj = razao.replace(/^[\d.\s/-]+/, "").trim();
  const semSufixo = semCnpj.replace(/[\s-]+(LTDA|ME|EPP|EIRELI|S\/?A|SLU)\.?$/i, "").trim();
  return tituloCaso(semSufixo || razao);
}

export function primeiraMinuscula(texto: string): string {
  return texto.charAt(0).toLowerCase() + texto.slice(1);
}
