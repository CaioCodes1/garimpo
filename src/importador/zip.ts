import type { Readable } from "node:stream";
import yauzl from "yauzl";

/**
 * Abre a primeira entrada de um zip da Receita como fluxo, sem descompactar no disco.
 * Cada zip dos dados abertos tem exatamente um CSV dentro.
 */
export function abrirPrimeiraEntrada(caminhoZip: string): Promise<Readable> {
  return new Promise((resolve, reject) => {
    yauzl.open(caminhoZip, { lazyEntries: true, autoClose: true }, (erro, zip) => {
      if (erro || !zip) return reject(erro ?? new Error(`não abriu ${caminhoZip}`));
      zip.once("entry", (entrada: yauzl.Entry) => {
        zip.openReadStream(entrada, (erroLeitura, fluxo) => {
          if (erroLeitura || !fluxo) return reject(erroLeitura ?? new Error(`entrada vazia em ${caminhoZip}`));
          resolve(fluxo);
        });
      });
      zip.once("end", () => reject(new Error(`${caminhoZip} não tem nenhum arquivo dentro`)));
      zip.once("error", reject);
      zip.readEntry();
    });
  });
}
