# Segurança

## Como reportar uma falha

Use o **relato privado de vulnerabilidade** do GitHub, na aba *Security* deste repositório
(*Report a vulnerability*). Não abra issue pública para falha de segurança.

Ajuda incluir: o que acontece, como reproduzir e qual versão (commit) você usa.

## O que está no escopo

- O painel local (`src/app`, `src/proxy.ts`): acesso por outro aparelho, por outro site aberto
  no navegador, ou execução de ação sem querer.
- O verificador de domínios (`src/verificador`): acesso à rede interna de quem usa, leitura de
  resposta maliciosa.
- O importador (`src/importador`): arquivo malformado ou malicioso no lugar da base da Receita.
- Vazamento de dados pessoais do banco local.

## Fora do escopo

- Expor o painel de propósito na rede (`-H 0.0.0.0`, túnel, port forwarding): o painel não tem
  login e foi feito para uso local.
- Vulnerabilidades em dependências só de desenvolvimento sem caminho de exploração (ver a seção
  "Dependências" do README).

## Desenho

As medidas atuais estão descritas na seção "Segurança e privacidade" do [README](README.md).
