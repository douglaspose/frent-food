# Sistema de Gestão de Restaurantes

SaaS multi-tenant para restaurantes: salão, cozinha, caixa, estoque e
retaguarda. Cada restaurante tem seu subdomínio e seus dados isolados.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind 4 · Prisma 7 ·
PostgreSQL 17

## Ambientes

| Rota | Para quem | Tema |
|---|---|---|
| `/pdv` | Garçom e caixa — mesas, comanda, pagamento | escuro |
| `/kds` | Cozinha — tickets por estação | escuro |
| `/gestao` | Dono e gerente — painel, cardápio, estoque, equipe, diário | claro |

O PDV e o KDS são escuros porque vivem num salão à noite; a gestão é clara
porque é usada de dia, num escritório.

## Começando

```bash
npm install
cp .env.example .env     # preencha DATABASE_URL e AUTH_SECRET
npx prisma migrate deploy
npm run db:seed
npm run dev
```

Banco de desenvolvimento sem instalar nada:

```bash
npx prisma dev --name gestao
```

Ele imprime a `DATABASE_URL` e a `SHADOW_DATABASE_URL` — copie as duas para o
`.env`.

Gere o segredo de sessão:

```bash
openssl rand -base64 32
```

### Acessos do ambiente de demonstração

Senha de todos: `demo1234`

| Cargo | PIN | E-mail |
|---|---|---|
| Proprietário | 1111 | dono@demo.com |
| Gerente | 2222 | gerente@demo.com |
| Caixa | 3333 | caixa@demo.com |
| Garçom | 4444 | joao@demo.com |

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm test` | Testes (precisa de `SHADOW_DATABASE_URL` ou `TEST_DATABASE_URL`) |
| `npm run db:migrate` | Cria e aplica migration |
| `npm run db:seed` | Popula dados de demonstração |
| `npm run db:studio` | Prisma Studio |
| `npm run rls:verificar` | Prova que o RLS está isolando os restaurantes (só faz sentido contra Postgres de verdade) |

## Erros que o usuário precisa ler

Regra de negócio violada **volta como valor**, não como exceção:

```ts
if (!limpo) throw new ErroDeOperacao("Descreva o movimento.");
```

O `throw` acontece dentro de `emResultado`, que devolve `{ erro }`. A tela
checa com `temErro(r)` e mostra a mensagem.

Não é preferência de estilo. Em produção o Next **não entrega** ao navegador a
mensagem de uma exceção lançada numa server action — o operador de caixa via
`Minified React error #441; visit https://react.dev/errors/441...` no lugar de
"A gaveta tem R$ 200,00". Verificado com `next build && next start`, antes e
depois.

Bug de programação continua sendo `throw new Error`: a mensagem de um erro do
Prisma traz consulta e nome de coluna, e isso não vai para a tela de ninguém.
O código minificado é o destino certo para ele.

**Ao escrever uma action nova:** `ErroDeOperacao` para o que o usuário precisa
ler, corpo dentro de `emResultado`, e `temErro` no ponto que consome. Os
helpers `agir()` de cada tela já fazem a checagem — mas quem **descarta** o
resultado some com a mensagem, e o TypeScript não avisa. Foi assim que o
formulário da gaveta fechou engolindo o erro.

No KDS a mensagem não vai num cantinho: é uma faixa vermelha no topo do
quadro, com botão "Entendi". A cozinha olha a tela de longe, com as mãos
ocupadas — um aviso discreto ali é um aviso que ninguém lê, e o cozinheiro
segue achando que marcou o prato como pronto.

## Armadilhas conhecidas

**`prisma generate` exige reiniciar o `npm run dev`.** O servidor carrega o
cliente Prisma uma vez; depois de mexer no schema, a tela quebra com
`Cannot read properties of undefined (reading 'findMany')` até o restart.
Custou duas depurações até virar hábito.

**`prisma migrate dev` não roda sem terminal interativo.** Quando precisar
gerar migration de forma automatizada:

```bash
npx prisma migrate diff --from-migrations prisma/migrations \
  --to-schema prisma/schema.prisma --script -o /tmp/nova.sql
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_nome
mv /tmp/nova.sql prisma/migrations/*_nome/migration.sql
npx prisma migrate deploy
```

Gere o SQL num arquivo temporário **fora** de `prisma/migrations`: uma pasta
de migration vazia faz o `migrate diff` falhar.

**Mudar o guarda de isolamento também exige reiniciar.** O cliente Prisma
estendido fica em cache no `globalThis` para não estourar conexões durante o
hot-reload, e leva o guarda junto.

**O Postgres do `prisma dev` devolve o mesmo banco para qualquer nome.** Por
isso o banco-sombra é declarado explicitamente no `prisma7.config.ts` — sem
isso a migration falha dizendo que os tipos já existem.

**O `prisma dev` cai sozinho, e volta meio no ar.** De tempos em tempos a
porta 51218 (a do protocolo Postgres) morre enquanto a 51217 continua
respondendo: a aplicação passa a falhar com `Server has closed the connection`
ou `ConnectionClosed` sem nada no log do banco. Reiniciar:

```bash
npx prisma dev stop gestao && npx prisma dev start gestao --debug
```

O `--debug` não é enfeite: sem ele o start costuma sair com código 1 e sem
mensagem quando sobrou um PID órfão do processo anterior. Confira que voltou
com `netstat -ano | grep 51218` antes de culpar o código. Os dados sobrevivem.

**O `prisma dev` não aplica RLS nem autentica o usuário.** Toda conexão roda
como superusuário — ele aceita até senha errada — e superusuário atravessa
qualquer política. O `prisma/rls.sql` é aceito ali e não protege nada. Por
isso `npm run rls:verificar` devolve 11 falhas contra o banco local, e esse é
o resultado correto: RLS só pode ser verificado contra Postgres de verdade.

**O `prisma dev` não entrega LISTEN/NOTIFY entre conexões.** Ele é um Postgres
embarcado: aceita o `pg_notify` sem erro e não entrega a ninguém — nem entre
dois clientes `pg` crus. O tempo real continua funcionando em
desenvolvimento porque os avisos também são entregues em memória (veja
[docs/tempo-real.md](docs/tempo-real.md)); o que não dá para testar aqui é a
entrega entre processos. A aplicação detecta isso sozinha no primeiro aviso e
registra no log:

```
[eventos] este banco não entrega NOTIFY: o tempo real vale só dentro deste processo.
```

## Impressão

O navegador não fala com impressora térmica. O servidor enfileira e um agente
instalado no restaurante busca e imprime:

```bash
API_URL=https://seu.dominio TOKEN=<token da unidade> node agente/agente.mjs
```

Modo de teste, gravando em arquivo em vez de imprimir:

```bash
PASTA_SAIDA=./papeis node agente/agente.mjs
```

O token é gerado em **Gestão → Impressão**.

O aviso de cancelamento sai na mesma impressora da comanda de produção, e só
se a unidade ligar `impressao.imprimirCancelamentos` — casa que trabalha só
com KDS não quer papel; casa que pendura comanda precisa do aviso, senão o
prato sai mesmo cancelado.

## Autorização do gerente

Ação acima do cargo não vira mais um "não pode". O garçom segue, e a tela pede
o PIN de quem tem a permissão — o gerente digita ali mesmo, no tablet dele, e
vai embora.

Vale para **desconto**, **cancelar item** e **movimento de gaveta**.

A alternativa real, sem isto, é o gerente emprestar o PIN. Aí todo desconto da
casa fica no nome dele, o que é pior que não ter controle nenhum, porque
*parece* controle. Aqui o diário sai certo:

```
João Garçom · Item cancelado · R$ 17,50 · autorizado por: Marina Gerente
```

A liberação é uma assinatura: vale para **um** pedido, **uma** vez, por **3
minutos**. Ela é presa ao tipo de ação, ao alvo, ao restaurante e ao garçom que
pediu, gasta na mesma transação da ação, e o PIN tem freio de 5 tentativas.

**Quem aprova precisa ter PIN cadastrado** — é o que ele digita. Gerente criado
só com e-mail e senha não libera nada; a coluna PIN em **Gestão → Equipe**
mostra quem está configurado.

## Ajustes da unidade

**Gestão → Ajustes** (permissão `unidade.configurar`, só o proprietário).
Quinze interruptores que mudam como a casa opera, cada um com a explicação do
que muda de verdade. Salvam um a um, valem na hora em todos os tablets e ficam
no diário.

O catálogo é [`src/lib/parametros.ts`](src/lib/parametros.ts) — **fonte única**:
o seed cria a partir dele, a tela desenha a partir dele e o código lê com o
padrão dele. A lista vivia duplicada no seed, e foi assim que
`kds.alertaRetiradaMin` acabou lido pelo KDS e nunca criado.

Para acrescentar um parâmetro: entrada no catálogo, leitura com
`ajusteBooleano` / `ajusteNumerico` de
[`parametros-servidor.ts`](src/lib/parametros-servidor.ts) no ponto onde a
regra vale. A tela aparece sozinha.

Quem lê o valor nunca precisa tratar "ainda não foi salvo": `lerAjustes`
devolve o catálogo inteiro com os padrões preenchidos.

## Transferir mesa

O grupo trocou de lugar, ou o garçom abriu na mesa errada — as duas coisas
acontecem toda noite. O botão fica no cabeçalho da comanda (permissão
`mesa.transferir`) e move a conta inteira:

| Onde | O que acontece |
|---|---|
| Comanda | Muda de mesa; itens, total e horário de abertura seguem intactos |
| Mesas | A de destino fica ocupada (ou em fechamento, se a conta já pediu); a de origem volta a livre — ou suja, conforme `mesa.limparAutomaticamente` |
| Cozinha | Os tickets acompanham sozinhos: o KDS lê o número da mesa pela comanda |
| Impressão | Sai um aviso `MESA 3 >>> MESA 12` nas estações com ticket em aberto |
| Diário | Quem transferiu, de onde para onde |

**Não junta mesas.** Se o destino já tem comanda aberta, a ação recusa dizendo
qual é. Juntar duas contas envolve pagamentos já lançados e decidir de quem é
a taxa de serviço — fazer as duas coisas no mesmo botão convidaria a juntar
sem querer.

A lista de destinos é carregada só quando o painel abre, e o servidor confere
de novo na hora de mover: entre abrir a lista e escolher, outro garçom pode
ter ocupado a mesa.

## Gaveta: sangria e suprimento

Dinheiro que entra ou sai da gaveta fora da venda, em **PDV → Caixa → Gaveta**
(permissão `caixa.sangria`):

| Tipo | O que é |
|---|---|
| Sangria | O gerente leva o dinheiro ao cofre no meio do turno |
| Suprimento | Troco entrando na gaveta |
| Pagamento | Pago da gaveta: gás, gelo, entregador |
| Recebimento | Outro dinheiro entrando |

Descrição é obrigatória, e não dá para retirar mais do que há na gaveta — um
zero a mais vira aviso na hora em vez de gaveta negativa no fechamento.

O "esperado na gaveta" mostrado durante o turno e o "apurado" do fechamento
saem da **mesma função** (`src/lib/caixa.ts`). Com duas contas separadas, a
divergência do fechamento passaria a medir o desencontro entre elas em vez da
diferença real — e cada tela continuaria coerente consigo mesma, então ninguém
descobriria.

## Cancelar item

Item já enviado para a cozinha sai pela própria comanda (**cancelar item**,
com motivo obrigatório). Exige `comanda.cancelarItem` — é o caminho clássico
de furo de caixa, e o que o torna seguro não é a permissão sozinha, é ela
junto com o registro no diário.

Um cancelamento mexe em quatro lugares de uma vez:

| Onde | O que acontece |
|---|---|
| Conta | O item sai do total, e a taxa de serviço deixa de incidir sobre ele |
| Cozinha | O item fica riscado no ticket; o ticket some se não sobrou item vivo |
| Estoque | O insumo volta como `DEVOLUCAO`, sem mexer no custo médio |
| Diário | Quem, quando, motivo e em que pé o item estava |

Item ainda no carrinho (`PENDENTE`) não passa por aqui: diminuir a quantidade
até zero já o remove, e isso não precisa de gerente.

## Documentação

- [Deploy na VPS](docs/deploy-vps.md) — Ubuntu, Docker, Caddy, backup
- [Segurança e isolamento](docs/seguranca.md) — o que protege e o que falta
- [Tempo real](docs/tempo-real.md) — como as telas se atualizam sozinhas
- [NFC-e](docs/fiscal.md) — estado atual e o que falta para emitir de verdade
