import "server-only";
import { acharRamo, lerFaixasIdade, lerModelos, lerPerfil, lerProvedoresEmail, lerRamos } from "../config";
import type { Lead } from "../consultas/painel";
import { abrirBanco, type Banco } from "../db/banco";
import { gerarMensagem, linkPesquisaGoogle, linkWhatsApp } from "../mensagens/mensagens";
import { descricaoBreve, linhaTempoAberta, nomeExibicao } from "../pontuador/descricao";
import { calcularNota, celularNormalizado, mesesDesde, textoTempoAberta, type EstadoVerificacao, type Motivo } from "../pontuador/nota";

let banco: Banco | undefined;

/** Uma conexão por processo do Next. */
export function obterBanco(): Banco {
  banco ??= abrirBanco();
  return banco;
}

export function formatarTelefone(bruto: string): string {
  const t = celularNormalizado(bruto) ?? bruto;
  if (t.length === 11) return `(${t.slice(0, 2)}) ${t.slice(2, 7)}-${t.slice(7)}`;
  if (t.length === 10) return `(${t.slice(0, 2)}) ${t.slice(2, 6)}-${t.slice(6)}`;
  return t;
}

export interface Cartao {
  cnpj: string;
  nome: string;
  nota: number;
  descricao: string;
  tempo: string;
  endereco: string;
  motivos: Motivo[];
  contatos: { rotulo: string; valor: string; doContador: boolean }[];
  mensagem: string;
  whatsapp: string | null;
  google: string;
  status: Lead["status"];
  anotacoes: string;
  contatadoEm: string | null;
}

export function montarCartoes(leads: Lead[], hoje = new Date()): { cartoes: Cartao[]; perfilDeExemplo: boolean } {
  const { ramos, limiteContador } = lerRamos();
  const provedores = lerProvedoresEmail();
  const modelos = lerModelos();
  const { perfil, exemplo } = lerPerfil();
  const ctx = { ramos, faixasIdade: lerFaixasIdade(), limiteContador, provedores, hoje };

  const cartoes = leads.map((l): Cartao => {
    const nome = nomeExibicao(l.nome_fantasia, l.razao_social);
    // Recalcula na hora para ter o celular escolhido; a nota gravada é a mesma conta.
    const r = calcularNota(
      {
        email: l.email,
        emailRepeticoes: l.email_repeticoes,
        telefone1: l.telefone1,
        telefone1Repeticoes: l.telefone1_repeticoes,
        telefone2: l.telefone2,
        telefone2Repeticoes: l.telefone2_repeticoes,
        dataAbertura: l.data_abertura,
        cnae: l.cnae,
        siteOsm: l.site_osm,
        alvoVerificado: l.alvo,
        estadoVerificacao: l.estado as EstadoVerificacao | null,
      },
      ctx,
    );
    // MEI sem nome fantasia tem o nome da pessoa como razão social: a mensagem fala "seu negócio".
    const temNomeFantasia = /\p{L}/u.test(l.nome_fantasia);
    const mensagem = gerarMensagem(modelos, r.modelo, {
      nome: temNomeFantasia ? nome : "seu negócio",
      ramoRotulo: acharRamo(l.cnae, ramos)?.rotulo ?? "negócios como o seu",
      bairro: l.bairro,
      municipio: l.municipio_nome,
      tempoAberta: l.data_abertura ? textoTempoAberta(mesesDesde(l.data_abertura, hoje)) : "recentemente",
      site: r.alvo ?? "",
      estadoVerificacao: r.estado,
    }, perfil);

    const contatos: Cartao["contatos"] = [];
    const telefones = [
      [l.telefone1, l.telefone1_repeticoes],
      [l.telefone2, l.telefone2_repeticoes],
    ] as const;
    for (const [t, rep] of telefones) {
      if (t && !contatos.some((c) => c.valor === formatarTelefone(t))) {
        contatos.push({ rotulo: "Telefone", valor: formatarTelefone(t), doContador: rep >= limiteContador });
      }
    }
    if (l.email) contatos.push({ rotulo: "E-mail", valor: l.email, doContador: l.email_repeticoes >= limiteContador });
    if (l.site_osm) contatos.push({ rotulo: "Site (OSM)", valor: l.site_osm, doContador: false });

    return {
      cnpj: l.cnpj,
      nome,
      nota: l.nota,
      descricao: descricaoBreve(l.cnae, l.porte, l.bairro, ramos),
      tempo: linhaTempoAberta(l.data_abertura, hoje),
      endereco: [l.logradouro, l.numero].filter(Boolean).join(", "),
      motivos: r.motivos,
      contatos,
      mensagem,
      whatsapp: r.celular ? linkWhatsApp(r.celular, mensagem) : null,
      google: linkPesquisaGoogle(nome, l.municipio_nome),
      status: l.status,
      anotacoes: l.anotacoes,
      contatadoEm: l.contatado_em,
    };
  });
  return { cartoes, perfilDeExemplo: exemplo };
}
