# Impressão

O contrato entre o servidor e o agente que fala com as impressoras do salão.

## Quem faz o quê

O servidor não enxerga impressora. Ele enfileira trabalho já formatado e espera
alguém vir buscar. Quem busca é o **agente**: um programa que roda numa máquina
dentro do restaurante — a mesma que enxerga as impressoras da rede — e que não
mora neste repositório.

```
server action ──► fila_impressao (conteudo pronto, 48 colunas)
                        │
                        │  GET /api/impressao   (a cada poucos segundos)
                        ▼
                     agente ──► impressora térmica
                        │
                        │  POST /api/impressao  (saiu / falhou)
                        ▼
                  fila_impressao (IMPRESSO | PENDENTE | ERRO)
```

O agente autentica com o **token da unidade** no header, não com sessão: é um
serviço, não uma pessoa. O token é credencial e endereço ao mesmo tempo — é ele
que diz de qual restaurante é a chamada, e um token não enxerga nem confirma
trabalho de outra unidade.

```
Authorization: Bearer <tokenImpressao da unidade>
```

## GET /api/impressao

Devolve até 20 trabalhos pendentes, do mais antigo para o mais novo.

```json
{
  "unidade": "Jantinha do Lipão",
  "marca": {
    "escpos": "G2EBHXYwADAAwAD...",
    "largura": 384,
    "altura": 192
  },
  "trabalhos": [
    {
      "id": "cmu…",
      "tipo": "CUPOM",
      "titulo": "Comprovante · mesa 7",
      "conteudo": "          JANTINHA DO LIPÃO\n…",
      "comMarca": true,
      "impressora": { "nome": "Caixa", "conexao": "rede", "endereco": "192.168.0.50:9100" }
    }
  ]
}
```

`conteudo` é texto puro, já quebrado em 48 colunas — a largura da fonte padrão
de uma térmica de 80mm. O agente escreve como está e corta.

## A logomarca

`marca` é a logo da casa já convertida para o que a impressora entende, e vem
**uma vez por resposta**, não dentro de cada trabalho: são os mesmos ~9 KB para
o lote inteiro.

- `escpos` — base64 de uma sequência pronta: `ESC a 1` (centraliza), `GS v 0`
  com o bitmap de 1 bit, `ESC a 0` (volta à esquerda) e uma quebra de linha.
  O agente **decodifica o base64 e escreve os bytes na impressora**, sem
  precisar de biblioteca de imagem.
- `largura` / `altura` — em pontos, só para diagnóstico.
- É `null` quando a casa não cadastrou a versão de fundo claro, e também quando
  nenhum trabalho do lote leva marca.

Cada trabalho diz se leva marca em `comMarca`. Levam **CUPOM** e
**CONFERENCIA** — os dois papéis que o cliente lê ou leva para casa. Não levam
o ticket da cozinha, o cancelamento nem o aviso de transferência: ninguém de
fora os vê, e a logo custa dois centímetros de papel e um segundo de impressão
em cada pedido, o que numa noite cheia é bobina inteira. A NFC-e também fica de
fora — o layout dela é ditado pela SEFAZ.

A ordem é a marca **antes** do conteúdo:

```js
if (trabalho.comMarca && resposta.marca) {
  impressora.write(Buffer.from(resposta.marca.escpos, "base64"));
}
impressora.write(Buffer.from(trabalho.conteudo, "latin1"));
```

`comMarca` é um campo novo e um booleano de propósito: o agente que ainda não
souber de marca nenhuma ignora os dois campos e continua imprimindo o texto
exatamente como sempre imprimiu.

### Por que a versão de fundo claro

A casa cadastra duas versões da logo (veja **Configurações → Logomarca**): uma
para fundo claro e outra para escuro. O papel térmico é branco e a impressora
só queima — não existe tinta branca. Quem serve aqui é a de traço escuro, a
mesma que vai no topo do painel de gestão. A de fundo escuro sairia como um
borrão preto.

### Por que `GS v 0`

É o comando de raster que toda térmica de 80mm entende, incluindo as clones que
são a maior parte do mercado brasileiro. As alternativas mais novas (`GS ( L`)
são mais capazes e menos suportadas — e o que se imprime aqui é uma logo, não
um gráfico.

A conversão está em [`src/lib/termica.ts`](../src/lib/termica.ts): achata o
fundo transparente sobre branco (senão ele sai queimado), reduz para no máximo
384 pontos de largura — dois terços dos 576 do papel, que é a proporção dos
cupons que as casas imprimem —, converte para cinza e aplica difusão de erro
Floyd–Steinberg. O corte seco resolveria texto, mas transformaria a sombra de
um desenho em mancha chapada; a difusão devolve o cinza como textura.

## POST /api/impressao

O agente confirma o que saiu, ou relata a falha.

```json
{ "id": "cmu…", "ok": true }
{ "id": "cmu…", "ok": false, "erro": "papel preso" }
```

Falha volta para `PENDENTE` e é tentada de novo, até a quinta, quando vira
`ERRO`: papel preso não pode entupir a fila para sempre.

## O que ainda não existe

Nenhum agente roda hoje. O contrato acima é o que o servidor já entrega — foi
conferido chamando o endpoint com um token de verdade —, mas a logo só aparece
no papel quando houver um agente que leia `comMarca` e `marca`.
