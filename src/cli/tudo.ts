import { argumentos, executar, exigirCidade, log } from "./comum";
import { passoEnriquecer, passoImportar, passoPontuar, passoVerificar } from "./passos";

const a = argumentos();
const cidade = exigirCidade(a);
await executar(async () => {
  await passoImportar({ ...cidade, mes: a.mes, pasta: a.pasta, manterZips: a["manter-zips"] ?? false });
  await passoEnriquecer();
  await passoVerificar();
  await passoPontuar();
  log("Pronto. Abra o painel com: npm run build && npm start  (ou npm run dev)");
});
