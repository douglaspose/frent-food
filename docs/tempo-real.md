# Tempo real

Como o mapa de mesas e o KDS se atualizam sem ninguém apertar F5.

## O que havia antes

Cada tela recarregava sozinha num relógio fixo: o KDS a cada 10 segundos, o
mapa a cada 15. Isso tem dois custos que crescem juntos com o cliente:

- **Banco.** Cada recarga é uma rodada de consultas por aparelho. Dez tablets
  parados no salão davam ~600 rodadas por minuto mesmo sem nada acontecer. Foi
  o que derrubou o Postgres de desenvolvimento mais de uma vez.
- **Atraso.** Um espeto que sai da chapa podia levar 10 segundos para aparecer
  como pronto, e um cliente que chama o garçom pelo QR esperava até 15. O
  cliente sente cada um desses segundos.

## O desenho

```
ação do garçom / cliente
        │
        ▼
  server action ──► publicar(unidadeId, motivo)
                         │
             ┌───────────┴───────────┐
             ▼                       ▼
     entrega em memória        pg_notify no Postgres
     (este processo)           (os outros processos)
             │                       │
             └───────────┬───────────┘
                         ▼
              /api/eventos  (SSE, um por aba)
                         │
                         ▼
              router.refresh() no navegador
```

**Por que SSE e não WebSocket.** O tráfego é de mão única: o servidor avisa, o
navegador só recarrega. WebSocket traria um protocolo, uma biblioteca e um
processo a manter para um canal de volta que ninguém usa. SSE é HTTP comum,
reconecta sozinho e atravessa qualquer proxy que já esteja no caminho.

**Por que duas entregas.** A de memória atende quem está no mesmo processo e
funciona sempre. A do Postgres alcança as outras instâncias — é o que faz o
sistema continuar correto quando o deploy crescer para mais de um contêiner.
Cada evento tem um `id`, e quem publicou ignora a própria cópia que volta pelo
banco, senão a tela recarregaria duas vezes por ação.

**Por que o banco e não um EventEmitter.** O emissor só vale dentro de um
processo. Com dois contêineres, metade dos tablets pararia de receber aviso —
uma falha silenciosa, que só apareceria no sábado cheio.

## O piso periódico continua

Mesmo com o fluxo aberto, cada tela ainda recarrega sozinha:

| Estado | Intervalo |
|---|---|
| Recebendo eventos | 60s |
| Sem ligação | 15s |

É o que conserta um aviso perdido entre uma reconexão e outra. Sem esse piso,
uma queda de rede no restaurante congelaria a tela sem avisar ninguém — e um
KDS congelado é idêntico a um KDS sem pedidos.

A tela também não recarrega enquanto a aba está escondida: recarrega uma vez
quando volta a aparecer. Aba escondida não desenha nada, e gastar consulta
para pintar o que ninguém vê é o hábito que este trabalho veio desfazer.

## O selo

O ponto ao lado do título diz em que estado a tela está:

- **verde, "ao vivo"** — recebendo do servidor
- **âmbar piscando, "reconectando"** — sem ligação, tentando de novo
- **cinza, "sem tempo real"** — desistiu (sessão expirada, por exemplo); só o
  piso de 15s atualiza

## Quando o banco não entrega NOTIFY

Na primeira assinatura a aplicação sonda o banco: publica um aviso pelo pool e
espera recebê-lo pela conexão que escuta. Se não chegar em 3 segundos, ela
fecha a conexão do ouvinte, para de gastar uma consulta por ação com
`pg_notify` e registra:

```
[eventos] este banco não entrega NOTIFY: o tempo real vale só dentro deste processo.
```

É o caso do banco de desenvolvimento do `prisma dev`. Com o Postgres do
`docker-compose.yml` — o mesmo da VPS — a sonda passa e a entrega entre
processos funciona.

Se o banco estiver fora do ar, o ouvinte tenta cinco vezes com recuo
progressivo, desiste, e reavalia em cinco minutos. O objetivo é não ficar sem
tempo real até o próximo deploy só porque o banco reiniciou por trinta
segundos.

## Atrás de proxy

A rota já manda `X-Accel-Buffering: no`. Num nginx que ignore o cabeçalho,
acrescente no bloco da aplicação:

```nginx
location /api/eventos {
    proxy_pass http://app:3000;
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

Sem isso o proxy segura o fluxo no buffer e os eventos chegam em lote — ou não
chegam. O Caddy do [deploy](deploy-vps.md) não precisa de ajuste.

## Limites conhecidos

- **Cada aba segura uma conexão aberta.** São baratas, mas contam: vinte
  tablets são vinte conexões HTTP paradas. O ouvinte do Postgres é um só,
  compartilhado por todas.
- **O evento não carrega o dado, só o aviso.** A tela recebe "mudou" e vai
  buscar tudo de novo. É mais simples e mais difícil de errar; se um dia o
  volume pedir, dá para mandar o pedido junto e atualizar só o card.
- **Não há fila.** Aviso perdido é aviso perdido — quem conserta é o piso
  periódico, de propósito: uma fila durável aqui custaria mais do que o
  problema que resolve.
