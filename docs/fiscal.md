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

### 2. Contingência offline — **o furo mais sério**

Hoje, quando o emissor não responde, a nota é marcada como `CONTINGENCIA` e a
venda segue. **Mas não existe a rotina que a transmite quando o serviço
volta** — essas notas ficam paradas para sempre.

O que falta:

- Tarefa periódica que busca notas em `CONTINGENCIA` e tenta reemitir
- Marcar a chave com `tpEmis=9` na emissão offline (o código da chave já
  suporta, ver `TP_EMIS.CONTINGENCIA_OFFLINE`)
- Prazo legal de transmissão (24h na maioria das UFs) e alerta quando estourar

Sem isso, um dia de SEFAZ instável vira um passivo fiscal silencioso.

### 3. Menores, mas necessários antes de produção

- **Inutilização de numeração**: número reservado que nunca virou nota precisa
  ser inutilizado na SEFAZ, senão fica buraco na sequência
- **Janela de cancelamento**: a SEFAZ aceita cancelar por ~30 min após a
  autorização (varia por UF). A tela ainda oferece cancelar sem checar o prazo
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
