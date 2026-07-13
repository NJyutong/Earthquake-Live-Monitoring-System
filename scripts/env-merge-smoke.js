const assert = require('assert');
const crypto = require('crypto');
const { mergeEnv } = require('./merge-env');

const oldKey = crypto.randomBytes(24).toString('base64url');
const newKey = crypto.randomBytes(24).toString('base64url');
const privateKey = crypto.randomBytes(32).toString('base64url');

const current = [
  '# server-only settings stay in place',
  `AMAP_JS_KEY=${oldKey}`,
  'PUBLIC_ORIGIN=https://example.com',
  `VAPID_PRIVATE_KEY=${privateKey}`,
  '',
].join('\n');
const incoming = [
  `AMAP_JS_KEY=${newKey}`,
  'PUBLIC_ORIGIN="https://example.com"',
  'YANDEX_DAILY_LIMIT=100',
  '',
].join('\n');

const merged = mergeEnv(current, incoming);
assert.ok(merged.includes(`AMAP_JS_KEY=${newKey}`));
assert.match(merged, /^PUBLIC_ORIGIN=https:\/\/example\.com$/m);
assert.ok(merged.includes(`VAPID_PRIVATE_KEY=${privateKey}`));
assert.match(merged, /^YANDEX_DAILY_LIMIT=100$/m);
assert.strictEqual(mergeEnv(merged, incoming), merged);
assert.throws(() => mergeEnv('', 'A=1\nA=2\n'), /Duplicate environment variable/);

console.log('Environment merge smoke test passed.');
