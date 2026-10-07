import Link from "next/link";
import { lerRamos } from "../config";
import { bairros, contagemFunil, listarLeads, resumoBase, ROTULO_STATUS, STATUS, type Filtros, type Status } from "../consultas/painel";
import { tituloCaso } from "../lib/texto";
import { montarCartoes, obterBanco, type Cartao } from "../lib/servidor";
import { acaoSalvarAnotacoes } from "./acoes";
import { BotaoCopiar, SeletorStatus } from "./componentes/interativos";

export const dynamic = "force-dynamic";

const POR_PAGINA = 30;
type Parametros = Record<string, string | string[] | undefined>;

function lerFiltros(p: Parametros): Filtros {
  const texto = (k: string) => (typeof p[k] === "string" && p[k] ? (p[k] as string) : undefined);
  const numero = (k: string) => (texto(k) && Number.isFinite(Number(texto(k))) ? Number(texto(k)) : undefined);
  const status = texto("status");
  return {
    bairro: texto("bairro"),
    ramo: texto("ramo"),
    notaMin: numero("nota"),
    meses: numero("meses"),
    status: STATUS.includes(status as Status) ? (status as Status) : undefined,
    busca: texto("busca"),
  };
}

function urlCom(p: Parametros, mudancas: Record<string, string | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...p, ...mudancas })) if (typeof v === "string" && v) u.set(k, v);
  const q = u.toString();
  return q ? `/?${q}` : "/";
}

export default async function Pagina({ searchParams }: { searchParams: Promise<Parametros> }) {
  const p = await searchParams;
  const db = obterBanco();
  const base = resumoBase(db);

  if (base.municipios.length === 0) return <SemDados />;

  const filtros = lerFiltros(p);
  const pagina = Math.max(1, Number(p.pagina) || 1);
  const { total, leads } = listarLeads(db, filtros, pagina, POR_PAGINA);
  const { cartoes, perfilDeExemplo } = montarCartoes(leads);
  const funil = contagemFunil(db);
  const ramos = lerRamos().ramos;
  const paginas = Math.ceil(total / POR_PAGINA);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            garimpo<span className="text-ouro">.</span>
          </h1>
          <p className="text-suave">
            {base.municipios.map(tituloCaso).join(", ")} · base da Receita de {base.ultimaImportacao ?? "?"}
          </p>
        </div>
        <ul className="flex flex-wrap gap-2 text-sm">
          {STATUS.filter((s) => s !== "nao_contatar").map((s) => (
            <li key={s}>
              <Link
                href={urlCom({}, { status: s })}
                className="block rounded-full border border-borda bg-superficie px-3 py-1 hover:border-ouro"
              >
                {ROTULO_STATUS[s]} <strong>{funil[s]}</strong>
              </Link>
            </li>
          ))}
        </ul>
      </header>

      {perfilDeExemplo && (
        <p className="mb-4 rounded-lg bg-alerta-fundo px-4 py-3 text-sm text-alerta">
          As mensagens estão usando o perfil de exemplo. Copie <code>config/perfil.exemplo.json</code> para{" "}
          <code>config/perfil.json</code> e coloque seu nome, cidade e portfólio.
        </p>
      )}

      <form className="mb-6 grid grid-cols-2 gap-3 rounded-xl border border-borda bg-superficie p-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <Campo rotulo="Buscar nome">
          <input name="busca" defaultValue={filtros.busca} placeholder="padaria…" />
        </Campo>
        <Campo rotulo="Bairro">
          <select name="bairro" defaultValue={filtros.bairro ?? ""}>
            <option value="">Todos</option>
            {bairros(db).map((b) => (
              <option key={b.bairro} value={b.bairro}>
                {tituloCaso(b.bairro)} ({b.n})
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Ramo">
          <select name="ramo" defaultValue={filtros.ramo ?? ""}>
            <option value="">Todos</option>
            {[...ramos].sort((a, b) => a.rotulo.localeCompare(b.rotulo)).map((r) => (
              <option key={r.prefixo} value={r.prefixo}>
                {r.rotulo}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Nota mínima">
          <select name="nota" defaultValue={String(filtros.notaMin ?? "")}>
            <option value="">Qualquer</option>
            {[50, 60, 70, 80, 90].map((n) => (
              <option key={n} value={n}>
                {n}+
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Aberta nos últimos">
          <select name="meses" defaultValue={String(filtros.meses ?? "")}>
            <option value="">Qualquer data</option>
            {[3, 6, 12, 24].map((m) => (
              <option key={m} value={m}>
                {m} meses
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Status">
          <select name="status" defaultValue={filtros.status ?? ""}>
            <option value="">Todos (menos não contatar)</option>
            {STATUS.map((s) => (
              <option key={s} value={s}>
                {ROTULO_STATUS[s]}
              </option>
            ))}
          </select>
        </Campo>
        <div className="col-span-full flex gap-3">
          <button className="rounded-lg bg-texto px-4 py-2 font-semibold text-superficie">Filtrar</button>
          <Link href="/" className="px-2 py-2 text-suave underline">
            Limpar
          </Link>
        </div>
      </form>

      <p className="mb-3 text-sm text-suave">
        {total.toLocaleString("pt-BR")} empresas · página {Math.min(pagina, Math.max(paginas, 1))} de {Math.max(paginas, 1)}
      </p>

      <ol className="space-y-4">
        {cartoes.map((c) => (
          <li key={c.cnpj}>
            <CartaoLead c={c} />
          </li>
        ))}
      </ol>

      {cartoes.length === 0 && <p className="py-12 text-center text-suave">Nenhuma empresa com esses filtros.</p>}

      {paginas > 1 && (
        <nav className="mt-6 flex justify-between text-sm">
          {pagina > 1 ? <Link className="underline" href={urlCom(p, { pagina: String(pagina - 1) })}>← Anterior</Link> : <span />}
          {pagina < paginas && <Link className="underline" href={urlCom(p, { pagina: String(pagina + 1) })}>Próxima →</Link>}
        </nav>
      )}
    </main>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-suave">{rotulo}</span>
      {children}
    </label>
  );
}

function CartaoLead({ c }: { c: Cartao }) {
  const corNota = c.nota >= 80 ? "bg-ouro text-superficie" : c.nota >= 60 ? "bg-ouro-fundo text-ouro" : "bg-borda text-suave";
  return (
    <article className="rounded-xl border border-borda bg-superficie p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{c.nome}</h2>
          <p className="text-sm text-suave">{c.descricao}</p>
          <p className="text-sm font-medium">{c.tempo}</p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-bold ${corNota}`} title="Nota de oportunidade (0–100)">
          {c.nota}
        </span>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-suave uppercase">Por que é oportunidade</h3>
          <ul className="space-y-0.5 text-sm">
            {c.motivos.map((m) => (
              <li key={m.texto} className={m.pontos === 0 ? "text-suave" : ""}>
                {m.pontos > 0 ? <span className="mr-1 text-verde">+{m.pontos}</span> : <span className="mr-1">·</span>}
                {m.texto}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-suave uppercase">Contato</h3>
          <ul className="space-y-0.5 text-sm">
            {c.contatos.map((ct) => (
              <li key={ct.rotulo + ct.valor} className="break-all">
                <span className="text-suave">{ct.rotulo}:</span> {ct.valor}
                {ct.doContador && <span className="ml-1 rounded bg-alerta-fundo px-1 text-xs text-alerta">provável contador</span>}
              </li>
            ))}
            {c.endereco && (
              <li>
                <span className="text-suave">Endereço:</span> {tituloCaso(c.endereco)}
              </li>
            )}
            {c.contatos.length === 0 && <li className="text-suave">Sem contato no cadastro.</li>}
          </ul>
        </div>
      </div>

      <details className="mt-4 rounded-lg bg-fundo p-3 text-sm">
        <summary className="cursor-pointer font-medium">Mensagem pronta</summary>
        <p className="mt-2 whitespace-pre-line">{c.mensagem}</p>
      </details>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <BotaoCopiar texto={c.mensagem} />
        {c.whatsapp && (
          <a href={c.whatsapp} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-verde px-3 py-2 text-sm font-semibold text-superficie hover:opacity-90">
            Abrir no WhatsApp
          </a>
        )}
        <a href={c.google} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-borda px-3 py-2 text-sm hover:border-ouro">
          Pesquisar no Google
        </a>
        <div className="ml-auto">
          <SeletorStatus cnpj={c.cnpj} status={c.status} />
        </div>
      </div>

      <form action={acaoSalvarAnotacoes} className="mt-3 flex gap-2 text-sm">
        <input type="hidden" name="cnpj" value={c.cnpj} />
        <input name="anotacoes" defaultValue={c.anotacoes} placeholder="Anotações (ex.: falou com a dona, retornar dia 15)" className="flex-1" aria-label="Anotações" />
        <button className="rounded-lg border border-borda px-3">Salvar</button>
      </form>
      {c.contatadoEm && <p className="mt-2 text-xs text-suave">Primeiro contato em {new Date(c.contatadoEm).toLocaleDateString("pt-BR")}</p>}
    </article>
  );
}

function SemDados() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="mb-4 text-3xl font-bold">
        garimpo<span className="text-ouro">.</span>
      </h1>
      <p className="mb-4">Ainda não há empresas importadas. No terminal, na pasta do projeto, rode:</p>
      <pre className="overflow-x-auto rounded-lg bg-superficie p-4 text-sm">npm run tudo -- --cidade &quot;São Bernardo do Campo&quot; --uf SP</pre>
      <p className="mt-4 text-sm text-suave">
        Baixa a base mensal da Receita (~7 GB), filtra sua cidade, consulta o OpenStreetMap, testa domínios e calcula as notas.
        Depois, recarregue esta página.
      </p>
    </main>
  );
}
