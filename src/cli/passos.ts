import { rmSync } from "node:fs";
import path from "node:path";
import { lerFontes, lerProvedoresEmail, lerRamos, pastaDados } from "../config";
import { abrirBanco } from "../db/banco";
import { enriquecer } from "../enriquecedor/osm";
import { baixarMes } from "../importador/baixar";
import { arquivosNecessarios, listarArquivos, listarMeses } from "../importador/fonte";
import { importarDePasta } from "../importador/importar";
import { pontuarTodas } from "../pontuador/pontuar";
import { internetFunciona, sondaReal, verificarPendentes } from "../verificador/verificar";
import { log } from "./comum";

export async function passoImportar(o: { cidade: string; uf: string; mes?: string; pasta?: string; manterZips: boolean }) {
  const db = abrirBanco();
  const { ramos } = lerRamos();
  let pasta = o.pasta;
  let mes = o.mes ?? "local";
  if (!pasta) {
    const base = lerFontes().receita.webdav;
    if (!o.mes) {
      const meses = await listarMeses(base);
      mes = meses.at(-1) ?? "";
      if (!mes) throw new Error("A Receita não listou nenhum mês. Confira config/fontes.json.");
    }
    const arquivos = arquivosNecessarios(await listarArquivos(base, mes));
    const total = arquivos.reduce((s, a) => s + a.tamanho, 0) / 1073741824;
    log(`Base da Receita de ${mes}: ${arquivos.length} arquivos, ${total.toFixed(1)} GB.`);
    pasta = path.join(pastaDados(), "zips", mes);
    await baixarMes(base, mes, arquivos, pasta, log);
  }
  const resumo = await importarDePasta({ db, pasta, cidade: o.cidade, uf: o.uf, mes, ramos, log });
  log(
    `${resumo.municipioNome}: ${resumo.ativosNoMunicipio} estabelecimentos ativos, ${resumo.noRamo} nos ramos aceitos, ` +
      `${resumo.gravadas} pequenas empresas gravadas.` +
      (resumo.linhasIgnoradas ? ` (${resumo.linhasIgnoradas} linhas malformadas ignoradas)` : ""),
  );
  if (!o.pasta && !o.manterZips) {
    rmSync(pasta, { recursive: true, force: true });
    log(`Zips apagados (use --manter-zips para guardar e importar outra cidade sem baixar de novo).`);
  }
  db.close();
}

export async function passoEnriquecer() {
  const db = abrirBanco();
  const fontes = lerFontes();
  try {
    await enriquecer(db, { url: fontes.overpass, userAgent: fontes.userAgent, log });
  } catch (erro) {
    // Opcional por desenho: o resto do fluxo funciona sem o OSM.
    log(`Enriquecimento pulado: ${(erro as Error).message}`);
  }
  db.close();
}

export async function passoVerificar() {
  if (!(await internetFunciona())) {
    throw new Error("Sem internet daqui. Não verifico nada para não acusar sites alheios por engano.");
  }
  const db = abrirBanco();
  const { limiteContador } = lerRamos();
  const contagem = await verificarPendentes(db, {
    provedores: lerProvedoresEmail(),
    limiteContador,
    sonda: sondaReal(lerFontes().userAgent),
    log,
  });
  log(`Verificação: ${Object.entries(contagem).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  db.close();
}

export async function passoPontuar() {
  const db = abrirBanco();
  const { ramos, limiteContador } = lerRamos();
  const n = pontuarTodas(db, { ramos, limiteContador, provedores: lerProvedoresEmail(), hoje: new Date() });
  log(`Nota calculada para ${n} empresas.`);
  db.close();
}
