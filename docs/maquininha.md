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

## A regra é a mesma do PDV

Receber e finalizar moram em [`src/lib/conta.ts`](../src/lib/conta.ts), e tanto
o caixa no navegador quanto a maquininha passam por lá: trava na comanda, teto
do que falta, taxa da adquirente congelada no pagamento, ticket pronto saindo
do KDS, mesa voltando ao salão. Duas cópias da mesma regra é como uma delas
passa a aceitar o que a outra recusa.

## Migração

A coluna da referência entrou em
`prisma/migrations/20260923000000_pagamento_da_maquininha`. Em produção,
`npm run db:deploy`.
