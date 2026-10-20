# NFC-e — estado atual e o que falta

**Nenhuma nota emitida hoje tem valor fiscal.** O emissor está em modo
`SIMULADO`: gera chave de acesso válida e percorre todo o fluxo, mas não assina
nem transmite nada à SEFAZ.

## O que já funciona

| | |
|---|---|
| ✅ | Chave de acesso (44 dígitos, DV módulo 11), conferida contra implementação independente |
| ✅ | Tributação nos dois regimes: CSOSN no Simples, CST no Normal |
| ✅ | Perfis de tributação por unidade, aplicáveis em massa aos produtos |
| ✅ | NCM e CEST no cadastro de produto |
| ✅ | Códigos de pagamento (tPag) mapeados: 01 dinheiro, 03 crédito, 04 débito, 17 Pix |
| ✅ | Emissão automática ao fechar a comanda, sem travar a venda se falhar |
| ✅ | DANFE em 48 colunas com QR Code impresso via ESC/POS |
| ✅ | Cancelamento com justificativa mínima de 15 caracteres |
| ✅ | Tela de gestão: configuração, perfis, notas, reemissão |
| ✅ | Alertas antes do movimento: produto sem NCM, produto sem perfil |

**A taxa de serviço fica fora da nota.** Ela é gorjeta, não mercadoria;
incluí-la faria o restaurante pagar imposto sobre o dinheiro do garçom. O DANFE
registra o valor cobrado à parte por escrito.

## O que falta — fora do código

1. **Certificado digital A1** (e-CNPJ do restaurante, arquivo `.pfx` + senha)
2. **Credenciamento como emissor de NFC-e** na SEFAZ do estado
3. **CSC + ID do CSC**, fornecidos pela SEFAZ no credenciamento
4. **Contrato com o gateway** (Focus NFe, PlugNotas, NFe.io, TecnoSpeed)

## O que falta — no código

### 1. Adaptador do gateway

Implementar a interface `Emissor` de `src/lib/fiscal/tipos.ts`:

```ts
export interface Emissor {
  readonly nome: string;
  emitir(nota: NotaParaEmitir): Promise<ResultadoEmissao>;
  cancelar(chaveAcesso: string, motivo: string): Promise<ResultadoCancelamento>;
}
```

Use `emissor-simulado.ts` como referência — ele já cobre todos os casos de
retorno. Depois registre o novo emissor no `switch` de `emissorDa()` em
`src/lib/fiscal/emitir.ts`.

O trabalho real é traduzir `NotaParaEmitir` para o payload do gateway. Os
campos já estão todos lá, inclusive tributação por item.

### 2. Contingência offline — **pronta** (20/10/2026)

Quando o emissor não responde, a venda não para: a nota nasce em contingência
offline, e é transmitida depois. O que existe hoje:

- A chave é calculada **por nós**, com `tpEmis=9` (`TP_EMIS.CONTINGENCIA_OFFLINE`)
  — o emissor não respondeu, não há de quem esperar chave.
- O documento inteiro fica guardado em `notas_fiscais.emitida`. É o que permite
  transmitir **a mesma nota**: a data de emissão e o código numérico entram no
  cálculo da chave que já foi impressa, e remontar da comanda daria outra.
- `transmitirContingencias()` em `src/lib/fiscal/contingencia.ts` varre a fila
  da unidade, da mais velha para a mais nova. Autorizada: grava protocolo, XML e
  enfileira o DANFE. Recusada ou denegada: sai da contingência com o motivo, para
  a mão de gente. Indisponível: para o lote ali — as outras receberiam a mesma
  resposta.
- O prazo legal (`PRAZO_DE_TRANSMISSAO_HORAS`, 24h) é contado em
  `resumoDaContingencia()`, e **Gestão → Fiscal** avisa em cima da tela quantas
  esperam, há quanto tempo a mais velha, e quantas já venceram.

**Duas portas** chamam a rotina:

1. O botão "Transmitir agora" na tela Fiscal (pede `unidade.configurar`). Quem
   está no restaurante sabe antes de qualquer agendador que a internet voltou.
2. `POST /api/fiscal/contingencia`, com o **token do aparelho** no
   `Authorization: Bearer` — a mesma credencial da fila de impressão. Varre a
   unidade daquele token; quem tem filial agenda uma chamada por filial.

   ```bash
   # a cada 10 minutos, na VPS
   */10 * * * * curl -fsS -X POST https://SEU-DOMINIO/api/fiscal/contingencia \
     -H "Authorization: Bearer TOKEN_DO_APARELHO" >/dev/null
   ```

   Responde 200 mesmo com a SEFAZ fora, e o corpo conta o que houve
   (`autorizadas`, `recusadas`, `aindaParadas`, `esperando`): um 5xx faria o
   agendador tratar "o governo está fora" como "esta porta quebrou".

**O que sobra para o adaptador do gateway:** se a autorização sair e só a
*resposta* se perder, a nota fica autorizada na SEFAZ e em contingência aqui — a
transmissão seguinte mandaria a mesma chave e levaria "duplicidade". O adaptador
precisa **consultar pela chave** antes de retransmitir. Com o emissor simulado
isso não acontece, e por isso não está resolvido ainda.

**Notas anteriores a 20/10/2026** que ficaram em contingência não guardaram o
documento: a rotina as conta à parte (`semDocumento`) e não tenta transmiti-las.
A tela diz isso, e quem resolve é o contador.

### 3. Menores, mas necessários antes de produção

- **Inutilização de numeração**: número reservado que nunca virou nota precisa
  ser inutilizado na SEFAZ, senão fica buraco na sequência
- **Janela de cancelamento**: a SEFAZ aceita cancelar por ~30 min após a
  autorização (varia por UF). A tela ainda oferece cancelar sem checar o prazo
- **DANFE da contingência no ato da venda**: a lei manda entregar o cupom ao
  cliente na hora, com a observação de emissão em contingência. Hoje o papel só
  sai quando a nota é autorizada — na venda offline o cliente sai sem cupom
- **CSC guardado em texto puro** no banco. Deveria ser cifrado em repouso
- **Numeração sob concorrência**: hoje é `max + 1`. No volume de um restaurante
  dá conta; numa rede com muitos caixas simultâneos, vira uma sequence no
  Postgres
- **Guarda do XML por 5 anos**: o XML autorizado é salvo no banco, mas não há
  rotina de exportação para o contador

## Para retomar

1. Configure em **Gestão → Fiscal**: Inscrição Estadual, regime, série, CSC
2. Implemente o adaptador do gateway contratado
3. Troque `emissorFiscal` da unidade de `SIMULADO` para o gateway
4. Teste em **homologação** com notas reais antes de virar para produção
5. Só então mude `ambienteFiscal` para `PRODUCAO` — a tela impede fazer isso
   enquanto o emissor for o simulado

Os testes de `src/lib/fiscal/` cobrem chave, tributação e montagem da nota.
Eles continuam valendo com qualquer emissor.
