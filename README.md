# garimpo

Ferramenta **local e gratuita** para quem vende **site / landing page**. Ela acha pequenas
empresas da sua cidade que provavelmente ainda não têm site, explica por que cada uma é uma
oportunidade e deixa a mensagem de abordagem pronta.

Serve para qualquer município do Brasil. Roda no seu computador, sem servidor, sem cadastro
e sem chave de API.

```
┌──────────────────────────────────────────────────────────┐
│ Studio Bella Cabeleireiros                          100  │
│ Salão de beleza · MEI · Rudge Ramos                      │
│ Aberta há 2 anos (mar/2024)                              │
│                                                          │
│ Por que é oportunidade                                   │
│ +40 e-mail @gmail.com, provavelmente sem site            │
│ +30 aberta há 2 anos                                     │
│ +20 ramo: salão de beleza                                │
│ +10 dá para chamar no WhatsApp                           │
│                                                          │
│ [Copiar mensagem] [Abrir no WhatsApp] [Pesquisar Google] │
└──────────────────────────────────────────────────────────┘
```

## De onde vêm os dados

| Fonte | O que traz | Custo |
|---|---|---|
| [Dados abertos do CNPJ](https://dados.gov.br/dados/conjuntos-dados/cadastro-nacional-da-pessoa-juridica---cnpj) (Receita Federal, mensal) | Todas as empresas: ramo (CNAE), porte, MEI, data de abertura, endereço, telefone, e-mail | Grátis |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) (Overpass) | Localização e site, quando a empresa está cadastrada lá | Grátis |
| DNS + HTTP | Se o domínio do e-mail tem site e se o site abre com HTTPS | Grátis |

## Quem aparece

Só entra no painel o estabelecimento que cumpre **todas** estas regras:

1. está **ativo** na Receita e fica no município escolhido;
2. é **MEI, microempresa ou empresa de pequeno porte**;
3. tem **natureza jurídica empresarial** (sem órgão público, associação, condomínio etc.);
4. tem o **ramo** na lista de [`config/ramos.json`](config/ramos.json): alimentação, beleza, saúde,
   pet, comércio de bairro, oficinas, reformas, academias, escolas livres, entre outros.

Ramos de trabalhador que virou PJ (motorista de aplicativo, entregador, promotor de vendas,
dev freelancer) ficam fora de propósito, porque esses não compram site.

## A nota (0 a 100)

| Sinal | Pontos |
|---|---|
| E-mail @gmail/@hotmail/... **ou** domínio sem site | 40 |
| Site sem HTTPS ou fora do ar (confirmado) | 30 |
| Não dá para saber se tem site | 15 |
| Site funcionando | 0 |
| Idade: 1 a 3 anos / 6 a 12 meses / menos de 6 meses ou 3 a 5 anos | 30 / 20 / 10 |
| Ramo que depende de ser achado online / demais | 20 / 10 |
| Celular próprio / só fixo | 10 / 5 |

A idade é configurável em [`config/nota.json`](config/nota.json). O padrão põe no topo quem tem 1 a
3 anos: já passou do começo, tem caixa e ainda não tem site. Para priorizar recém-abertas, troque
os pesos.

**Contador:** um e-mail ou telefone repetido em 5 ou mais empresas do município é tratado como
do contador. Ele não conta como pista nem como contato.

**"Site fora do ar"** só é afirmado depois de **duas falhas separadas por pelo menos uma hora**,
e só se a sua internet estiver funcionando. Uma mensagem dizendo ao dono que o site dele está
quebrado, sem ser verdade, queima o seu nome.

## Instalação

Precisa de **Node.js 24** ou mais novo e de uns **7 GB livres** durante a importação. Depois,
os zips são apagados e o banco da cidade fica com poucos MB.

```bash
git clone https://github.com/CaioCodes1/garimpo.git
cd garimpo
npm install
cp config/perfil.exemplo.json config/perfil.json   # coloque seu nome, cidade e portfólio
```

Para guardar os dados em outro disco, copie `.env.exemplo` para `.env` e defina
`GARIMPO_DADOS`.

## Uso

```bash
npm run tudo -- --cidade "São Bernardo do Campo" --uf SP
npm run build && npm start        # painel em http://localhost:3000
```

O `tudo` executa os quatro passos, que também rodam separados:

| Comando | Faz |
|---|---|
| `npm run importar -- --cidade "..." --uf XX [--mes 2026-09] [--manter-zips]` | Baixa a base do mês (retoma se cair) e grava as empresas elegíveis |
| `npm run enriquecer` | Cruza com o OpenStreetMap (opcional; se falhar, o resto funciona) |
| `npm run verificar` | Testa domínios. Rode de novo depois de 1 hora para confirmar sites fora do ar |
| `npm run pontuar` | Recalcula as notas |
| `npm run teste-real` | Confere se Receita, OpenStreetMap e DNS ainda respondem como esperado |

Use `--manter-zips` se for importar outra cidade logo em seguida: assim não baixa os 7 GB de
novo. Reimportar no mês seguinte atualiza o cadastro **sem mexer no seu funil**.

## No painel

- Filtros por bairro, ramo, nota mínima, idade da empresa (menos de 1 ano, 1 a 3, 3 a 5, mais de 5), status e nome.
- **Copiar mensagem** e **Abrir no WhatsApp**: abre o WhatsApp com o texto pronto, mas **quem
  envia é você**. Não existe envio automático.
- **Pesquisar no Google**: confirma em segundos se a empresa já tem site.
- Funil: novo → mensagem enviada → respondeu → proposta → fechado / perdido.
- **Não contatar** é permanente: a empresa some do painel e nunca mais gera mensagem, mesmo
  depois de reimportar.

## Personalizar

- [`config/nota.json`](config/nota.json): os pontos por idade da empresa.
- [`config/ramos.json`](config/ramos.json): os ramos aceitos e o peso de cada um. Vende sistema
  para clínicas? Deixe só os ramos de saúde.
- [`config/modelos/`](config/modelos): os três textos (empresa nova, sem site, site com
  problema). Variáveis: `{nome}`, `{ramo}`, `{onde}`, `{tempo_aberta}`, `{site}`,
  `{problema}`, `{seu_nome}`, `{sua_profissao}`, `{sua_cidade}`, `{seu_portfolio}`.
- `config/perfil.json`: seus dados (fora do git).

## Uso responsável

- **Mensagem individual, enviada por uma pessoa.** Disparo em massa no WhatsApp bane o número
  e é exatamente o que a LGPD e o bom senso desaconselham.
- Os modelos sempre terminam com a linha de saída ("é só me avisar que não mando mais"). Quando
  alguém pedir, marque **Não contatar**.
- Os dados são públicos (Receita e OpenStreetMap), mas o uso continua sujeito à LGPD. Contato
  comercial B2B é legítimo quando é pertinente, transparente e respeita quem pede para parar.

## Limitações conhecidas

- **Não existe fonte grátis que diga com certeza se a empresa tem site.** O e-mail é uma pista
  forte, não uma prova. Por isso o botão "Pesquisar no Google" existe.
- O cadastro da Receita tem defasagem de cerca de um mês, e parte dos e-mails e telefones é do
  contador.
- O OpenStreetMap cobre só uma fração das empresas (em São Bernardo, cerca de 4 mil lugares com
  nome e rua, contra 55 mil empresas elegíveis). O cruzamento exige nome **e** rua iguais, então
  prefere não cruzar a cruzar errado.
- **Unidade de franquia** aparece como oportunidade, mas o site é da rede. A Receita não marca
  franquia; quando aparecer uma, marque **Não contatar**.

## Segurança e privacidade

O garimpo roda no seu computador e guarda dados de terceiros (nome de MEI, telefone, e-mail).
Por isso:

- **O painel só atende o próprio computador.** `npm run dev` e `npm start` escutam em
  `127.0.0.1`, e qualquer requisição que não chame o painel por `localhost`, `127.0.0.1` ou
  `[::1]` recebe 403. Isso impede outro aparelho da rede de abrir o painel e barra o *DNS
  rebinding* (um site malicioso aberto no navegador tentando ler o painel). O painel não tem
  login: **não exponha a porta** (túnel, `-H 0.0.0.0`, port forwarding).
- **O verificador não acessa a sua rede interna.** Os domínios testados vêm de dados públicos;
  um cadastro pode apontar para `192.168.0.1` ou `127.0.0.1`. Endereços de loopback, rede
  privada, CGNAT, link-local e metadados de nuvem são recusados na resolução de cada conexão,
  inclusive em redirecionamentos. O corpo das respostas nunca é lido.
- **O banco fica fora do Git.** `dados/` e `.env` estão no `.gitignore`. Não publique nem
  compartilhe o `garimpo.db`: ele tem dados pessoais.
- **O que sai do seu computador:** a listagem e o download da base da Receita, uma consulta ao
  OpenStreetMap com o nome da cidade, e um `GET /` nos domínios das empresas. Nada é enviado
  para servidor do projeto, e não há telemetria. WhatsApp e Google só abrem quando você clica.
- O painel manda `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff` e
  `Referrer-Policy: no-referrer`. Toda consulta ao banco usa parâmetros, não concatenação.

Achou uma falha? Veja [SECURITY.md](SECURITY.md).

### Dependências

`npm audit --omit=dev` (o que roda de verdade) está **zerado**, e é o portão do CI.

O `npm audit` completo acusa 5 altas, todas na mesma cadeia **só de desenvolvimento**:
`eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`
([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), negação de serviço com
padrões glob aninhados). Não há versão corrigida do `braces` (a 3.0.3 é a última, conferido em
08/10/2026). A "correção" que o `npm audit fix --force` propõe é **rebaixar o
`eslint-config-next` de 16 para 14**, o que quebra o lint. Os padrões glob que o ESLint lê são do
próprio projeto, não de entrada externa, então o risco é aceito. O Dependabot avisa quando sair a
correção.

## Desenvolvimento

```bash
npm test          # Vitest, sem rede: Receita, OSM, DNS e HTTP são simulados
npm run lint && npm run typecheck && npm run build
```

O design completo está em [`docs/superpowers/specs/2026-10-07-garimpo-design.md`](docs/superpowers/specs/2026-10-07-garimpo-design.md).

## Licença

[MIT](LICENSE). Dados do OpenStreetMap © colaboradores do OpenStreetMap, sob a licença ODbL.
