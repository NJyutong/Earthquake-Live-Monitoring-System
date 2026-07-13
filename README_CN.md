# 地震实时监测系统

[English README](README.md)

> 本项目聚合第三方地震数据，不是官方应急预警渠道，不应作为涉及人身安全决策的唯一信息来源。

## 中文

### 项目简介

这是一个基于 Node.js、Express 与 WebSocket 的地震数据监测大屏。服务端连接公开地震数据源、统一事件格式并向浏览器实时推送；前端包含桌面端、移动端与 OBS 展示页，可显示地图、历史事件、到时估算、语音提醒和浏览器推送通知。

### 主要功能

- 桌面端、移动端和 OBS 三种界面，移动端可按浏览器 UA 自动切换。
- 多个地震 WebSocket/REST 数据源聚合、标准化、去重、缓存与断线重连。
- 地图显示、高德安全代理、Yandex 按会话配额控制，以及天地图、OpenStreetMap、Esri 等地图选项。
- 基于用户授权定位估算 P 波、S 波到达时间与本地烈度。
- 中英文界面、设备时区、浅色/深色主题、Web Speech 语音提醒。
- Web Push 订阅、通知阈值、区域过滤和可选 Cloudflare Worker 推送中继。
- 调试工具密码保护、接口限流、WebSocket 限制、CSP/HSTS 等基础安全头。
- Cookie 选择、首次导览与浏览器端 AES-GCM 偏好存储。

### 技术栈

- Node.js 18+（使用内置 `fetch`）
- Express 4
- `ws`
- OpenLayers
- `web-push`
- `pinyin-pro`
- 原生 HTML、CSS 与 JavaScript

### 目录结构

```text
.
├─ cloudflare/                 # 可选的 Web Push 中继 Worker
├─ data/.gitkeep              # 空运行目录；实际数据不会提交
├─ docs/DEPLOYMENT.md         # 部署说明
├─ public/                    # 桌面、移动、OBS、Service Worker 与静态资源
├─ scripts/                   # 配置、部署、打包和冒烟检查脚本
├─ .env.example               # 无真实值的环境变量模板
├─ .gitignore
├─ SECURITY.md
├─ package.json
├─ release.json               # 静态资源版本
└─ server.js                  # HTTP、WebSocket、数据源与推送服务
```

本项目没有关系型数据库、Redis 或数据库迁移文件。运行时会在 `data/` 下生成 JSON 缓存、推送订阅、调试审计、地图配额和本地 VAPID 密钥；这些文件均被 Git 忽略。

### 快速开始

```bash
npm ci
cp .env.example .env
npm start
```

Windows PowerShell：

```powershell
npm ci
Copy-Item .env.example .env
npm start
```

默认监听 `http://127.0.0.1:3000`：

- 桌面/自动入口：`/`
- 移动端：`/mobile`
- OBS：`/obs`
- 健康检查：`/health`

没有地图密钥时服务仍可启动，但对应地图会显示未配置提示；没有 CWA Token 时台湾 CWA 数据源不可用。公开部署前应完成下一节中的必要配置并运行 `npm run config-check`。

### 环境变量

复制 `.env.example` 为 `.env`，只填写实际使用的集成。不要提交 `.env`。

| 变量 | 用途 | 是否敏感 |
| --- | --- | --- |
| `HOST`, `PORT` | 本地监听地址与端口 | 否 |
| `PUBLIC_ORIGIN` | 生产环境公开 HTTPS Origin | 否，但不要填写内部地址 |
| `DEBUG_PASSWORD` | 受保护调试工具密码 | 是 |
| `AMAP_JS_KEY` | 高德 Web JS Key | 是/应限制域名 |
| `AMAP_SECURITY_JSCODE` | 高德安全密钥 | 是 |
| `YANDEX_MAPS_API_KEY` | Yandex Maps Key | 是/应限制域名 |
| `GOOGLE_MAPS_API_KEY` | 可选 Google Maps Key | 是/应限制域名 |
| `TIANDITU_TK` | 可选天地图 Token | 是 |
| `ESRI_API_KEY` | 可选 Esri Key | 是 |
| `CWA_API_KEY` | 可选台湾 CWA 开放数据 Token | 是 |
| `CHINA_HISTORY_HOOK_URLS` | 可选历史数据 Webhook URL 列表 | 可能包含内部地址 |
| `VAPID_SUBJECT` | Web Push 联系 URL 或 `mailto:` | 否 |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Web Push VAPID 密钥对 | 私钥敏感 |
| `PUSH_PROXY_URL` | 可选出站 HTTP(S) 代理 | 可能敏感 |
| `PUSH_RELAY_URL`, `PUSH_RELAY_SECRET` | 可选推送中继地址与共享密钥 | 密钥敏感 |
| `TRUST_PROXY`, `TRUST_GEO_HEADERS` | 可信反向代理设置 | 否，错误配置有安全风险 |
| `TLS_KEY_PATH`, `TLS_CERT_PATH` | 可选本地 TLS 文件路径 | 私钥文件敏感 |

其他容量、超时和兼容别名见 `.env.example` 与 `server.js`。不要把密钥放进 JavaScript、Docker Compose、Shell 脚本、README 或 URL 查询参数。

密钥申请应通过各供应商的官方开发者控制台完成：

- 高德/Google/Yandex/天地图/Esri：创建 Web 地图应用，只允许你的生产域名并限制可调用 API。
- 台湾 CWA：在官方开放数据平台申请授权 Token。
- Web Push：可在已安装依赖后运行 `node -e "console.log(require('web-push').generateVAPIDKeys())"`，并把结果只写入服务器 `.env` 或密钥管理服务。

### 首次部署的管理凭证

项目没有管理员用户名或账号系统，也没有固定默认密码。受保护的调试功能只使用 `DEBUG_PASSWORD`：

1. 首次公开部署前，在服务器 `.env` 中设置唯一强密码（8–128 位，包含大写字母、数字和符号）。
2. 将 `.env` 权限限制为服务账号可读，例如 `chmod 600 .env`。
3. 不要复用邮箱、云平台或其他服务的密码。
4. 如果通过界面修改调试密码，运行时会将新值保存在被忽略的 `data/debug-password.json`；请保护该目录且不要上传。

未设置有效密码时，服务会生成随机本地密码并给出保存位置提示，便于本地启动；生产发布检查仍会把缺失的 `DEBUG_PASSWORD` 视为错误。

### 开发与检查

```bash
npm run check          # 所有 JavaScript 文件语法检查
npm run feature-check  # 核心功能冒烟检查
npm run config-check   # 生产配置完整性检查（需要先配置 .env）
npm run security-check # 需要本地服务运行在配置的 SMOKE_BASE_URL
```

项目没有独立的编译、TypeScript 或 Lint 配置；`npm run check` 是当前源码级静态检查。发布脚本为 `npm run package`，它使用白名单打包并拒绝 `.env`、`.git`、依赖和运行态数据。

### 部署

生产环境建议使用 Linux、systemd 和 Nginx/Caddy/Cloudflare Tunnel，只让反向代理访问 Node 端口。完整步骤见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。仓库包含 `scripts/deploy-linux.sh`，会保留服务器已有 `.env` 与 `data/`、安装生产依赖、写入 systemd 服务并执行健康检查。

当前源码没有经过验证的 `Dockerfile` 或 `docker-compose.yml`，因此本发布包不提供未经测试的 Docker 部署方案。

### 数据、隐私与安全

- 用户定位需要浏览器授权，主要用于前端到时/烈度计算；服务端的 IP 定位与调试审计可能产生运行日志数据。
- `data/` 可能包含 IP、会话标识、推送端点、偏好、配额与认证材料，必须按个人数据和密钥处理。
- 定期清理审计、订阅和缓存，限制目录权限，并在备份中加密这些文件。
- 所有生产密钥都应使用供应商的域名/IP/API 限制；疑似泄露后立即撤销并重新生成。
- 安全问题请阅读 [`SECURITY.md`](SECURITY.md)。

### 许可证

当前项目尚未选择开源许可证，发布包不会擅自添加许可证。在维护者添加明确的 `LICENSE` 之前，不应假设获得了复制、修改或分发授权。
