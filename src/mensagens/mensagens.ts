import type { NomeModelo, Perfil } from "../config";
import { bairroExibicao, primeiraMinuscula, tituloCaso } from "../lib/texto";

export const LINHA_DE_SAIDA = "Se não fizer sentido agora, é só me avisar que não mando mais.";

export interface DadosMensagem {
  nome: string;
  ramoRotulo: string;
  bairro: string;
  municipio: string;
  tempoAberta: string;
  /** Endereço testado pelo verificador; só usado no modelo de site com problema. */
  site: string;
  estadoVerificacao: string | null;
}

const PROBLEMAS: Record<string, string> = {
  sem_https: 'ele aparece como "não seguro" no navegador',
  fora_do_ar: "ele não abriu",
};

export function variaveis(d: DadosMensagem, perfil: Perfil): Record<string, string> {
  return {
    nome: d.nome,
    ramo: primeiraMinuscula(d.ramoRotulo),
    onde: d.bairro.trim() ? `no bairro ${bairroExibicao(d.bairro)}` : `em ${tituloCaso(d.municipio)}`,
    tempo_aberta: d.tempoAberta,
    site: d.site,
    problema: PROBLEMAS[d.estadoVerificacao ?? ""] ?? "ele não abriu",
    seu_nome: perfil.nome,
    sua_profissao: perfil.profissao,
    sua_cidade: perfil.cidade,
    seu_portfolio: perfil.portfolio,
  };
}

/** Troca {variavel} pelo valor. Variável desconhecida fica como está, para aparecer no teste. */
export function preencher(modelo: string, valores: Record<string, string>): string {
  return modelo.replace(/\{(\w+)\}/g, (inteiro, chave: string) => valores[chave] ?? inteiro);
}

export function gerarMensagem(
  modelos: Record<NomeModelo, string>,
  modelo: NomeModelo,
  dados: DadosMensagem,
  perfil: Perfil,
): string {
  return preencher(modelos[modelo], variaveis(dados, perfil));
}

/** Abre o WhatsApp com o texto pronto. Quem aperta enviar é a pessoa. */
export function linkWhatsApp(celular: string, texto: string): string {
  return `https://wa.me/55${celular}?text=${encodeURIComponent(texto)}`;
}

export function linkPesquisaGoogle(nome: string, municipio: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${nome} ${tituloCaso(municipio)}`)}`;
}
