const dns = require('dns');
const fs = require('fs');
const https = require('https');
const path = require('path');
const tls = require('tls');

const root = path.resolve(__dirname, '..');
loadEnv(path.join(root, '.env'));

const relayUrl = String(process.env.PUSH_RELAY_URL || '').trim();
const proxyUrl = String(
  process.env.PUSH_PROXY_URL || process.env.HTTPS_PROXY || process.env.https_proxy || ''
).trim();

main().catch(error => {
  console.error(`推送网络检查失败：${error.message}`);
  process.exitCode = 1;
});

async function main() {
  if (relayUrl) {
    await checkRelay(relayUrl);
    return;
  }

  const hosts = subscriptionHosts(path.join(root, 'data', 'push-subscriptions.json'));
  if (!hosts.length) {
    console.log('没有已保存的浏览器推送订阅。请先在网页中开启后台推送，再运行本检查。');
    return;
  }

  console.log(`推送传输模式：${proxyUrl ? `HTTPS CONNECT 代理 ${safeProxyLabel(proxyUrl)}` : '服务器直接出站'}`);
  let failed = false;
  for (const hostname of hosts) {
    const provider = pushProvider(hostname);
    const result = proxyUrl
      ? await checkThroughProxy(hostname, proxyUrl)
      : await checkDirect(hostname);
    console.log(`${provider} ${hostname}:443 ${result.ok ? '可连接' : '连接失败'}${result.detail ? `（${result.detail}）` : ''}`);
    if (!result.ok) failed = true;
  }
  if (failed) process.exitCode = 2;
}

async function checkRelay(value) {
  let url;
  try {
    url = new URL(value);
  } catch (_error) {
    throw new Error('PUSH_RELAY_URL 不是有效 URL');
  }
  if (url.protocol !== 'https:') throw new Error('PUSH_RELAY_URL 必须使用 HTTPS');
  const healthUrl = new URL('/health', url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(healthUrl, { cache: 'no-store', redirect: 'error', signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(`中继健康接口返回 HTTP ${response.status}`);
    console.log(`推送传输模式：Cloudflare Worker 中继 ${url.hostname}`);
    console.log('中继健康接口：可连接');
  } finally {
    clearTimeout(timer);
  }
}

async function checkDirect(hostname) {
  let addresses;
  try {
    addresses = await dns.promises.lookup(hostname, { all: true, verbatim: false });
  } catch (error) {
    return { ok: false, detail: `DNS ${error.code || error.message}` };
  }
  const publicAddresses = addresses.filter(item => isPublicAddress(item.address)).slice(0, 8);
  if (!publicAddresses.length) return { ok: false, detail: 'DNS 未返回公网地址' };
  const attempts = await Promise.all(publicAddresses.map(item => tlsProbe(hostname, item)));
  const passed = attempts.find(item => item.ok);
  if (passed) return { ok: true, detail: `${passed.address} TLS ${passed.protocol}` };
  return { ok: false, detail: attempts.map(item => `${item.address} ${item.error}`).join('; ') };
}

function tlsProbe(hostname, item) {
  return new Promise(resolve => {
    const socket = tls.connect({
      host: item.address,
      port: 443,
      family: item.family,
      servername: hostname,
      rejectUnauthorized: true,
      timeout: 6000
    });
    const finish = result => {
      socket.removeAllListeners();
      socket.destroy();
      resolve({ address: item.address, ...result });
    };
    socket.once('secureConnect', () => finish({ ok: true, protocol: socket.getProtocol() || 'unknown' }));
    socket.once('timeout', () => finish({ ok: false, error: 'ETIMEDOUT' }));
    socket.once('error', error => finish({ ok: false, error: error.code || error.message }));
  });
}

async function checkThroughProxy(hostname, value) {
  let HttpsProxyAgent;
  try {
    ({ HttpsProxyAgent } = require('https-proxy-agent'));
  } catch (_error) {
    return { ok: false, detail: '缺少 https-proxy-agent' };
  }
  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let request;
    try {
      request = https.request({
        hostname,
        port: 443,
        path: '/',
        method: 'HEAD',
        agent: new HttpsProxyAgent(value),
        timeout: 7000
      }, response => {
        response.resume();
        finish({ ok: true, detail: `代理握手成功，HTTP ${response.statusCode}` });
      });
    } catch (error) {
      finish({ ok: false, detail: error.code || error.message });
      return;
    }
    request.once('timeout', () => request.destroy(new Error('ETIMEDOUT')));
    request.once('error', error => finish({ ok: false, detail: error.code || error.message }));
    request.end();
  });
}

function subscriptionHosts(filePath) {
  try {
    const records = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const hosts = new Set();
    for (const record of Array.isArray(records) ? records : []) {
      try {
        const hostname = new URL(record && record.subscription && record.subscription.endpoint).hostname.toLowerCase();
        if (hostname) hosts.add(hostname);
      } catch (_error) {
        // Ignore malformed historical records without printing endpoint secrets.
      }
    }
    return Array.from(hosts).sort();
  } catch (_error) {
    return [];
  }
}

function pushProvider(hostname) {
  if (hostname.endsWith('.notify.windows.com') || hostname.endsWith('.wns.windows.com')) return 'Microsoft Edge / WNS';
  if (hostname === 'fcm.googleapis.com' || hostname.endsWith('.fcm.googleapis.com') || hostname === 'android.googleapis.com') return 'Google FCM';
  if (hostname.endsWith('.push.services.mozilla.com')) return 'Mozilla Push';
  if (hostname === 'web.push.apple.com' || hostname.endsWith('.push.apple.com')) return 'Apple Web Push';
  return '浏览器厂商推送服务';
}

function safeProxyLabel(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}`;
  } catch (_error) {
    return '配置无效';
  }
}

function isPublicAddress(value) {
  if (value.includes(':')) {
    const lower = value.toLowerCase();
    return lower !== '::1' && !lower.startsWith('fc') && !lower.startsWith('fd') && !lower.startsWith('fe8') && !lower.startsWith('fe9') && !lower.startsWith('fea') && !lower.startsWith('feb');
  }
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) return false;
  if ([0, 10, 127].includes(parts[0]) || parts[0] >= 224) return false;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
  if (parts[0] === 192 && parts[1] === 168) return false;
  if (parts[0] === 169 && parts[1] === 254) return false;
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return false;
  return true;
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
}
