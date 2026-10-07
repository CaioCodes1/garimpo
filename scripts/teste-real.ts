/**
 * Confere, contra os serviços de verdade, se as fontes externas ainda funcionam como o garimpo espera.
 * Não baixa a base (são ~7 GB): só lista, consulta e testa. Roda manualmente: npm run teste-real
 */
import { lerFontes } from "../src/config";
import { acharAreaMunicipio } from "../src/enriquecedor/osm";
import { arquivosNecessarios, listarArquivos, listarMeses } from "../src/importador/fonte";
import { internetFunciona, sondaReal, verificarAlvo } from "../src/verificador/verificar";

const fontes = lerFontes();
let falhou = false;

async function checar(nome: string, fn: () => Promise<string>) {
  try {
    console.log(`ok    ${nome}: ${await fn()}`);
  } catch (erro) {
    falhou = true;
    console.log(`FALHA ${nome}: ${(erro as Error).message}`);
  }
}

await checar("internet", async () => {
  if (!(await internetFunciona())) throw new Error("sem resposta do generate_204");
  return "funcionando";
});

await checar("Receita (WebDAV)", async () => {
  const meses = await listarMeses(fontes.receita.webdav);
  const mes = meses.at(-1);
  if (!mes) throw new Error("nenhum mês listado");
  const arquivos = arquivosNecessarios(await listarArquivos(fontes.receita.webdav, mes));
  const esperados = ["Municipios.zip", "Simples.zip", ...Array.from({ length: 10 }, (_, i) => `Estabelecimentos${i}.zip`), ...Array.from({ length: 10 }, (_, i) => `Empresas${i}.zip`)];
  const faltando = esperados.filter((e) => !arquivos.some((a) => a.nome === e));
  if (faltando.length) throw new Error(`mês ${mes} sem: ${faltando.join(", ")}`);
  const gb = arquivos.reduce((s, a) => s + a.tamanho, 0) / 1073741824;
  return `mês mais recente ${mes}, ${arquivos.length} arquivos, ${gb.toFixed(1)} GB`;
});

await checar("OpenStreetMap (Overpass)", async () => {
  const area = await acharAreaMunicipio(fontes.overpass, "SAO BERNARDO DO CAMPO", "SP", fontes.userAgent);
  if (area === null) throw new Error("não achou São Bernardo do Campo/SP");
  return `área ${area}`;
});

await checar("verificador (DNS + HTTPS)", async () => {
  const r = await verificarAlvo({ host: "example.com", origem: "email" }, sondaReal(fontes.userAgent));
  if (r !== "ok") throw new Error(`example.com deu ${r}`);
  return "example.com ok";
});

process.exit(falhou ? 1 : 0);
