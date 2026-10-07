"use server";

import { revalidatePath } from "next/cache";
import { mudarStatus, salvarAnotacoes, STATUS, type Status } from "../consultas/painel";
import { obterBanco } from "../lib/servidor";

const CNPJ = /^\d{14}$/;

export async function acaoMudarStatus(formulario: FormData): Promise<void> {
  const cnpj = String(formulario.get("cnpj") ?? "");
  const status = String(formulario.get("status") ?? "") as Status;
  if (!CNPJ.test(cnpj) || !STATUS.includes(status)) return;
  mudarStatus(obterBanco(), cnpj, status);
  revalidatePath("/");
}

export async function acaoSalvarAnotacoes(formulario: FormData): Promise<void> {
  const cnpj = String(formulario.get("cnpj") ?? "");
  if (!CNPJ.test(cnpj)) return;
  salvarAnotacoes(obterBanco(), cnpj, String(formulario.get("anotacoes") ?? ""));
  revalidatePath("/");
}
