---
name: teste-do-dia
description: Dispara uma rodada completa do testador de operação do frent-food — dia de vendas acima do normal simulado de ponta a ponta, ataques deliberados, passeio pelas telas, correção dos problemas num branch com pull request e relatório. Use quando o usuário pedir o "teste do dia", "rodar o testador", "caçar bugs no sistema inteiro" ou digitar /teste-do-dia.
---

Lance o agente `testador-de-operacao` (definido em `.claude/agents/testador-de-operacao.md`) com a ferramenta Agent, `subagent_type: "testador-de-operacao"`, em segundo plano. O agente já carrega o protocolo inteiro; o pedido a ele é curto:

> Rode a rodada completa de hoje, do passo 1 ao 7 do seu roteiro.

Se o usuário passou algo junto com o comando (por exemplo "/teste-do-dia só os ataques", "com 500 comandas", "só relatório, sem corrigir"), acrescente ao pedido literalmente.

Enquanto ele roda, avise o usuário em uma frase que a rodada começou, que leva de uma a três horas e que você avisa quando terminar. Não repita o trabalho dele nem invente o resultado antes da notificação chegar.

Quando o agente terminar, repasse ao usuário: o resumo, o link do pull request (se houver) e o caminho do relatório. Se ele achou algo crítico — dinheiro, isolamento entre restaurantes, operação parada —, diga isso primeiro.
