import { parseArgs } from "node:util";

export function log(msg: string): void {
  const hora = new Date().toLocaleTimeString("pt-BR");
  console.log(`[${hora}] ${msg}`);
}

export function argumentos() {
  const { values } = parseArgs({
    options: {
      cidade: { type: "string" },
      uf: { type: "string" },
      mes: { type: "string" },
      pasta: { type: "string" },
      "manter-zips": { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  return values;
}

export function exigirCidade(a: ReturnType<typeof argumentos>): { cidade: string; uf: string } {
  if (!a.cidade || !a.uf || !/^[A-Za-z]{2}$/.test(a.uf)) {
    console.error('Uso: npm run importar -- --cidade "São Bernardo do Campo" --uf SP [--mes 2026-09] [--manter-zips]');
    process.exit(2);
  }
  return { cidade: a.cidade, uf: a.uf.toUpperCase() };
}

/** Roda o passo e transforma erro em mensagem legível + código de saída 1. */
export async function executar(passo: () => Promise<void>): Promise<void> {
  try {
    await passo();
  } catch (erro) {
    console.error(`\nErro: ${(erro as Error).message}`);
    process.exit(1);
  }
}
