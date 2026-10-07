import { createWriteStream, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import yazl from "yazl";

/** Monta uma linha no formato da Receita: todos os campos entre aspas, separados por ';'. */
export function linha(campos: string[]): string {
  return campos.map((c) => `"${c}"`).join(";");
}

export interface Estab {
  basico: string;
  ordem?: string;
  dv?: string;
  matriz?: "1" | "2";
  fantasia?: string;
  situacao?: string;
  inicio?: string;
  cnae: string;
  tipoLogradouro?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  uf?: string;
  municipio?: string;
  ddd1?: string;
  tel1?: string;
  ddd2?: string;
  tel2?: string;
  email?: string;
}

export function linhaEstab(e: Estab): string {
  const c = Array<string>(30).fill("");
  c[0] = e.basico;
  c[1] = e.ordem ?? "0001";
  c[2] = e.dv ?? "00";
  c[3] = e.matriz ?? "1";
  c[4] = e.fantasia ?? "";
  c[5] = e.situacao ?? "02";
  c[6] = "20200101";
  c[10] = e.inicio ?? "20260301";
  c[11] = e.cnae;
  c[13] = e.tipoLogradouro ?? "RUA";
  c[14] = e.logradouro ?? "MARECHAL DEODORO";
  c[15] = e.numero ?? "100";
  c[17] = e.bairro ?? "CENTRO";
  c[18] = "09710000";
  c[19] = e.uf ?? "SP";
  c[20] = e.municipio ?? "7075";
  c[21] = e.ddd1 ?? "";
  c[22] = e.tel1 ?? "";
  c[23] = e.ddd2 ?? "";
  c[24] = e.tel2 ?? "";
  c[27] = e.email ?? "";
  return linha(c);
}

export function linhaEmpresa(basico: string, razao: string, natureza: string, porte: string): string {
  return linha([basico, razao, natureza, "50", "1000,00", porte, ""]);
}

export function linhaSimples(basico: string, mei: boolean): string {
  return linha([basico, "S", "20260101", "00000000", mei ? "S" : "N", mei ? "20260101" : "00000000", "00000000"]);
}

/** Escreve um zip com um único CSV em latin1, como os da Receita. */
export function escreverZip(caminho: string, linhas: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from(linhas.join("\r\n") + "\r\n", "latin1"), "K3241.K03200Y0.D60912.CSV");
    zip.end();
    zip.outputStream.pipe(createWriteStream(caminho)).on("close", resolve).on("error", reject);
  });
}

export function pastaTemporaria(): string {
  return mkdtempSync(path.join(tmpdir(), "garimpo-teste-"));
}

export const MUNICIPIOS = [
  linha(["7075", "SAO BERNARDO DO CAMPO"]),
  linha(["7071", "SANTO ANDRE"]),
  linha(["0909", "SAO BERNARDO"]),
];
