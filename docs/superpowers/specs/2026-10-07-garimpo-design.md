# garimpo — design

> Data: 07/10/2026 · Autor: Caio Martins · Estado: implementado (v1)

## 1. O que é

Ferramenta **local e de código aberto** para freelancers que vendem **site /
landing page** acharem pequenas empresas da própria cidade que provavelmente
não têm site, entenderem cada uma em poucos segundos e abordarem por mensagem.

Funciona para **qualquer município do Brasil**: a cidade é parâmetro, nunca
código fixo. A cidade de referência para desenvolvimento e validação é
**São Bernardo do Campo / SP**.

### Objetivos

- Listar só empresas **pequenas e com quem dá para fazer freelance** (seção 4).
- Para cada uma, mostrar: **descrição breve**, **por que é oportunidade** e
  **há quanto tempo está aberta**.
- Gerar uma **mensagem personalizada** pronta para copiar ou abrir no WhatsApp.
- Acompanhar cada empresa num **funil** simples.
- **Custo zero** para quem usa e para quem mantém.

### Fora do escopo da versão 1

IA, Google Places, envio automático de mensagens, mapa, login/multiusuário,
site hospedado, medição de velocidade (Lighthouse), proposta em PDF.

### Público

Freelancers técnicos: sabem clonar um repositório e rodar `npm install` e
`npm start`. **Docker é opcional, nunca obrigatório.**

## 2. Restrições

| Restrição | Consequência no desenho |
|---|---|
| Custo zero | Só fontes grátis: dados abertos de CNPJ da Receita Federal e OpenStreetMap (Overpass). Nada que exija cartão. |
| Roda no PC de quem usa | Next.js + SQLite local, sem servidor de banco. |
| Docker instável na máquina do autor | Nenhum passo depende de Docker. |
| Disco | Só os dados **filtrados** do município ficam guardados. A pasta de dados é configurável (na máquina do autor: `D:`). |
| LGPD | Mensagem individual, enviada por humano, sempre com linha de saída; status "não contatar" permanente. |

## 3. Arquitetura

Um único projeto TypeScript (Node 24), com cinco módulos independentes e um
painel. Cada módulo lê e escreve no SQLite e pode rodar sozinho.

```
importador-cnpj → enriquecedor-osm → verificador-dominio → pontuador → painel
                                                              mensagens ┘
```

| Módulo | Faz | Depende de |
|---|---|---|
| `importador` | Baixa os arquivos do mês da Receita, lê os zips em streaming e grava as empresas elegíveis do município | rede, `config/fontes.json`, `config/ramos.json` |
| `enriquecedor` | Consulta o OpenStreetMap do município e acrescenta coordenadas e site às empresas encontradas | rede (Overpass), tabela `empresas` |
| `verificador` | Testa o domínio do e-mail ou o site do OSM | rede (DNS + HTTP), tabela `empresas` |
| `pontuador` | Calcula nota e motivos de cada empresa | tabelas `empresas` e `verificacoes`, `config/ramos.json` |
| `mensagens` | Monta o texto a partir de modelo + empresa + perfil | `config/modelos/`, `config/perfil.json` |
| `app/` (painel) | Lista, ficha, botões de ação e funil | SQLite, `mensagens` |

**Banco:** `node:sqlite` (embutido no Node 24), para não compilar módulo nativo
no Windows. Um arquivo por instalação: `<pastaDados>/garimpo.db`.

**Testes:** Vitest. **CI:** GitHub Actions. **Licença:** MIT.

### Comandos

```
npm run importar -- --cidade "São Bernardo do Campo" --uf SP
npm run enriquecer
npm run verificar
npm run pontuar
npm run tudo -- --cidade "São Bernardo do Campo" --uf SP   # os quatro em sequência
npm start                                                    # painel em localhost:3000
```

## 4. Elegibilidade (o que entra)

Um estabelecimento só é gravado se cumprir **todas** as regras:

1. **Município** = o escolhido (código **da Receita**, não do IBGE; a tradução
   vem do arquivo `Municipios` da própria Receita, buscando por nome + UF sem
   acento e sem distinção de maiúsculas).
2. **Situação cadastral** = ativa (`02`).
3. **Porte pequeno**: MEI (`opcao_mei = S` no arquivo do Simples), microempresa
   (`porte = 01`) ou empresa de pequeno porte (`porte = 03`). Porte `05`
   (demais) e `00` (não informado) ficam de fora. Como o porte é da empresa
   inteira, filial de empresa grande já sai por esta regra.
4. **Natureza jurídica empresarial**: códigos que começam com `2`. Isso exclui
   administração pública (`1xxx`), entidades sem fins lucrativos (`3xxx`),
   pessoas físicas e organizações internacionais.
5. **CNAE principal na lista de ramos** de `config/ramos.json`.

`config/ramos.json` é uma lista de **prefixos de CNAE** com rótulo legível e
peso. A versão inicial cobre: alimentação, beleza e estética, saúde, pet,
comércio de bairro, oficinas e reparos, reformas, academias, escolas livres,
advocacia, contabilidade e imobiliárias. Ramos típicos de **trabalhador
pejotizado** (transporte por aplicativo, entregas, promoção de vendas,
desenvolvimento de software, serviços administrativos) ficam fora de
propósito.

Exemplo de entrada:

```json
{ "prefixo": "9602", "rotulo": "Salão de beleza e estética", "peso": 20 }
```

## 5. Importador

### Fontes

O endereço base dos arquivos fica em `config/fontes.json`. A Receita mudou o
layout em janeiro de 2026: desde então é um compartilhamento público do
Nextcloud, lido por WebDAV (`PROPFIND`) em
`https://arquivos.receitafederal.gov.br/public.php/dav/files/YggdBLfdninEJX9/<AAAA-MM>/`.
Confirmado em 07/10/2026 (mês mais recente: 2026-09; os arquivos usados somam
6,6 GB). O servidor aceita `Range`.

Arquivos usados (todos `;`, entre aspas, codificação **latin1**):

| Arquivo | Partes | Colunas usadas |
|---|---|---|
| `Estabelecimentos` | 10 | CNPJ básico/ordem/DV, matriz/filial, nome fantasia, situação, data de início, CNAE principal, endereço, bairro, CEP, UF, município, DDD+telefone 1 e 2, e-mail |
| `Empresas` | 10 | CNPJ básico, razão social, natureza jurídica, porte |
| `Simples` | 1 | CNPJ básico, opção MEI |
| `Municipios` | 1 | código → nome (sem UF; a UF desempata na leitura dos estabelecimentos) |

### Fluxo

1. Baixa `Municipios` e `Cnaes` e resolve o código do município.
2. Lê as 10 partes de `Estabelecimentos` em streaming e aplica as regras 1, 2
   e 5. Guarda em memória o conjunto de CNPJs básicos que passaram (dezenas de
   milhares, cabe com folga).
3. Lê `Empresas` e `Simples` em streaming, mantendo só os CNPJs básicos do
   conjunto, e aplica as regras 3 e 4.
4. Grava com *upsert* por CNPJ completo (14 dígitos), numa transação por parte.

### Comportamento

- **Download retomável** (HTTP `Range`). Arquivo completo do mês não é baixado
  de novo. Por padrão, os zips são apagados ao fim de uma importação bem
  sucedida (`manterZips: false`).
- **Reimportação** atualiza os dados cadastrais e **nunca toca** em `funil`.
  Empresa que deixou de aparecer como ativa vira `situacao = 'encerrada'`; não
  é apagada.
- Endereço da Receita fora do ar ou com caminho diferente gera um erro que
  diz isso e aponta para `config/fontes.json`.
- Cada execução registra uma linha em `importacoes`.

## 6. Enriquecedor (OpenStreetMap)

- Duas consultas Overpass por município: a primeira lista as relações
  `admin_level=8` da UF (só etiquetas) para achar o município comparando nomes
  sem acento, porque a Receita grava "SAO BERNARDO DO CAMPO"; a segunda traz os
  lugares com `name` e `addr:street` da área. Respeita a política de uso do
  servidor público: `User-Agent` identificado e nova tentativa com espera
  crescente (10 s, 30 s, 60 s) em 429/5xx.
- **Cruzamento:** nome normalizado (sem acento, minúsculo, sem `ltda`, `me`,
  `eireli`, `epp`) igual ao nome fantasia **e** logradouro normalizado igual.
  Sem as duas coincidências, não cruza: é melhor não enriquecer do que
  enriquecer errado.
- Quando cruza, grava `lat`, `lon` e `site_osm`.
- É **opcional**: se falhar, o resto do fluxo funciona.

## 7. Verificador de domínio

**Alvo:** o `site_osm` quando houver. Se não houver, o domínio do e-mail, desde
que não seja de provedor gratuito (lista em `config/provedores-email.json`:
gmail, hotmail, outlook, yahoo, bol, uol, terra, live, icloud…) e não seja de
contador (seção 8).

Resultados possíveis:

| Estado | Como se chega | Leitura |
|---|---|---|
| `ok` | HTTPS responde com status < 500 (4xx incluído: proteção anti-robô ou raiz faltando ainda é servidor no ar) | Tem site funcionando |
| `sem_https` | Só HTTP responde | Site com problema |
| `sem_site` | O domínio existe, mas não tem registro A/AAAA (só e-mail) | Tem domínio, não tem site |
| `fora_do_ar` | Sem resposta ou erro do servidor **em duas verificações com pelo menos 1 hora de intervalo** | Site com problema |
| `inconclusivo` | Tempo esgotado ou erro de rede só nesta verificação | Não dá para afirmar nada |

Regra dura: **nenhuma mensagem diz que o site está com problema** se o estado
não for `sem_https` ou `fora_do_ar` confirmado. Tempo limite de 8 s por
requisição e no máximo 5 verificações simultâneas. Erro do próprio DNS não
conta como falha, e o passo inteiro aborta se a internet local não responde
(`generate_204`). Site do OSM cujo domínio não tem endereço conta como falha
(e não como `sem_site`): estava no ar e caiu.

## 8. Pontuador

### Detecção de contador

Um e-mail ou telefone que aparece em **5 ou mais** estabelecimentos ativos do
município, **de qualquer ramo** (a contagem é feita antes do filtro de ramo), (limite em `config/ramos.json → limiteContador`) é considerado do
contador. Ele não serve como pista de site nem como contato. A ficha mostra
"contato provavelmente do contador".

### Nota (0–100) e motivos

| Sinal | Pontos | Motivo mostrado |
|---|---|---|
| E-mail de provedor gratuito | 40 | "e-mail @gmail — provavelmente sem site" |
| Verificador `sem_site` | 40 | "tem domínio, mas não tem site" |
| Verificador `sem_https` ou `fora_do_ar` | 30 | "site com problema" |
| Sem e-mail, e-mail de contador ou `inconclusivo` | 15 | "não dá para saber se tem site" |
| Verificador `ok` | 0 | "já tem site funcionando" |
| Aberta há menos de 6 meses | 30 | "aberta há N meses" |
| Aberta há 6 a 12 meses | 20 | idem |
| Aberta há 1 a 3 anos | 10 | idem |
| Ramo | peso do ramo (10 ou 20) | "ramo: <rótulo>" |
| Celular próprio (não de contador) | 10 | "dá para chamar no WhatsApp" |
| Só telefone fixo próprio | 5 | "só telefone fixo" |

Celular = número de 9 dígitos começando com 9.

O sinal de site é **um só**, decidido nesta ordem: (1) se o verificador
chegou a um estado diferente de `inconclusivo`, ele decide; (2) senão, vale o
e-mail (provedor gratuito → 40); (3) senão, 15. Assim, uma empresa com e-mail
@gmail mas com site do OSM funcionando fica com 0, não com 40. Nota e motivos ficam gravados em
`pontuacoes` para ordenar rápido.

### Descrição breve

É montada sem IA a partir do cadastro:
`<rótulo do ramo> · <MEI | microempresa | pequeno porte> · <bairro>`, mais a
linha `Aberta há <N meses | N anos> (<mês/ano>)`. O nome exibido é o nome
fantasia; se estiver vazio, a razão social sem o sufixo jurídico.

## 9. Mensagens

- Três modelos em `config/modelos/`: `empresa-nova.md`, `sem-site.md` e
  `site-com-problema.md`.
- **Escolha:** `site-com-problema` se o verificador confirmou o problema; senão
  `empresa-nova` se a empresa abriu há menos de 12 meses; senão `sem-site`.
- **Variáveis:** `{nome}`, `{ramo}`, `{bairro}`, `{tempo_aberta}`,
  `{seu_nome}`, `{sua_cidade}`, `{seu_portfolio}`. As três últimas vêm de
  `config/perfil.json` (fora do git; o repositório traz
  `perfil.exemplo.json`).
- **Regras dos modelos:** no máximo 5 linhas, um motivo concreto, termina em
  pergunta e não em preço, e **sempre** termina com a linha de saída ("Se não
  fizer sentido agora, é só me avisar que não mando mais.").
- **WhatsApp:** link `https://wa.me/55<DDD><número>?text=<texto codificado>`,
  só quando há celular próprio. O link abre o WhatsApp com o texto pronto;
  **quem envia é a pessoa**. Não há envio automático.

## 10. Painel

- **Lista**, ordenada por nota, com filtros: bairro, ramo, nota mínima,
  "aberta nos últimos N meses" e status do funil. Empresas `nao_contatar` e
  `encerrada` ficam ocultas por padrão.
- **Cartão / ficha:** nome e nota; descrição breve; tempo aberta; motivos; o
  contato (com o aviso de contador, se for o caso); a mensagem gerada.
- **Ações:** copiar mensagem · abrir no WhatsApp · pesquisar no Google (abre
  `google.com/search?q=<nome> <cidade>` numa aba nova para a pessoa confirmar
  se há site) · mudar status · anotações.
- **Funil:** `novo → mensagem_enviada → respondeu → proposta → fechado | perdido`,
  mais `nao_contatar`, que é **permanente**: some do painel, nunca gera
  mensagem e sobrevive a qualquer reimportação. Marcar "mensagem enviada"
  grava a data do contato.

## 11. Dados (SQLite)

| Tabela | Chave | Conteúdo |
|---|---|---|
| `empresas` | `cnpj` (14) | dados cadastrais filtrados, `situacao` (`ativa`/`encerrada`), `lat`, `lon`, `site_osm`, `atualizado_em` |
| `verificacoes` | `cnpj` | alvo, estado, falhas consecutivas, `verificado_em` |
| `pontuacoes` | `cnpj` | `nota`, `motivos` (JSON), `calculado_em` |
| `funil` | `cnpj` | `status`, `anotacoes`, `contatado_em`, `atualizado_em` |
| `importacoes` | `id` | município, mês de referência, início, fim, linhas lidas, gravadas |

`funil` é a única tabela escrita pelo usuário. Nenhum módulo de importação ou
cálculo escreve nela.

## 12. Organização

```
garimpo/
  config/
    fontes.json  ramos.json  provedores-email.json
    perfil.exemplo.json   (perfil.json no .gitignore)
    modelos/ empresa-nova.md  sem-site.md  site-com-problema.md
  src/
    importador/  enriquecedor/  verificador/  pontuador/  mensagens/  db/
  src/app/        painel Next.js
  tests/
    fixtures/     zips pequenos no formato da Receita
  docs/
```

Pasta de dados: variável `GARIMPO_DADOS` (lida do `.env` pelos comandos e pelo
Next), padrão `./dados` (no `.gitignore`).

## 13. Testes

- **Unidade:** elegibilidade (cada uma das cinco regras), detecção de
  contador, cada linha da tabela de nota, escolha do modelo, texto final de
  cada modelo, "aberta há N meses/anos", normalização de nome e logradouro,
  detecção de celular, montagem do link `wa.me`.
- **Integração:** zips de exemplo em `tests/fixtures/` (latin1, `;`, mesmas
  colunas da Receita) passando pelo importador até o SQLite. Inclui um caso de
  reimportação que confere que `funil` e `nao_contatar` sobrevivem.
- **Sem rede nos testes:** Receita, Overpass, DNS e HTTP são simulados.
  `npm run teste-real` confere as fontes reais (lista a Receita, acha o
  município no Overpass, verifica `example.com`) sem baixar a base, e só roda
  manualmente.
- **CI:** GitHub Actions com lint, tipos e testes.

## 14. Critério de pronto da versão 1

Rodar `npm run tudo -- --cidade "São Bernardo do Campo" --uf SP` numa máquina
limpa, abrir o painel e ver empresas pequenas de São Bernardo ordenadas por
nota, cada uma com descrição, motivos, tempo aberta e mensagem pronta. O autor
confere manualmente 20 das primeiras: a maioria deve ser de fato negócio local
sem site ou com site ruim.
