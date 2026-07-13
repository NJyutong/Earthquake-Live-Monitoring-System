# Deployment / 部署

## 中文

### 架构建议

```text
Browser / OBS
      │ HTTPS + WebSocket
Reverse proxy / CDN
      │ HTTP on loopback or private network
Node.js service
      ├─ public feeds
      └─ private runtime data/ and .env
```

生产环境不要直接暴露 Node 端口。反向代理应终止 TLS、转发 WebSocket，并对动态路由禁用缓存。

### 准备配置

```bash
cp .env.example .env
chmod 600 .env
npm ci --omit=dev
npm run config-check
```

必须为公开部署设置：

- `PUBLIC_ORIGIN=https://your-domain.example`
- 唯一的强 `DEBUG_PASSWORD`
- 实际启用地图所需的 Key/安全码

CWA、Web Push、中继、代理和本地 TLS 均为可选。不要把 `.env` 放进 ZIP、镜像层、systemd unit、Shell 历史或仓库。

### 使用随附 systemd 部署脚本

先创建最小权限系统账号，并将发布 ZIP 放到服务器上的受控目录：

```bash
sudo useradd --system --home /opt/earthquake-system --shell /usr/sbin/nologin earthquake
sudo ZIP_PATH=/absolute/path/earthquake-system-github-release.zip \
  APP_DIR=/opt/earthquake-system \
  SERVICE_USER=earthquake \
  SERVICE_NAME=earthquake-system \
  bash scripts/deploy-linux.sh
```

首次运行会在交互式终端中请求生产配置并隐藏敏感输入。更新部署会保留服务器已有 `.env` 与 `data/`。如需重新输入配置，增加 `RECONFIGURE=1`。脚本要求 root，并会拒绝危险的应用目录。

### Nginx 示例

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.example;

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 90s;
    }
}
```

只有 Nginx 是唯一入口时才在 `.env` 中配置合适的 `TRUST_PROXY`。防火墙应阻止公网访问 `3000`。

### Web Push 与 Cloudflare Worker（可选）

服务端可以直接发送 Web Push，也可以设置一个出站代理，或使用 `cloudflare/push-relay-worker.mjs`。只能选择一种出站模式。

部署 Worker 时把共享密钥写入平台 Secret，不要写入 `wrangler.toml`：

```bash
cd cloudflare
cp wrangler.toml.example wrangler.toml
npx wrangler secret put PUSH_RELAY_SECRET
npx wrangler deploy
```

然后只在服务器 `.env` 设置 `PUSH_RELAY_URL` 与同一份 `PUSH_RELAY_SECRET`。

### 验证与维护

```bash
curl -fsS http://127.0.0.1:3000/health
npm run check
npm run feature-check
node scripts/live-release-check.js https://your-domain.example
```

运行态 `data/` 可能包含推送订阅、IP 审计、配额会话和私钥。备份前加密，设置保留期，恢复后检查权限。轮换 VAPID 私钥会使现有订阅失效。

### Docker 状态

当前项目没有经过验证的 Dockerfile 或 Compose 配置。若未来添加容器部署，必须把 `.env`、TLS 私钥和 `data/` 作为外部 Secret/持久卷注入，并为镜像构建增加独立检查。

## English

### Recommended architecture

```text
Browser / OBS
      │ HTTPS + WebSocket
Reverse proxy / CDN
      │ HTTP on loopback or private network
Node.js service
      ├─ public feeds
      └─ private runtime data/ and .env
```

Do not expose the Node port directly. Terminate TLS at the reverse proxy, forward WebSocket upgrades, and disable caching for dynamic routes.

### Prepare configuration

```bash
cp .env.example .env
chmod 600 .env
npm ci --omit=dev
npm run config-check
```

A public deployment requires:

- `PUBLIC_ORIGIN=https://your-domain.example`
- A unique strong `DEBUG_PASSWORD`
- Credentials for every enabled map provider

CWA, Web Push, relay, proxy, and local TLS settings are optional. Never put `.env` in a ZIP, image layer, systemd unit, shell history, or repository.

### Included systemd deployment script

Create a least-privilege service account and place the release ZIP in a controlled server directory:

```bash
sudo useradd --system --home /opt/earthquake-system --shell /usr/sbin/nologin earthquake
sudo ZIP_PATH=/absolute/path/earthquake-system-github-release.zip \
  APP_DIR=/opt/earthquake-system \
  SERVICE_USER=earthquake \
  SERVICE_NAME=earthquake-system \
  bash scripts/deploy-linux.sh
```

The first interactive run asks for production settings and hides secret input. Updates preserve the server's existing `.env` and `data/`. Add `RECONFIGURE=1` to enter settings again. The script requires root and rejects unsafe application directories.

### Nginx example

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.example;

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 90s;
    }
}
```

Configure `TRUST_PROXY` only when Nginx is the sole ingress. Block public access to port `3000` at the firewall.

### Web Push and Cloudflare Worker (optional)

The server can send Web Push directly, through one outbound proxy, or through `cloudflare/push-relay-worker.mjs`. Select only one outbound mode.

Store the shared secret as a platform Secret, never in `wrangler.toml`:

```bash
cd cloudflare
cp wrangler.toml.example wrangler.toml
npx wrangler secret put PUSH_RELAY_SECRET
npx wrangler deploy
```

Then set `PUSH_RELAY_URL` and the matching `PUSH_RELAY_SECRET` only in the server `.env`.

### Verification and maintenance

```bash
curl -fsS http://127.0.0.1:3000/health
npm run check
npm run feature-check
node scripts/live-release-check.js https://your-domain.example
```

Runtime `data/` may contain push subscriptions, IP audit records, quota sessions, and private keys. Encrypt backups, apply retention limits, and restore least-privilege permissions. Rotating the VAPID private key invalidates existing subscriptions.

### Docker status

There is no tested Dockerfile or Compose configuration. A future container deployment must inject `.env`, TLS private keys, and `data/` through external secrets or persistent volumes and add a dedicated image validation workflow.

