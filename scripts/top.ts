// Lista as N primeiras empresas do painel, em texto: npx tsx scripts/top.ts [N]
import { lerRamos } from "../src/config";
import { listarLeads } from "../src/consultas/painel";
import { abrirBanco } from "../src/db/banco";
import { descricaoBreve, linhaTempoAberta, nomeExibicao } from "../src/pontuador/descricao";

const n = Number(process.argv[2] ?? 20);
const db = abrirBanco();
const { ramos } = lerRamos();
const { leads } = listarLeads(db, {}, 1, n);
leads.forEach((l, i) => {
  const motivos = (JSON.parse(l.motivos) as { tipo: string; texto: string }[]).filter((m) => m.tipo === "site").map((m) => m.texto);
  console.log(
    `${String(i + 1).padStart(2)}. ${nomeExibicao(l.nome_fantasia, l.razao_social)} | ${descricaoBreve(l.cnae, l.porte, l.bairro, ramos)} | ` +
      `${linhaTempoAberta(l.data_abertura, new Date()).replace("Aberta ", "")} | ${l.nota} | ${motivos.join("; ")}`,
  );
});
