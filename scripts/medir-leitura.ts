// Mede a velocidade do leitor num zip real: npx tsx scripts/medir-leitura.ts <zip> <codigoMunicipio>
import { linhas } from "../src/importador/csv-receita";
import { abrirPrimeiraEntrada } from "../src/importador/zip";

const [zip, codigo = "7075"] = process.argv.slice(2);
if (!zip) throw new Error("uso: medir-leitura <zip> [codigo]");
const marca = `"${codigo}"`;
const inicio = performance.now();
let total = 0;
let doMunicipio = 0;
for await (const linha of linhas(await abrirPrimeiraEntrada(zip))) {
  total++;
  if (linha.includes(marca)) doMunicipio++;
}
const s = (performance.now() - inicio) / 1000;
console.log(`${total.toLocaleString("pt-BR")} linhas em ${s.toFixed(1)} s (${Math.round(total / s).toLocaleString("pt-BR")}/s); ${doMunicipio} contêm ${marca}`);
