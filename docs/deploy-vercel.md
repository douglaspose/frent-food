# Deploy na Vercel (demonstração)

A Vercel é só para **mostrar o sistema a um cliente**. A produção é a VPS da
DigitalOcean (`deploy-vps.md`), com RLS completo. Aqui é um restaurante só,
então o isolamento entre restaurantes (RLS) fica de fora — menos passos e menos
coisa para dar errado na hora da apresentação.

## Por que não é igual à produção

- **Banco.** A Vercel não hospeda Postgres. Os dados vão para um **Neon**
  (Postgres gerenciado, camada grátis).
- **Sem RLS.** Com um tenant só não há o que isolar. Uma connection string
  serve para tudo, e `DATABASE_URL_SEM_RLS` fica vazia — o `src/lib/db.ts` cai
  na `DATABASE_URL` sozinho. Não se roda `rls:aplicar`.
- **Tempo real degrada.** O SSE de `api/eventos` tem teto de função (60s no
  Hobby, 300s no Pro) e o navegador reconecta a cada corte. O LISTEN/NOTIFY não
  sobrevive ao pooler nem ao serverless, então os avisos caem na entrega em
  memória, por instância. Para o demo é aceitável; na VPS isso não acontece.

## 1. Banco no Neon

1. Crie um projeto no Neon e um banco.
2. Copie a **connection string agrupada** (a com `-pooler` no host), algo como
   `postgresql://user:senha@ep-xxx-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require`.

## 2. Migrações e dados, apontando para o Neon

Da sua máquina, uma vez só (troque pela sua string):

```bash
DATABASE_URL="postgresql://...-pooler...?sslmode=require" npx prisma migrate deploy
DATABASE_URL="postgresql://...-pooler...?sslmode=require" npm run db:seed
```

O seed cria o restaurante de demonstração com os PINs padrão (1111 dono, 2222
gerente, 3333 caixa, 4444 garçom; senha `demo1234`).

## 3. Repositório

As mudanças que a Vercel precisa já estão no repo:

- `postinstall: prisma generate` — sem ela a Vercel não regera o Prisma Client.
- `maxDuration = 300` em `api/eventos` — o teto do SSE.
- `vercel.json` com `regions: ["gru1"]` — São Paulo, para responder rápido.

Basta a `main` estar no GitHub.

## 4. Projeto na Vercel

1. **Import Project** → o repositório `frent-food`. Framework: Next.js (auto).
2. **Environment Variables:**

   | Nome | Valor |
   |---|---|
   | `DATABASE_URL` | a connection string agrupada do Neon |
   | `AUTH_SECRET` | gere com `openssl rand -base64 32` |
   | `NEXT_PUBLIC_APP_URL` | `https://SEU-PROJETO.vercel.app` |

   `DATABASE_URL_SEM_RLS` **não** é definida (o código cai na `DATABASE_URL`).
3. **Deploy.** Se o endereço só for conhecido depois do primeiro deploy, ajuste
   `NEXT_PUBLIC_APP_URL` para a URL real e refaça o deploy.

## 5. Entrar

No endereço `https://SEU-PROJETO.vercel.app`, a tela de login cai no único
restaurante ativo (não há subdomínio que case, e é o que se quer com um cliente
só). PIN **1111** (dono), ou `dono@demo.com` / `demo1234`.

## Quando virar produção

Troca-se o Neon pela VPS da DigitalOcean e liga-se o RLS: `rls:aplicar` cria a
role `app_gestao`, a app passa a conectar por ela, e cada cliente ganha o
próprio subdomínio. O resto do sistema é o mesmo.
