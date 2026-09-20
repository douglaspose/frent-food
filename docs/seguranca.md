# Segurança e isolamento

Este documento diz **o que já protege** o sistema e, com a mesma clareza, **o
que ainda não protege**. Num SaaS onde restaurantes concorrentes dividem o
mesmo banco, a pior falha possível é um ver os dados do outro — e é a que
menos dá sinal quando acontece.

## O que está ativo

### 1. Sessão e rotas

Cookie assinado (HS256, `httpOnly`, `sameSite=lax`), válido por 12 horas — um
turno inteiro, para o garçom não relogar às 22h no meio do movimento.

O middleware barra `/pdv`, `/kds` e `/gestao` sem cookie válido e devolve para
o login guardando o destino. Ele só valida a assinatura: **quem pode fazer o
quê é decidido na server action**, onde a ação realmente acontece e não dá para
burlar trocando a URL.

### 2. Permissão por cargo

Cada server action sensível chama `exigirPermissao("chave")` antes de tocar no
banco. Esconder o botão na interface **não é segurança** — é conveniência.

O melhor exemplo é o cancelamento de item: o botão aparece para todo mundo,
marcado "(com autorização)", e quem decide é o servidor — que responde pedindo
o PIN de quem pode em vez de recusar. A interface ali não esconde nada; ela
apenas antecipa o que vai acontecer.

Onde a tela **também** é fechada, é por causa do que ela mostra, não do que
ela faz: a tela do caixa expõe o dinheiro na gaveta e o faturamento do turno,
então além de esconder o item do menu ela redireciona quem não opera a gaveta.
As duas coisas juntas — a porta e a recusa do servidor.

Chaves em uso: `comanda.abrir`, `comanda.lancarItem`, `comanda.cancelarItem`,
`comanda.aplicarDesconto`, `comanda.receberPagamento`, `comanda.fechar`,
`caixa.abrir`, `caixa.fechar`, `caixa.sangria`, `produto.editar`,
`cardapio.editar`, `usuario.editar`, `mesa.transferir`, `auditoria.ver`,
`unidade.configurar`.

### 3. Verificação de dono em cada ação

Toda action que recebe um id confere se o registro pertence ao tenant da
sessão antes de alterar. Trocar o id na URL não alcança dados de outro
restaurante; mesa de outra unidade responde como inexistente, sem confirmar
que existe.

### 4. Guarda de consulta sem filtro

`src/lib/guarda-tenant.ts` intercepta toda consulta do Prisma. Se um
`findMany`, `count`, `updateMany` ou `deleteMany` tocar uma tabela de
restaurante **sem filtro de tenant ou unidade**, a consulta falha com mensagem
explicando o que fazer.

Isso transforma o erro mais perigoso — esquecer o `where` — de falha silenciosa
em exceção imediata. Em desenvolvimento e teste ele lança; em produção apenas
registra, porque derrubar o pedido de um restaurante por falso positivo seria
pior que o risco coberto.

### 5. Diário de auditoria

Ações que mexem em dinheiro gravam quem, quando e de quanto para quanto — o
registro entra na **mesma transação** da alteração, então não existe desconto
sem linha correspondente. Lido em **Gestão → Diário**, com a permissão
`auditoria.ver` (gerente e proprietário; garçom e caixa não).

Cobre desconto, item cancelado, mesa transferida, ajuste de configuração,
sangria e suprimento de caixa, taxa de serviço, conta reaberta, pagamento
estornado, fechamento de caixa com divergência, preço alterado, produto
desativado e mexidas na equipe. A lista completa está em `src/lib/auditoria.ts`.

O cancelamento de item guarda em que pé o item estava (`estava em: PRONTO`) —
é o que separa um engano de lançamento de comida feita e jogada fora, e é o
padrão que denuncia o furo clássico: lançar, entregar e cancelar.

Senha, PIN e seus hashes nunca entram no diário — só o fato de terem mudado.

### 6. Autorização gerencial

Quem não tem a permissão não é barrado: a tela pede o PIN de quem tem, e a
ação segue **no nome de quem a fez**, com o aprovador registrado ao lado
(`src/lib/autorizacao-servidor.ts`). Cobre desconto, cancelamento de item e
movimento de gaveta.

Isso existe porque a alternativa prática é o gerente emprestar o PIN — e um
sistema onde todo desconto aparece no nome do gerente é pior que um sem
controle, porque parece controle.

A liberação vale para um alvo, uma vez, por 3 minutos, e está presa ao
restaurante, à unidade e ao usuário que pediu. É gasta na mesma transação da
ação: se a ação falhar, a autorização continua válida para a próxima
tentativa. O PIN passa pelo mesmo freio de tentativas do login, chaveado pelo
**solicitante** — chavear pelo PIN diria a quem tenta se aquele PIN existe.

Quem aprova precisa ter PIN. Aprovar o próprio pedido é recusado.

### 7. Freio de força bruta

Cinco tentativas por janela de 15 minutos, no login por PIN, no login por
e-mail e no PIN de autorização gerencial. Um PIN de 4 dígitos tem 10 mil
combinações: sem freio, um script acerta em minutos; com ele, a mesma
varredura leva semanas.

A contagem vive no Postgres, não na memória do processo. Memória resolvia o
ataque preguiçoso e não o paciente: com duas instâncias atrás de um
balanceador cada uma contava as suas cinco, e reiniciar a aplicação absolvia
quem estava no meio da varredura — sem que quem ataca precisasse saber disso
para se beneficiar.

A soma é um `INSERT ... ON CONFLICT DO UPDATE` só. Ler-somar-gravar em três
passos deixaria tentativas simultâneas lerem o mesmo valor e gravarem o mesmo
número, cinco tentativas pelo preço de uma — que é o que um ataque em paralelo
procura. Assim o banco serializa no bloqueio da linha, e há teste disparando
cinco ao mesmo tempo para provar.

A tabela `freios_de_tentativa` não tem `tenantId` de propósito, e por isso
fica fora do guarda de tenant e do RLS: ela é consultada antes do login,
quando ainda não se sabe de quem é a tentativa. A isenção está escrita em
`tests/rls.test.ts`, para ser uma decisão e não um esquecimento.

### 8. RLS no Postgres — o isolamento no banco

Até aqui, tudo depende da aplicação lembrar de filtrar. O RLS é a rede embaixo:
mesmo que uma consulta escape do guarda, o Postgres devolve vazio.

**Como funciona.** Cada consulta sai declarada:

```sql
select set_config('app.tenant_id', $1, true);   -- true = LOCAL, morre no commit
```

Não é `SET LOCAL app.tenant_id = $1`: **`SET` não aceita parâmetro**, e montar
a string à mão abriria injeção no lugar exato que deveria proteger. O `true` no
terceiro argumento também não é detalhe — sem ele a variável gruda na conexão e
o próximo a pegá-la no pool herda o restaurante do anterior.

**Onde isso acontece.** Em `src/lib/adaptador-rls.ts`, que embrulha o adapter do
Prisma. Consulta solta vira `BEGIN → declaração → consulta → COMMIT`; transação
aberta pelo código recebe a declaração como primeiro comando. Nenhuma server
action precisou mudar: o isolamento é propriedade da conexão, não disciplina de
quem escreve consulta.

Foram medidas as duas formas possíveis contra as seis consultas do painel, com
duas semanas de movimento no banco: uma transação por requisição e uma por
consulta empataram (~3,4 ms por tela). Ficou a segunda, porque a primeira
enfileiraria o que hoje sai em paralelo e prenderia uma conexão por requisição
inteira. `npm run rls:medir` refaz a conta.

**De onde vem o restaurante.** Do `tenantId` assinado dentro do cookie de
sessão. O adapter **pergunta** (`tenant-da-sessao.ts`) em vez de esperar que
alguém declare — e essa inversão não foi escolha de estilo:

- `AsyncLocalStorage.enterWith` **não sobe para quem chamou**. Como o
  `lerSessao()` dá `await` no cookie antes de declarar, a continuação de quem
  o chamou já tinha contexto próprio, criado antes da marca.
- O `cache()` do React resolve isso na renderização de página, mas o escopo
  dele é a renderização: numa **server action** cada chamada devolve uma caixa
  nova, e o que foi guardado some.

As duas falhas são silenciosas — as consultas simplesmente voltam vazias. O
cookie não tem o problema porque não depende de contexto: `cookies()` funciona
nos três lugares de onde uma consulta pode sair (renderização, server action,
route handler). Custa verificar um JWT por consulta, dezenas de microssegundos
contra os ~3 ms da consulta.

`declararTenant()` continua existindo para os dois casos sem cookie — login
(depois de achar o restaurante pelo endereço) e agente de impressão (depois de
identificar a unidade pelo token). Nos dois, a declaração e as consultas ficam
no **mesmo corpo de função**, que é a condição em que `enterWith` vale. Há
teste registrando essa limitação em `src/lib/tenant-atual.test.ts`.

**As duas exceções**, e não há outras. Ambas precisam responder algo antes de
existir um restaurante conhecido:

| onde | pergunta | por quê |
|---|---|---|
| login | de quem é este subdomínio? | sem isso a tela de login não abre para ninguém |
| `/api/impressao` | de que unidade é este token? | o agente é serviço, não pessoa: não tem sessão |

As duas usam o cliente `dbSemRls` (role com `BYPASSRLS`, `DATABASE_URL_SEM_RLS`)
e são marcadas com `atravessandoRestaurantes(motivo, …)`. A marca existe para
separar "atravessa de propósito" de "esqueceu de declarar" — a segunda vira
aviso no log de desenvolvimento. O pool desse cliente tem 3 conexões: se
precisar de mais, ele deixou de ser exceção e virou caminho.

**Como ligar num banco.**

1. `npm run rls:aplicar` com `DATABASE_URL` de superusuário e
   `SENHA_APP_GESTAO` — cria a role `app_gestao` (`NOBYPASSRLS`) e as políticas
   de `prisma/rls.sql`, que cobrem as 27 tabelas com `tenantId`, as 9
   tabelas-filhas (pela política do pai) e a própria `tenants`.
2. Trocar a `DATABASE_URL` da aplicação para `app_gestao`, e apontar
   `DATABASE_URL_SEM_RLS` para a role de travessia.
3. **`npm run rls:verificar`**, com `TENANT_DE_PROVA=<id>`.

O passo 3 não é formalidade, e "o script aplicou sem erro" não prova nada. Ele
confere que a role não é superusuário nem tem `BYPASSRLS` e então **pergunta ao
banco o que ele devolve**: sem tenant declarado tem que vir vazio; com o
tenant, só o que é dele; gravar no nome de outro tem que ser recusado com
`42501`. Sai com código 1 em qualquer falha — serve como portão de deploy.

O `TENANT_DE_PROVA` vem de fora porque a política de `tenants` esconde a lista
de tenants. O verificador não consegue se guiar por uma consulta que a própria
proteção precisa cegar.

**Em desenvolvimento.** O `prisma dev` é Postgres wasm rodando como
superusuário: aceita todo o script e não aplica nada — ali o isolamento parece
funcionar mesmo quando não está. Para ver o sistema como o cliente vai vê-lo,
`npm run dev:rls` sobe o Next contra o Postgres local pela role `app_gestao`,
sem mexer no `.env`.

### 9. Testes

`npm test` — 240 testes cobrindo o que quebra dinheiro ou vaza dado:

- **Dinheiro**: taxa de serviço sobre o valor descontado, desconto limitado ao
  consumo, arredondamento de centavo sem erro de float, leitura do preço
  digitado (o ponto do teclado numérico não pode virar milhar)
- **Impressão**: 48 colunas em todos os papéis, comanda de produção sem preço
- **Estoque**: custo médio ponderado, baixa por ficha técnica, consumo agrupado,
  saldo negativo permitido
- **Isolamento**: dois restaurantes no mesmo banco, com o guarda barrando
  consulta sem filtro, e o encerramento de um cliente que já operou
- **Auditoria**: registro e alteração caem juntos quando a transação falha
- **Transferência**: itens e total seguem a comanda, os tickets acompanham, e
  a mesa de destino herda o estado da conta
- **Acesso ao caixa**: a tela do turno é só de quem opera a gaveta; garçom não
  entra nem pela URL
- **RLS**: o script não envelhece em relação ao schema (tabela nova sem
  política quebra a suíte); e, contra um Postgres de verdade pela role
  `app_gestao`, o isolamento é provado de ponta a ponta — declarado como A,
  pedir explicitamente os dados de B volta vazio; duas consultas simultâneas de
  restaurantes diferentes não se misturam; gravar no nome do vizinho é
  recusado; e nenhuma conexão volta ao pool com transação aberta
- **Mensagens**: regra de negócio volta como valor e chega ao usuário em
  produção; bug de programação continua subindo como exceção
- **Autorização**: a liberação não serve para outra mesa, outro garçom, outro
  tipo de ação, depois de usada nem depois de expirar
- **Ajustes**: valor torto gravado no banco cai no padrão em vez de virar zero
  num cálculo de alerta
- **Caixa**: a gaveta do meio do turno e o apurado do fechamento saem da mesma
  conta, com sangria e suprimento
- **Cancelamento**: devolve ao estoque exatamente o que a venda baixou, sem
  mexer no custo médio, e derruba só o ticket que ficou sem item vivo
- **Freio**: cinco tentativas disparadas ao mesmo tempo custam cinco e não
  uma, e a janela vencida volta a contar do zero em vez de absolver pela
  metade

Os testes de banco rodam contra base separada (`TEST_DATABASE_URL`), recriada
a cada execução.

## O que ainda NÃO protege

### Outros pontos em aberto

- **Token de impressão sem expiração.** Vale até ser trocado à mão.
- **Diário sem retenção definida.** O `AuditLog` cresce para sempre. Um
  restaurante movimentado gera poucas linhas por dia, então demora a doer —
  mas não há política de expurgo, e o que fazer com o diário de um cliente que
  cancela o contrato é decisão em aberto.
- **Sem HTTPS obrigatório em desenvolvimento.** Em produção o Caddy resolve
  (ver `docs/deploy-vps.md`) e o cookie vira `secure` sozinho.

## Antes do primeiro cliente pagante

Em ordem de risco:

1. Expiração do token de impressão
2. Política de retenção e exportação do diário
