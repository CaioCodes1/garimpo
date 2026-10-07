import { argumentos, executar, exigirCidade } from "./comum";
import { passoImportar } from "./passos";

const a = argumentos();
await executar(() => passoImportar({ ...exigirCidade(a), mes: a.mes, pasta: a.pasta, manterZips: a["manter-zips"] ?? false }));
