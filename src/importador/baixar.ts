import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ArquivoRemoto } from "./fonte";

type Fetch = typeof fetch;

/**
 * Baixa um arquivo com retomada: se já existe pela metade, pede só o que falta (HTTP Range).
 * Se já está completo (mesmo tamanho do servidor), não faz nada.
 */
export async function baixarArquivo(
  url: string,
  destino: string,
  tamanhoEsperado: number,
  f: Fetch = fetch,
  tentativas = 5,
): Promise<"ja_existia" | "baixado"> {
  mkdirSync(path.dirname(destino), { recursive: true });
  for (let tentativa = 1; ; tentativa++) {
    const atual = existsSync(destino) ? statSync(destino).size : 0;
    if (atual === tamanhoEsperado) return tentativa === 1 ? "ja_existia" : "baixado";
    // Maior do que o servidor diz: arquivo de outro mês ou corrompido. Recomeça do zero.
    const inicio = atual > tamanhoEsperado ? 0 : atual;
    try {
      const resposta = await f(url, { headers: inicio > 0 ? { Range: `bytes=${inicio}-` } : {} });
      if (!resposta.ok || !resposta.body) throw new Error(`HTTP ${resposta.status}`);
      // Se pedimos um pedaço e o servidor mandou o arquivo inteiro (200), sobrescreve.
      const anexar = inicio > 0 && resposta.status === 206;
      await pipeline(
        Readable.fromWeb(resposta.body as import("node:stream/web").ReadableStream),
        createWriteStream(destino, { flags: anexar ? "a" : "w" }),
      );
    } catch (erro) {
      if (tentativa >= tentativas) {
        throw new Error(`Falhou ao baixar ${url} depois de ${tentativas} tentativas: ${(erro as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 2 ** tentativa * 1000));
    }
  }
}

export async function baixarMes(
  base: string,
  mes: string,
  arquivos: ArquivoRemoto[],
  pasta: string,
  log: (msg: string) => void,
  f: Fetch = fetch,
): Promise<void> {
  for (const [i, arquivo] of arquivos.entries()) {
    const resultado = await baixarArquivo(`${base}/${mes}/${arquivo.nome}`, path.join(pasta, arquivo.nome), arquivo.tamanho, f);
    const mb = (arquivo.tamanho / 1048576).toFixed(0);
    log(`[${i + 1}/${arquivos.length}] ${arquivo.nome} (${mb} MB) ${resultado === "ja_existia" ? "já estava baixado" : "baixado"}`);
  }
}
