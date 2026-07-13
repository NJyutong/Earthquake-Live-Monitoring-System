#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/earthquake-system}"
ZIP_PATH="${ZIP_PATH:-${1:-}}"
SERVICE_NAME="${SERVICE_NAME:-earthquake-system}"
SERVICE_USER="${SERVICE_USER:-earthquake}"
PORT="${PORT:-3000}"
RECONFIGURE="${RECONFIGURE:-0}"
PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-}"
DATA_SOURCE_DIR="${DATA_SOURCE_DIR:-}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi
if [[ -z "${ZIP_PATH}" ]]; then
  echo "Usage: sudo ZIP_PATH=/absolute/path/release.zip SERVICE_USER=earthquake bash scripts/deploy-linux.sh" >&2
  exit 1
fi
if [[ ! -f "${ZIP_PATH}" ]]; then
  echo "Archive not found: ${ZIP_PATH}" >&2
  exit 1
fi
if [[ "${APP_DIR}" != /* || "${APP_DIR}" == "/" || "${APP_DIR}" == "/tmp" || "${APP_DIR}" == "/home" ]]; then
  echo "Unsafe APP_DIR: ${APP_DIR}" >&2
  exit 1
fi
if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
  echo "Service user does not exist: ${SERVICE_USER}" >&2
  exit 1
fi

STAGE_DIR="$(mktemp -d /tmp/earthquake-stage.XXXXXX)"
KEEP_DIR="$(mktemp -d /tmp/earthquake-keep.XXXXXX)"
cleanup() {
  rm -rf -- "${STAGE_DIR}" "${KEEP_DIR}"
}
trap cleanup EXIT

unzip -q "${ZIP_PATH}" -d "${STAGE_DIR}"
PACKAGE_ROOT="${STAGE_DIR}"
if [[ ! -f "${PACKAGE_ROOT}/package.json" ]]; then
  mapfile -t roots < <(find "${STAGE_DIR}" -mindepth 1 -maxdepth 1 -type d)
  if [[ "${#roots[@]}" -eq 1 && -f "${roots[0]}/package.json" ]]; then
    PACKAGE_ROOT="${roots[0]}"
  fi
fi
if [[ ! -f "${PACKAGE_ROOT}/package.json" || ! -f "${PACKAGE_ROOT}/server.js" ]]; then
  echo "Archive does not contain the expected Node application." >&2
  exit 1
fi
if [[ ! -f "${PACKAGE_ROOT}/release.json" ]]; then
  echo "Archive does not contain release.json." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm must be installed before deployment." >&2
  exit 1
fi
EXPECTED_ASSET_VERSION="$(cd "${PACKAGE_ROOT}" && node -p "require('./release.json').assetVersion")"
if [[ ! "${EXPECTED_ASSET_VERSION}" =~ ^[A-Za-z0-9._-]{2,80}$ ]]; then
  echo "Archive contains an invalid release version." >&2
  exit 1
fi

mkdir -p "${APP_DIR}"
ENV_CHANGED=0
if [[ -f "${APP_DIR}/.env" ]]; then
  cp -a "${APP_DIR}/.env" "${KEEP_DIR}/.env"
fi
if [[ -n "${DATA_SOURCE_DIR}" ]]; then
  if [[ "${DATA_SOURCE_DIR}" != /* || ! -d "${DATA_SOURCE_DIR}" ]]; then
    echo "DATA_SOURCE_DIR must be an existing absolute data directory: ${DATA_SOURCE_DIR}" >&2
    exit 1
  fi
  cp -a "${DATA_SOURCE_DIR}" "${KEEP_DIR}/data"
  echo "Migrating persistent runtime data from ${DATA_SOURCE_DIR}."
elif [[ -d "${APP_DIR}/data" ]]; then
  cp -a "${APP_DIR}/data" "${KEEP_DIR}/data"
fi

PACKAGED_ENV="${PACKAGE_ROOT}/.env"
if [[ -f "${PACKAGED_ENV}" ]]; then
  if [[ -f "${KEEP_DIR}/.env" ]]; then
    MERGED_ENV="${KEEP_DIR}/.env.merged"
    node "${PACKAGE_ROOT}/scripts/merge-env.js" "${KEEP_DIR}/.env" "${PACKAGED_ENV}" "${MERGED_ENV}"
    if cmp -s "${KEEP_DIR}/.env" "${MERGED_ENV}"; then
      rm -f -- "${MERGED_ENV}"
      echo "Production environment is unchanged; keeping the existing .env file."
    else
      mv "${MERGED_ENV}" "${KEEP_DIR}/.env"
      chmod 600 "${KEEP_DIR}/.env"
      ENV_CHANGED=1
      echo "Updated changed values from the packaged .env; server-only values were preserved."
    fi
  else
    cp -a "${PACKAGED_ENV}" "${KEEP_DIR}/.env"
    chmod 600 "${KEEP_DIR}/.env"
    ENV_CHANGED=1
    echo "Installed the packaged production environment for first deployment."
  fi
fi

configure_environment() {
  if [[ ! -t 0 ]]; then
    echo "Production settings require an interactive terminal." >&2
    exit 1
  fi
  echo "Enter production settings; hidden input is not written to shell history."
  read -r -p "AMap Web JS key: " AMAP_INPUT
  read -r -s -p "AMap security code: " AMAP_SECURITY_INPUT
  echo
  read -r -s -p "Yandex Maps API key: " YANDEX_INPUT
  echo
  read -r -p "CWA API key (optional): " CWA_INPUT
  read -r -p "Public HTTPS origin (required): " ORIGIN_INPUT
  if [[ ! "${ORIGIN_INPUT}" =~ ^https://[^[:space:]/]+([/].*)?$ ]]; then
    echo "Public origin must be an HTTPS URL." >&2
    exit 1
  fi
  read -r -s -p "Debug password: " DEBUG_PASSWORD_INPUT
  echo
  NEXT_ENV="${KEEP_DIR}/.env.next"
  if [[ -f "${KEEP_DIR}/.env" ]]; then
    grep -Ev '^(AMAP_JS_KEY|AMAP_API_KEY|AMAP_KEY|AMAP_TOKEN|GAODE_MAPS_API_KEY|AMAP_SECURITY_JSCODE|AMAP_JSCODE|GAODE_SECURITY_JSCODE|PUBLIC_ORIGIN|CWA_API_KEY|YANDEX_MAPS_API_KEY|YANDEX_MAPS_JS_KEY|YANDEX_DAILY_LIMIT|DEBUG_PASSWORD|VAPID_SUBJECT)=' "${KEEP_DIR}/.env" > "${NEXT_ENV}" || true
  else
    : > "${NEXT_ENV}"
  fi
  {
    if [[ -s "${NEXT_ENV}" ]]; then printf '\n'; fi
    printf 'AMAP_JS_KEY=%s\n' "${AMAP_INPUT}"
    printf 'AMAP_SECURITY_JSCODE=%s\n' "${AMAP_SECURITY_INPUT}"
    printf 'PUBLIC_ORIGIN=%s\n' "${ORIGIN_INPUT}"
    printf 'CWA_API_KEY=%s\n' "${CWA_INPUT}"
    printf 'YANDEX_MAPS_API_KEY=%s\n' "${YANDEX_INPUT}"
    printf 'YANDEX_DAILY_LIMIT=100\n'
    printf 'DEBUG_PASSWORD=%s\n' "${DEBUG_PASSWORD_INPUT}"
    printf 'VAPID_SUBJECT=%s\n' "${ORIGIN_INPUT}"
  } >> "${NEXT_ENV}"
  mv "${NEXT_ENV}" "${KEEP_DIR}/.env"
  chmod 600 "${KEEP_DIR}/.env"
  ENV_CHANGED=1
  if [[ -d "${KEEP_DIR}/data" ]]; then
    rm -f -- "${KEEP_DIR}/data/debug-password.json"
  fi
}

if [[ ! -f "${KEEP_DIR}/.env" ]]; then
  configure_environment
elif [[ "${RECONFIGURE}" == "1" && ! -f "${PACKAGED_ENV}" ]]; then
  configure_environment
fi

cp -a "${KEEP_DIR}/.env" "${PACKAGE_ROOT}/.env"
if [[ -d "${KEEP_DIR}/data" ]]; then
  rm -rf -- "${PACKAGE_ROOT}/data"
  cp -a "${KEEP_DIR}/data" "${PACKAGE_ROOT}/data"
fi
(cd "${PACKAGE_ROOT}" && node scripts/config-check.js)
(cd "${PACKAGE_ROOT}" && node scripts/feature-smoke.js)

systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
if command -v ss >/dev/null 2>&1; then
  PORT_LISTENER="$(ss -H -lntp "sport = :${PORT}" 2>/dev/null || true)"
  if [[ -n "${PORT_LISTENER}" ]]; then
    echo "Port ${PORT} is still occupied after stopping ${SERVICE_NAME}; refusing to mistake an old process for the new deployment." >&2
    printf '%s\n' "${PORT_LISTENER}" >&2
    exit 1
  fi
fi
rm -f -- "${PACKAGE_ROOT}/.env"
find "${APP_DIR}" -mindepth 1 -maxdepth 1 ! -name '.env' -exec rm -rf -- {} +
cp -a "${PACKAGE_ROOT}/." "${APP_DIR}/"
if [[ -f "${KEEP_DIR}/.env" && ( "${ENV_CHANGED}" == "1" || ! -f "${APP_DIR}/.env" ) ]]; then
  cp -a "${KEEP_DIR}/.env" "${APP_DIR}/.env"
fi
if [[ -d "${KEEP_DIR}/data" ]]; then
  rm -rf -- "${APP_DIR}/data"
  cp -a "${KEEP_DIR}/data" "${APP_DIR}/data"
fi
mkdir -p "${APP_DIR}/data"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${APP_DIR}"
if [[ -f "${APP_DIR}/.env" ]]; then chmod 600 "${APP_DIR}/.env"; fi
chmod 700 "${APP_DIR}/data"

cd "${APP_DIR}"
npm ci --omit=dev
npm run check
npm run config-check
npm run feature-check

NODE_BIN="$(command -v node)"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
DROPIN_DIR="/etc/systemd/system/${SERVICE_NAME}.service.d"
if [[ -L "${UNIT_PATH}" ]]; then
  rm -f -- "${UNIT_PATH}"
  echo "Removed stale systemd unit symlink for ${SERVICE_NAME}."
fi
if [[ -d "${DROPIN_DIR}" ]]; then
  rm -rf -- "${DROPIN_DIR}"
  echo "Removed stale systemd drop-ins for ${SERVICE_NAME}."
fi
cat > "${UNIT_PATH}" <<UNIT
[Unit]
Description=China Earthquake Monitoring Screen
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
EnvironmentFile=-${APP_DIR}/.env
ExecStart=/usr/bin/env PORT=${PORT} HOST=127.0.0.1 ${NODE_BIN} server.js
Restart=always
RestartSec=3
TimeoutStopSec=15
KillSignal=SIGTERM
UMask=0077
NoNewPrivileges=true
PrivateDevices=true
ProtectSystem=full
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}"

health_matches() {
  node -e 'try { const data = JSON.parse(process.argv[2]); process.exit(data.ok === true && data.version === process.argv[1] ? 0 : 1); } catch (_error) { process.exit(1); }' "${EXPECTED_ASSET_VERSION}" "$1"
}

LOCAL_HEALTHY=0
for _ in {1..20}; do
  HEALTH_BODY="$(curl -fsS "http://127.0.0.1:${PORT}/health" 2>/dev/null || true)"
  if systemctl is-active --quiet "${SERVICE_NAME}" && health_matches "${HEALTH_BODY}" && curl -fsS "http://127.0.0.1:${PORT}/sources" >/dev/null; then
    LOCAL_HEALTHY=1
    break
  fi
  sleep 1
done

if [[ "${LOCAL_HEALTHY}" != "1" ]]; then
  systemctl --no-pager --full status "${SERVICE_NAME}" || true
  journalctl -u "${SERVICE_NAME}" -n 80 --no-pager || true
  echo "Service did not start with expected version ${EXPECTED_ASSET_VERSION}." >&2
  exit 1
fi

APP_REAL_DIR="$(readlink -f "${APP_DIR}")"
SERVICE_MAIN_PID="$(systemctl show "${SERVICE_NAME}" -p MainPID --value)"
SERVICE_WORKING_DIR="$(systemctl show "${SERVICE_NAME}" -p WorkingDirectory --value)"
SERVICE_PROCESS_CWD=""
if [[ "${SERVICE_MAIN_PID}" =~ ^[1-9][0-9]*$ && -e "/proc/${SERVICE_MAIN_PID}/cwd" ]]; then
  SERVICE_PROCESS_CWD="$(readlink -f "/proc/${SERVICE_MAIN_PID}/cwd")"
fi
if [[ "${SERVICE_WORKING_DIR}" != "${APP_REAL_DIR}" || "${SERVICE_PROCESS_CWD}" != "${APP_REAL_DIR}" ]]; then
  systemctl --no-pager --full status "${SERVICE_NAME}" || true
  systemctl --no-pager cat "${SERVICE_NAME}" || true
  echo "Service path mismatch: unit=${SERVICE_WORKING_DIR:-unknown}, process=${SERVICE_PROCESS_CWD:-unknown}, expected=${APP_REAL_DIR}." >&2
  exit 1
fi
echo "Verified ${SERVICE_NAME} PID ${SERVICE_MAIN_PID} is running from ${SERVICE_PROCESS_CWD}."

if [[ -n "${PUBLIC_HEALTH_URL}" ]]; then
  PUBLIC_HEALTHY=0
  for _ in {1..10}; do
    HEALTH_BODY="$(curl -fsS -H 'Cache-Control: no-cache' "${PUBLIC_HEALTH_URL}" 2>/dev/null || true)"
    if health_matches "${HEALTH_BODY}"; then
      PUBLIC_HEALTHY=1
      break
    fi
    sleep 2
  done
  if [[ "${PUBLIC_HEALTHY}" != "1" ]]; then
    echo "Public route ${PUBLIC_HEALTH_URL} does not expose expected version ${EXPECTED_ASSET_VERSION}; check the Cloudflare Tunnel route." >&2
    exit 1
  fi
  PUBLIC_SITE_URL="${PUBLIC_HEALTH_URL%/health}"
  (cd "${APP_DIR}" && node scripts/live-release-check.js "${PUBLIC_SITE_URL}")
fi

systemctl --no-pager --full status "${SERVICE_NAME}" | sed -n '1,12p'
echo "Deployment completed on 127.0.0.1:${PORT} with version ${EXPECTED_ASSET_VERSION}."
