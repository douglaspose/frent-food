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
banco. Esconder o botão na interface **não é segurança** — é conveniência. A
prova disso está em `caixa.fechar`: a tela do caixa mostra o botão para todo
mundo, e um garçom que clica recebe a recusa do servidor.

Chaves em uso: `comanda.abrir`, `comanda.lancarItem`, `comanda.cancelarItem`,
`comanda.aplicarDesconto`, `comanda.receberPagamento`, `comanda.fechar`,
`caixa.abrir`, `caixa.fechar`, `produto.editar`, `cardapio.editar`,
`usuario.editar`, `mesa.transferir`, `auditoria.ver`, `unidade.configurar`.

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

### 7. Testes

`npm test` — 188 testes cobrindo o que quebra dinheiro ou vaza dado:

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
- **RLS**: o script não envelhece em relação ao schema — tabela nova sem
  política quebra a suíte
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

Os testes de banco rodam contra base separada (`TEST_DATABASE_URL`), recriada
a cada execução.

## O que ainda NÃO protege

### RLS no Postgres — script completo, aplicação ainda não declara o tenant

`prisma/rls.sql` cobre hoje **todas** as tabelas: as 27 que carregam
`tenantId`, as 9 tabelas-filhas (pela política do pai) e a própria `tenants`.
Ele **não roda junto com as migrations**, de propósito.

Hoje o isolamento é garantido pela aplicação: as actions filtram, o guarda
verifica, os testes provam. É bom, mas é uma linha só. Se uma consulta nova
escapar do guarda, o banco entrega os dados.

#### O que falta

Uma coisa só, e é a difícil: **a aplicação precisa declarar o tenant em cada
requisição**. A política lê `app.tenant_id`; sem isso, ligar o script deixa
todas as consultas vazias e o restaurante para.

A declaração tem que valer para a mesma conexão que roda a consulta, e o pool
do Prisma não garante isso entre consultas soltas — então implica envelopar as
consultas de cada requisição numa transação:

```sql
select set_config('app.tenant_id', $1, true);   -- true = LOCAL, morre no commit
```

Não é `SET LOCAL app.tenant_id = $1`: **`SET` não aceita parâmetro**, e montar
a string à mão abriria injeção no lugar exato que deveria proteger.

#### Como ligar, na ordem

1. `psql < prisma/rls.sql` — cria a role `app_gestao` (NOBYPASSRLS) e as
   políticas.
2. Trocar a `DATABASE_URL` da aplicação para a role `app_gestao`.
3. Implementar o item acima na aplicação.
4. **`npm run rls:verificar`** com a URL da aplicação.

O passo 4 não é formalidade. Ele conecta, confere que a role não é
superusuário nem tem `BYPASSRLS`, e então **pergunta ao banco o que ele
devolve**: sem tenant declarado tem que vir vazio; com o tenant, só o que é
dele; gravar no nome de outro tem que ser recusado com `42501`. Sai com código
1 em qualquer falha — serve como portão de deploy.

#### Por que o verificador existe

Porque "o script aplicou sem erro" não prova nada. No banco de
desenvolvimento (`prisma dev`, que é Postgres compilado para wasm), todo o
script é aceito **e nenhuma política é aplicada**: a conexão ignora o usuário
informado — aceita até senha errada — e roda tudo como superusuário, que
atravessa RLS por definição. Rodar `npm run rls:verificar` ali devolve 11
falhas, e é o comportamento correto.

Consequência prática: **RLS não pode ser testado em desenvolvimento**. A
verificação de verdade acontece na VPS, com o Postgres do
`docker-compose.yml`, e leva um minuto.

O teste `tests/rls.test.ts` cobre a parte que dá para provar aqui: que o
script não envelheceu em relação ao schema. Tabela nova com `tenantId` que não
aparecer no script quebra a suíte — foi assim que `notas_fiscais` e
`perfis_fiscais` apareceram, e elas guardam as notas fiscais do cliente.

### Outros pontos em aberto

- **Limite de tentativa em memória.** O freio de 5 tentativas por 15 minutos
  (`src/lib/limite-tentativas.ts`) vive no processo: reiniciar a aplicação
  zera a contagem, e com duas instâncias cada uma conta a sua. Resolve o
  ataque preguiçoso, não o paciente.
- **Token de impressão sem expiração.** Vale até ser trocado à mão.
- **Diário sem retenção definida.** O `AuditLog` cresce para sempre. Um
  restaurante movimentado gera poucas linhas por dia, então demora a doer —
  mas não há política de expurgo, e o que fazer com o diário de um cliente que
  cancela o contrato é decisão em aberto.
- **Sem HTTPS obrigatório em desenvolvimento.** Em produção o Caddy resolve
  (ver `docs/deploy-vps.md`) e o cookie vira `secure` sozinho.

## Antes do primeiro cliente pagante

Em ordem de risco:

1. Declarar o tenant na conexão e ligar o RLS (script e verificador prontos,
   ver acima) — a última rede, para o dia em que uma consulta escapar do
   guarda de aplicação
2. Freio de login compartilhado entre instâncias (hoje é por processo)
3. Expiração do token de impressão
4. Política de retenção e exportação do diário
