import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { EntitlementService } from '../src/entitlement.js';

const T0 = Date.UTC(2026, 0, 15);
const ADMIN = 'test-admin-key';
const SECRET = 'test-token-secret';

let server;
let base;
let service;

test.before(async () => {
  service = new EntitlementService({ clock: () => T0 });
  server = createServer({ service, secret: SECRET, adminKey: ADMIN, now: () => T0 });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

const admin = (extra = {}) => ({ authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json', ...extra });

test('健康检查不需要鉴权', async () => {
  const r = await fetch(`${base}/healthz`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
});

test('没有 admin key 时业务接口一律 401', async () => {
  const r = await fetch(`${base}/v1/users/u1`);
  assert.equal(r.status, 401);
});

test('写入购买事件后能查到权益', async () => {
  const r = await fetch(`${base}/v1/events`, {
    method: 'POST',
    headers: admin(),
    body: JSON.stringify({ type: 'purchase', userId: 'u1', productId: 'pro.monthly', transactionId: 'tx-1' }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.entitlements.sort(), ['ad_free', 'cloud_sync', 'pro_features']);

  const q = await fetch(`${base}/v1/users/u1`, { headers: admin() });
  const snap = await q.json();
  assert.equal(snap.purchases.length, 1);
  assert.equal(snap.purchases[0].granted, true);
  assert.equal(snap.purchases[0].expiresAt, new Date(Date.UTC(2026, 1, 15)).toISOString());
});

test('签发离线令牌后，客户端可凭令牌自证', async () => {
  const t = await fetch(`${base}/v1/users/u1/token`, { headers: admin() });
  const { token } = await t.json();
  assert.ok(token);

  const me = await fetch(`${base}/v1/me`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(me.status, 200);
  const j = await me.json();
  assert.equal(j.userId, 'u1');
  assert.equal(j.current.includes('ad_free'), true);

  // 篡改令牌 → 401
  const bad = await fetch(`${base}/v1/me`, { headers: { authorization: `Bearer ${token}x` } });
  assert.equal(bad.status, 401);
});

test('撤销后权益立即清空', async () => {
  const r = await fetch(`${base}/v1/users/u1/revoke`, {
    method: 'POST',
    headers: admin(),
    body: JSON.stringify({ productId: 'pro.monthly' }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.entitlements, []);

  const q = await fetch(`${base}/v1/users/u1`, { headers: admin() });
  const snap = await q.json();
  assert.equal(snap.purchases[0].granted, false);
});

test('Apple 通知可以直接投喂给 /v1/events', async () => {
  const r = await fetch(`${base}/v1/events`, {
    method: 'POST',
    headers: admin(),
    body: JSON.stringify({
      source: 'apple',
      notificationType: 'SUBSCRIBED',
      userId: 'u2',
      productId: 'adfree.lifetime',
      transactionId: 'tx-2',
    }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.entitlements, ['ad_free']);
});

test('到期类通知被忽略（由时间判定过期）', async () => {
  const r = await fetch(`${base}/v1/events`, {
    method: 'POST',
    headers: admin(),
    body: JSON.stringify({
      source: 'apple',
      notificationType: 'EXPIRED',
      userId: 'u2',
      productId: 'adfree.lifetime',
    }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ignored, true);
});

test('未知商品返回 500 并带明确原因', async () => {
  const r = await fetch(`${base}/v1/events`, {
    method: 'POST',
    headers: admin(),
    body: JSON.stringify({ type: 'purchase', userId: 'u3', productId: 'not.exists' }),
  });
  assert.equal(r.status, 500);
  const j = await r.json();
  assert.match(j.error, /未知商品/);
});
