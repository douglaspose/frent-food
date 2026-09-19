# Deploy na VPS Ubuntu (DigitalOcean)

Guia do zero até o sistema no ar. Droplet recomendado para começar:
**Ubuntu 24.04 LTS, 2 vCPU / 4 GB** (o Postgres e o Next.js cabem no mesmo host
com folga para dezenas de restaurantes; separe o banco quando isso apertar).

## 1. Preparar o servidor

Acesse como root e crie um usuário não-root — rodar a aplicação como root é
risco desnecessário:

```bash
adduser deploy && usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
```

Firewall: só SSH e web ficam abertos. **A porta 5432 nunca é exposta.**

```bash
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

## 2. Instalar Docker

```bash
curl -fsSL https://get.docker.com | sh && usermod -aG docker deploy
```

Saia e entre de novo para o grupo `docker` valer.

## 3. Subir o banco

```bash
git clone SEU_REPOSITORIO gestao && cd gestao
cp .env.example .env
```

Edite o `.env`: gere uma senha forte para o Postgres e o `AUTH_SECRET`.

```bash
openssl rand -base64 32
```

Depois:

```bash
docker compose up -d
docker compose ps        # postgres deve estar "healthy"
```

## 4. Migrations e dados iniciais

```bash
npm ci
npx prisma migrate deploy   # aplica migrations sem gerar novas (correto em produção)
npm run db:seed             # só na primeira vez
```

## 5. Subir a aplicação

```bash
npm run build
```

Para manter o processo vivo e reiniciar sozinho após reboot:

```bash
sudo npm install -g pm2
pm2 start npm --name gestao -- start
pm2 startup && pm2 save
```

## 6. HTTPS

Caddy resolve certificado sozinho e é bem mais simples que Nginx + Certbot:

```bash
sudo apt install -y caddy
```

`/etc/caddy/Caddyfile` — o curinga atende os subdomínios de cada restaurante
(`lipao.seudominio.com.br`), que é como o multi-tenant identifica o cliente:

```
seudominio.com.br, *.seudominio.com.br {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl reload caddy
```

O certificado curinga exige validação por DNS — configure o plugin do seu
provedor de DNS no Caddy, ou emita um certificado por subdomínio enquanto
forem poucos clientes.

O Caddy repassa o fluxo de eventos (`/api/eventos`) sem buffer, que é o que o
[tempo real](tempo-real.md) precisa. Se um dia trocar por Nginx, lembre de
`proxy_buffering off` nessa rota — sem isso as telas do salão param de
receber aviso e voltam ao ritmo lento.

## 7. Backup — faça isso antes do primeiro cliente real

Perder o banco de um restaurante é perder o faturamento do mês dele. Backup
diário às 3h, com 14 dias de retenção:

```bash
sudo tee /etc/cron.daily/backup-gestao >/dev/null <<'SH'
#!/bin/sh
cd /home/deploy/gestao || exit 1
docker compose exec -T postgres pg_dump -U gestao gestao_restaurante \
  | gzip > "docker/backups/$(date +%F).sql.gz"
find docker/backups -name '*.sql.gz' -mtime +14 -delete
SH
sudo chmod +x /etc/cron.daily/backup-gestao
```

Envie os dumps para fora da VPS também (DigitalOcean Spaces ou S3) — backup
que mora no mesmo disco que o banco não protege contra perda do droplet.

Teste a restauração pelo menos uma vez:

```bash
gunzip -c docker/backups/2026-09-18.sql.gz | \
  docker compose exec -T postgres psql -U gestao -d gestao_restaurante
```

## Atualizar depois de um deploy

```bash
git pull && npm ci && npx prisma migrate deploy && npm run build && pm2 restart gestao
```

## Acessar o banco da sua máquina

O Postgres só escuta em `127.0.0.1` na VPS. Para conectar de casa, faça um
túnel SSH e aponte a `DATABASE_URL` local para `localhost:5432`:

```bash
ssh -L 5432:localhost:5432 deploy@SEU_IP
```
