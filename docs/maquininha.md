# Maquininha

A porta por onde o aplicativo que roda **dentro da máquina de cartão** fecha
conta e recebe pagamento. O aplicativo mora em outro repositório
(`maquininha-android`); aqui fica o contrato.

## Quem é quem

São duas credenciais, e cada uma responde uma pergunta diferente.

```
Authorization: Bearer <tokenImpressao da unidade>   → de qual restaurante é o aparelho
X-Operador: <token do turno>                        → quem está recebendo
```

O **token da unidade** é o mesmo do agente de impressão (ver
[`impressao.md`](impressao.md)): é credencial e endereço ao mesmo tempo. O
**token do turno** nasce do PIN, dura 12 horas e é assinado com uma chave
própria, derivada do `AUTH_SECRET` com o sufixo `:maquininha` — assim ele não
vale como cookie de navegador, e o cookie do navegador não vale aqui.

Sem o PIN, quem achasse uma maquininha esquecida fecharia contas, e o diário
não saberia dizer quem recebeu o dinheiro.

## POST /api/maquininha/entrar

```json
{ "pin": "3001" }
```

```json
{ "token": "eyJ…", "nome": "Pajé", "cargo": "CAIXA", "unidade": "Matriz" }
```

Só entra quem tem `comanda.receberPagamento`. PIN certo de quem não recebe
pagamento responde **403** dizendo o nome e o cargo — no salão isso vira
"chama o caixa". PIN errado responde 401, e o freio conta por aparelho (não
por IP: várias maquininhas saem pelo mesmo IP do restaurante).

## GET /api/maquininha/mesas

As contas abertas do salão, com o que já foi pago:

```json
{
  "unidade": "Matriz",
  "operador": "Pajé",
  "caixaAberto": true,
  "mesas": [
    {
      "comandaId": "cmu…",
      "numero": 181,
      "mesa": "Mesa 3",
      "nomeCliente": null,
      "pessoas": 4,
      "fechando": true,
      "abertaEm": "2026-09-22T21:35:00.000Z",
      "totalEmCentavos": 4587,
      "recebidoEmCentavos": 1000,
      "faltaEmCentavos": 3587
    }
  ]
}
```

Dinheiro vai em **centavos, inteiro**: dentro do aparelho não existe fração, e
é assim que o valor digitado no teclado já é tratado.

`caixaAberto: false` é um aviso para a maquininha dar **antes** de o cliente
entregar o cartão: sem caixa aberto nenhum pagamento entra.

## GET /api/maquininha/comandas/{id}

A conta de uma mesa: itens, o que já foi pago, o que falta e a divisão por
pessoa (feita aqui, e não no aparelho, para não dar dois números diferentes do
que sai no papel). Conta de outra unidade responde 404, como id inventado.

## POST /api/maquininha/pagamentos

Chega **depois** de a credenciadora aprovar. Aqui não se cobra nada: só se
registra o que aconteceu.

```json
{
  "comandaId": "cmu…",
  "referencia": "5b2f…",
  "forma": "CREDITO",
  "valorEmCentavos": 3587,
  "nsu": "123456",
  "bandeira": "MASTERCARD",
  "finalizar": true
}
```

```json
{
  "ok": true,
  "jaRegistrado": false,
  "forma": "Cartão de Crédito",
  "faltaEmCentavos": 0,
  "quitada": true,
  "finalizada": true
}
```

- **`referencia` é obrigatória e única por restaurante.** É o que faz o reenvio
  de um resultado preso numa queda de rede não virar um segundo pagamento: o
  servidor reconhece a referência e responde `jaRegistrado: true`, sem cobrar
  de novo. A coluna tem índice único — duas tentativas ao mesmo tempo não
  passam as duas.
- **`forma`** é o que a maquininha cobrou (`CREDITO`, `CREDITO_PARCELADO`,
  `DEBITO`, `PIX`, `VOUCHER`). O servidor acha a forma cadastrada pelo **tipo**,
  porque o nome cada casa escolhe o seu ("Cartão de Crédito", "Pix Itaú").
- **`finalizar`** só tem efeito quando o pagamento quita a conta, e só para
  quem tem `comanda.fechar`. Quitando, a conta fecha na mesma chamada: entre
  duas chamadas a rede pode cair, e a mesa ficaria paga e aberta no mapa — o
  estado que faz o salão cobrar o cliente duas vezes.
- Regra de negócio recusada volta **409** com a mensagem pronta para a tela
  ("Falta receber só R$ 12,30", "Nenhum caixa aberto").

## GET /api/maquininha/cardapio

O cardápio do salão, para o garçom lançar da mesa. Exige `comanda.lancarItem`.

É o **mesmo cardápio do PDV**, da mesma tabela: o que a casa cadastra em
Gestão → Cardápio aparece aqui com o preço de lá. Nada é duplicado para a
maquininha — cardápio em dois lugares é cardápio que diverge, e o que diverge
primeiro é o preço.

```json
{
  "unidade": "Jantinha do Lipão",
  "categorias": [
    {
      "id": "cmu…",
      "nome": "Espetos",
      "itens": [
        {
          "cardapioItemId": "cmu…",
          "produtoId": "cmu…",
          "titulo": "Espeto de Alcatra",
          "descricao": null,
          "precoEmCentavos": 1490,
          "esgotado": false,
          "exigePontoCarne": true
        }
      ]
    }
  ]
}
```

Três filtros que não são detalhe:

- **`canal: SALAO`** — a casa pode ter um cardápio de delivery com outro preço
  na mesma unidade, e quem está com a maquininha na mão está no salão.
- **`visivel`** — é como a casa tira um prato da tela sem apagar o cadastro
  nem perder o histórico de quem já pediu.
- **`ordem`** manda na listagem, e a categoria do `CardapioItem` ganha da do
  produto: é com elas que a casa decide o que aparece primeiro.

O esgotado vem marcado, não some: fazer o item desaparecer faz o garçom
procurar na tela um prato que ele sabe que existe.

## POST /api/maquininha/comandas/{id}/itens

A rodada inteira numa chamada só. Exige `comanda.lancarItem`.

```json
{
  "itens": [
    { "cardapioItemId": "cmu…", "quantidade": 2 },
    { "cardapioItemId": "cmu…", "quantidade": 1, "observacao": "sem cebola" },
    {
      "cardapioItemId": "cmu…",
      "quantidade": 1,
      "opcionais": [{ "opcionalId": "cmu…" }, { "opcionalId": "cmu…" }]
    }
  ],
  "enviar": true
}
```

- **`enviar`** (padrão `true`) manda a rodada para a cozinha na mesma chamada.
  Com `false`, os itens ficam no carrinho — que é o mesmo carrinho do PDV, no
  banco, e aparece no tablet do salão.
- **`quantidade`** padrão 1. O teto por lançamento é o ajuste
  `cozinha.qtdMaximaPorLancamento` da unidade.
- **`observacao`** vai para o papel da cozinha, até 200 caracteres. Item com
  observação não agrupa com outro igual: dois chopes, um "sem colarinho", não
  são a mesma linha.
- **`opcionais`** são as escolhas do prato: só os identificadores, porque
  título e preço saem do cadastro e ficam congelados na comanda. O adicional
  entra no preço do item — "picanha 129,90 + bacon 8,00" é uma picanha de
  137,90, e é esse número que a divisão por pessoa e a taxa de serviço usam.
  Escolhas diferentes do mesmo produto são linhas diferentes.
- O **preço nunca vem daqui** — sai do cardápio. Item esgotado, de outro
  restaurante ou fora do cardápio volta **409** com a frase pronta. O mesmo
  vale para as escolhas: opcional de outro produto, grupo obrigatório sem
  escolha e grupo além do máximo voltam 409 dizendo qual grupo
  ("Escolha uma opção em "Ponto da carne".").

### Reenviar é seguro

Cada item leva a **`referencia`** da linha do carrinho na maquininha, única por
restaurante (`ComandaItem.referenciaExterna`). A segunda tentativa encontra o
que já entrou e não lança de novo — o mesmo mecanismo do pagamento.

A conferência é **por item**, não por rodada: uma rodada que entrou pela metade
porque a rede caiu no meio é completada no reenvio, em vez de duplicada.

A resposta diz o que aconteceu de fato:

```json
{ "ok": true, "lancados": 0, "repetidos": 3, "enviados": 0 }
```

`lancados` conta o que entrou **agora**. Num reenvio é zero, e `repetidos` diz
quantos já estavam lá.

A referência nasce com a linha do carrinho no aparelho e não muda entre
tentativas — se mudasse, cada tentativa seria uma rodada nova. Por isso,
também, **item com referência não agrupa** com um pendente igual: somar
quantidade não deixaria rastro da referência, e o reenvio somaria outra vez.
O agrupamento continua valendo para o PDV, onde o "+" é um toque deliberado.

Tudo isso acontece sob a trava da comanda (`SELECT ... FOR UPDATE`), como no
pagamento: dois reenvios simultâneos se serializam, e o segundo encontra a
linha pronta.

## A regra é a mesma do PDV

Receber e finalizar moram em [`src/lib/conta.ts`](../src/lib/conta.ts), e
lançar item e mandar a rodada para a cozinha, em
[`src/lib/carrinho.ts`](../src/lib/carrinho.ts). Tanto o navegador quanto a
maquininha passam por lá: trava na comanda, teto do que falta, taxa da
adquirente congelada no pagamento, preço vindo do cardápio, baixa de estoque e
numeração de ticket sob trava, ticket pronto saindo do KDS, mesa voltando ao
salão. Duas cópias da mesma regra é como uma delas passa a aceitar o que a
outra recusa.

## Migração

As colunas de referência entraram em
`prisma/migrations/20260923000000_pagamento_da_maquininha` (pagamento) e
`prisma/migrations/20261013000000_referencia_do_lancamento` (lançamento). Em produção,
`npm run db:deploy`.
