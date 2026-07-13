# Earthquake Live Monitoring System

[Chinese README](README_CN.md)

> This community project aggregates third-party earthquake feeds. It is not an official emergency-warning channel and must not be the only source used for life-safety decisions.

## English

### Overview

This is a Node.js, Express, and WebSocket earthquake monitoring dashboard. The server connects to public earthquake feeds, normalizes events, and streams updates to browsers. The frontend provides desktop, mobile, and OBS views with maps, history, arrival-time estimates, voice alerts, and browser push notifications.

### Features

- Desktop, mobile, and OBS interfaces, with optional user-agent based mobile routing.
- Multiple WebSocket/REST earthquake feeds with normalization, deduplication, caching, and reconnection.
- Map display, a secured AMap proxy, session-based Yandex quota controls, and Tianditu, OpenStreetMap, Esri, and other map options.
- P-wave, S-wave, and local-intensity estimates based on user-authorized location.
- Chinese/English UI, device time zones, light/dark themes, and Web Speech alerts.
- Web Push subscriptions, notification thresholds, regional filters, and an optional Cloudflare Worker relay.
- Password-protected debug tools, endpoint rate limits, WebSocket limits, and baseline CSP/HSTS headers.
- Cookie consent, first-run guidance, and browser-side AES-GCM preference storage.

### Stack

- Node.js 18+ (the server uses built-in `fetch`)
- Express 4
- `ws`
- OpenLayers
- `web-push`
- `pinyin-pro`
- Plain HTML, CSS, and JavaScript

### Repository layout

```text
.
├─ cloudflare/                 # Optional Web Push relay Worker
├─ data/.gitkeep              # Empty runtime directory; generated data is ignored
├─ docs/DEPLOYMENT.md         # Deployment guide
├─ public/                    # Desktop, mobile, OBS, service workers, and assets
├─ scripts/                   # Configuration, deployment, packaging, and smoke checks
├─ .env.example               # Secret-free environment template
├─ .gitignore
├─ SECURITY.md
├─ package.json
├─ release.json               # Static asset version
└─ server.js                  # HTTP, WebSocket, feed, and push service
```

The project does not use a relational database, Redis, or database migrations. At runtime it creates JSON caches, push subscriptions, debug audit records, map quota state, and local VAPID keys under `data/`; Git ignores all of these files.

### Quick start

```bash
npm ci
cp .env.example .env
npm start
```

Windows PowerShell:

```powershell
npm ci
Copy-Item .env.example .env
npm start
```

The default listener is `http://127.0.0.1:3000`:

- Desktop/automatic entry: `/`
- Mobile: `/mobile`
- OBS: `/obs`
- Health check: `/health`

The service starts without map credentials, but the related map providers show a clear configuration message. The Taiwan CWA feed is unavailable without a CWA token. Complete the production configuration below and run `npm run config-check` before publishing the service.

### Environment variables

Copy `.env.example` to `.env` and configure only the integrations you use. Never commit `.env`.

| Variable | Purpose | Sensitive |
| --- | --- | --- |
| `HOST`, `PORT` | Local bind address and port | No |
| `PUBLIC_ORIGIN` | Public production HTTPS origin | No, but do not expose internal hosts |
| `DEBUG_PASSWORD` | Protected debug-tool password | Yes |
| `AMAP_JS_KEY` | AMap Web JS key | Yes/domain-restricted |
| `AMAP_SECURITY_JSCODE` | AMap security code | Yes |
| `YANDEX_MAPS_API_KEY` | Yandex Maps key | Yes/domain-restricted |
| `GOOGLE_MAPS_API_KEY` | Optional Google Maps key | Yes/domain-restricted |
| `TIANDITU_TK` | Optional Tianditu token | Yes |
| `ESRI_API_KEY` | Optional Esri key | Yes |
| `CWA_API_KEY` | Optional Taiwan CWA open-data token | Yes |
| `CHINA_HISTORY_HOOK_URLS` | Optional history webhook URL list | May expose internal hosts |
| `VAPID_SUBJECT` | Web Push contact URL or `mailto:` | No |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Web Push VAPID key pair | Private key is sensitive |
| `PUSH_PROXY_URL` | Optional outbound HTTP(S) proxy | May be sensitive |
| `PUSH_RELAY_URL`, `PUSH_RELAY_SECRET` | Optional relay URL and shared secret | Secret is sensitive |
| `TRUST_PROXY`, `TRUST_GEO_HEADERS` | Trusted reverse-proxy settings | Misconfiguration is security-sensitive |
| `TLS_KEY_PATH`, `TLS_CERT_PATH` | Optional local TLS file paths | Private-key file is sensitive |

See `.env.example` and `server.js` for capacity, timeout, and compatibility variables. Never place credentials in JavaScript, Docker Compose, shell scripts, documentation, or URL query strings.

Obtain credentials only from each provider's official developer console:

- AMap, Google, Yandex, Tianditu, and Esri: create a web-map application and restrict its domains and APIs.
- Taiwan CWA: request a token from the official open-data platform.
- Web Push: after installing dependencies, run `node -e "console.log(require('web-push').generateVAPIDKeys())"` and store the result only in the server's `.env` or secret manager.

### First-deployment administrative credential

There is no administrator username, account system, or fixed default password. Protected debug tools use only `DEBUG_PASSWORD`:

1. Before the first public deployment, set a unique strong value in the server `.env` (8–128 characters with an uppercase letter, number, and symbol).
2. Restrict `.env` to the service account, for example with `chmod 600 .env`.
3. Do not reuse an email, cloud, or other service password.
4. Changing the password from the UI moves the new value to ignored runtime storage at `data/debug-password.json`; protect this directory and never upload it.

If no valid password exists, the service generates a random local password and prints its storage location so local startup remains understandable. The production configuration check still treats a missing `DEBUG_PASSWORD` as an error.

### Development checks

```bash
npm run check          # Syntax-check every JavaScript file
npm run feature-check  # Core feature smoke checks
npm run config-check   # Production configuration check (requires configured .env)
npm run security-check # Requires a local service at the configured SMOKE_BASE_URL
```

There is no separate build, TypeScript, or lint configuration. `npm run check` is the current source-level static check. `npm run package` uses an allowlist and rejects `.env`, `.git`, dependencies, and runtime data.

### Deployment

For production, use Linux, systemd, and Nginx/Caddy/Cloudflare Tunnel, and expose the Node port only to the reverse proxy. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). The included `scripts/deploy-linux.sh` preserves the server's existing `.env` and `data/`, installs production dependencies, writes a systemd unit, and performs health checks.

The current source does not contain a tested `Dockerfile` or `docker-compose.yml`; this release therefore does not invent an unverified Docker procedure.

### Data, privacy, and security

- Browser geolocation requires user permission and is primarily used for arrival/intensity calculations. Server-side IP lookup and debug auditing may create runtime records.
- `data/` may contain IP addresses, session identifiers, push endpoints, preferences, quota state, and authentication material. Treat it as personal and secret-bearing data.
- Regularly expire audit, subscription, and cache files; restrict directory permissions and encrypt backups.
- Restrict every production credential by domain, IP, and API where the provider supports it. Revoke and rotate anything suspected of exposure.
- See [`SECURITY.md`](SECURITY.md) for security reporting and deployment guidance.

### License

No open-source license has been selected. This release intentionally does not add one. Do not assume permission to copy, modify, or distribute the project until the maintainer provides an explicit `LICENSE`.
