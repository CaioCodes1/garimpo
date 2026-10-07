"use client";

import { useRef, useState } from "react";
import { ROTULO_STATUS, STATUS, type Status } from "../../consultas/painel";
import { acaoMudarStatus } from "../acoes";

export function BotaoCopiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(texto);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 2000);
      }}
      className="rounded-lg bg-ouro px-3 py-2 text-sm font-semibold text-superficie hover:opacity-90"
    >
      {copiado ? "Copiada ✓" : "Copiar mensagem"}
    </button>
  );
}

/** Muda o status assim que a opção é escolhida. "Não contatar" pede confirmação: é permanente. */
export function SeletorStatus({ cnpj, status }: { cnpj: string; status: Status }) {
  const formulario = useRef<HTMLFormElement>(null);
  return (
    <form ref={formulario} action={acaoMudarStatus} className="flex items-center gap-2 text-sm">
      <input type="hidden" name="cnpj" value={cnpj} />
      <label htmlFor={`status-${cnpj}`} className="text-suave">
        Status
      </label>
      <select
        // O React 19 limpa o formulário depois da ação; a chave recria o campo com o status já gravado.
        key={status}
        id={`status-${cnpj}`}
        name="status"
        defaultValue={status}
        onChange={(e) => {
          if (
            e.target.value === "nao_contatar" &&
            !confirm("Marcar como \"não contatar\"? A empresa some do painel e nunca mais gera mensagem.")
          ) {
            e.target.value = status;
            return;
          }
          formulario.current?.requestSubmit();
        }}
      >
        {STATUS.map((s) => (
          <option key={s} value={s}>
            {ROTULO_STATUS[s]}
          </option>
        ))}
      </select>
    </form>
  );
}
