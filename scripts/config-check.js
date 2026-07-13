const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
const debugPasswordPath = path.join(root, 'data', 'debug-password.json');
const failures = [];
const warnings = [];
const results = [];

loadEnvFile();

function loadEnvFile() {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue;
    process.env[match[1]] = unquote(match[2]);
  }
}

function unquote(value) {
  const source = String(value || '').trim();
  if (source.length >= 2 && ((source[0] === '"' && source.at(-1) === '"') || (source[0] === "'" && source.at(-1) === "'"))) {
    return source.slice(1, -1);
  }
  return source;
}

function firstValue(names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function required(label, names) {
  const present = Boolean(firstValue(names));
  results.push([label, present ? 'configured' : 'missing']);
  if (!present) failures.push(`${label} is not configured (${names.join(' or ')})`);
  return present;
}

function debugPassword() {
  const fromEnv = String(process.env.DEBUG_PASSWORD || '');
  if (fromEnv) return { value: fromEnv, source: '.env/environment' };
  try {
    const stored = JSON.parse(fs.readFileSync(debugPasswordPath, 'utf8'));
    return { value: String(stored.password || ''), source: 'data/debug-password.json' };
  } catch (_error) {
    return { value: '', source: 'missing' };
  }
}

function passwordPolicyError(value) {
  const password = String(value || '');
  if (password.length < 8 || password.length > 128) return 'must contain 8 to 128 characters';
  if (!/[A-Z]/.test(password)) return 'must contain an uppercase letter';
  if (!/[0-9]/.test(password)) return 'must contain a number';
  if (!/[^A-Za-z0-9\s]/.test(password)) return 'must contain a special character';
  return '';
}

required('AMap Web JS key', ['AMAP_JS_KEY', 'AMAP_API_KEY', 'AMAP_KEY', 'AMAP_TOKEN', 'GAODE_MAPS_API_KEY']);
required('AMap security code', ['AMAP_SECURITY_JSCODE', 'AMAP_JSCODE', 'GAODE_SECURITY_JSCODE']);
required('Yandex Maps key', ['YANDEX_MAPS_API_KEY', 'YANDEX_MAPS_JS_KEY']);

const publicOrigin = String(process.env.PUBLIC_ORIGIN || '').trim();
const secureOrigin = /^https:\/\/[^\s/]+(?:\/.*)?$/i.test(publicOrigin);
results.push(['Public HTTPS origin', secureOrigin ? 'configured' : 'missing or invalid']);
if (!secureOrigin) failures.push('PUBLIC_ORIGIN must be an https:// URL');

const password = debugPassword();
const passwordError = passwordPolicyError(password.value);
results.push(['Debug password', passwordError ? `invalid (${password.source})` : `configured (${password.source})`]);
if (passwordError) failures.push(`Debug password ${passwordError}`);

if (!firstValue(['CWA_API_KEY'])) warnings.push('CWA_API_KEY is not configured; the Taiwan CWA source may be unavailable');
if (!firstValue(['GOOGLE_MAPS_JS_KEY', 'GOOGLE_MAPS_API_KEY'])) warnings.push('Google Maps JS key is not configured; the official share embed fallback will be used');

const vapidPublic = firstValue(['VAPID_PUBLIC_KEY']);
const vapidPrivate = firstValue(['VAPID_PRIVATE_KEY']);
if (Boolean(vapidPublic) !== Boolean(vapidPrivate)) failures.push('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be configured together');

const pushRelayUrl = String(process.env.PUSH_RELAY_URL || '').trim();
const pushRelaySecret = String(process.env.PUSH_RELAY_SECRET || '').trim();
const pushProxyUrl = String(process.env.PUSH_PROXY_URL || '').trim();
if (Boolean(pushRelayUrl) !== Boolean(pushRelaySecret)) {
  failures.push('PUSH_RELAY_URL and PUSH_RELAY_SECRET must be configured together');
} else if (pushRelayUrl) {
  try {
    const url = new URL(pushRelayUrl);
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname || url.hash) throw new Error('invalid');
  } catch (_error) {
    failures.push('PUSH_RELAY_URL must be a public HTTPS URL without embedded credentials');
  }
  if (pushRelaySecret.length < 32 || pushRelaySecret.length > 256) failures.push('PUSH_RELAY_SECRET must contain 32 to 256 characters');
}
if (pushProxyUrl) {
  try {
    const url = new URL(pushProxyUrl);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.hash) throw new Error('invalid');
  } catch (_error) {
    failures.push('PUSH_PROXY_URL must be a valid HTTP or HTTPS proxy URL');
  }
}
if (pushRelayUrl && pushProxyUrl) warnings.push('PUSH_RELAY_URL takes precedence over PUSH_PROXY_URL');
results.push(['Push outbound transport', pushRelayUrl ? 'Cloudflare relay' : pushProxyUrl ? 'HTTPS CONNECT proxy' : 'direct']);

const port = Number(process.env.PORT || 3000);
results.push(['Node port', Number.isInteger(port) && port > 0 && port <= 65535 ? String(port) : 'invalid']);
if (!Number.isInteger(port) || port <= 0 || port > 65535) failures.push('PORT must be an integer from 1 to 65535');

if (process.platform !== 'win32' && fs.existsSync(envPath)) {
  const mode = fs.statSync(envPath).mode & 0o777;
  if (mode & 0o077) warnings.push('.env is readable or writable by group/others; run chmod 600 .env');
}

for (const [label, status] of results) console.log(`${label}: ${status}`);
for (const warning of warnings) console.warn(`WARN: ${warning}`);
if (failures.length) {
  for (const failure of failures) console.error(`ERROR: ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Production configuration check passed.');
}
