const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');

const relayPath = path.join(__dirname, '..', 'cloudflare', 'push-relay-worker.mjs');
const secret = crypto.randomBytes(48).toString('base64url');

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const { default: worker } = await import(pathToFileURL(relayPath).href);
  const env = { PUSH_RELAY_SECRET: secret };

  const health = await worker.fetch(new Request('https://relay.example/health'), env);
  assert.strictEqual(health.status, 200, '推送中继健康接口异常');
  assert.strictEqual((await health.json()).ok, true, '推送中继健康接口内容异常');

  const unauthorized = await worker.fetch(new Request('https://relay.example/', { method: 'POST', body: '{}' }), env);
  assert.strictEqual(unauthorized.status, 401, '推送中继接受了未签名请求');

  const stale = await signedRequest(worker, env, {
    endpoint: 'https://fcm.googleapis.com/wp/stale',
    headers: validHeaders(),
    body: Buffer.from('test').toString('base64')
  }, Math.floor(Date.now() / 1000) - 120);
  assert.strictEqual(stale.status, 401, '推送中继接受了过期签名');

  const disallowed = await signedRequest(worker, env, {
    endpoint: 'https://example.com/push',
    headers: validHeaders(),
    body: Buffer.from('test').toString('base64')
  });
  assert.strictEqual(disallowed.status, 403, '推送中继接受了非浏览器厂商目标');

  const invalidHeaders = await signedRequest(worker, env, {
    endpoint: 'https://fcm.googleapis.com/wp/header-check',
    headers: { TTL: 60 },
    body: Buffer.from('test').toString('base64')
  });
  assert.strictEqual(invalidHeaders.status, 400, '推送中继接受了缺少鉴权的转发头');

  console.log(JSON.stringify({ ok: true, checks: 5 }));
}

function validHeaders() {
  return {
    TTL: 60,
    'Content-Type': 'application/octet-stream',
    'Content-Encoding': 'aes128gcm',
    Authorization: 'vapid t=test, k=test'
  };
}

function signedRequest(worker, env, payload, timestampValue = Math.floor(Date.now() / 1000)) {
  const body = JSON.stringify(payload);
  const timestamp = String(timestampValue);
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return worker.fetch(new Request('https://relay.example/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Cnquake-Timestamp': timestamp,
      'X-Cnquake-Signature': signature
    },
    body
  }), env);
}
