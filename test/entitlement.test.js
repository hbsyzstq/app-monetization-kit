import test from 'node:test';
import assert from 'node:assert/strict';
import { EntitlementService, stateOf, addPeriod } from '../src/entitlement.js';
import { signToken, verifyToken } from '../src/token.js';
import { mapAppleNotification } from '../src/storekit.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 15); // 2026-01-15

function svc(graceDays = 3) {
  return new EntitlementService({ clock: () => T0, graceDays });
}

test('购买月订阅后立即拥有 ad_free 等权益', () => {
  const s = svc();
  const snap = s.apply({ type: 'purchase', userId: 'u1', productId: 'pro.monthly', transactionId: 'tx1' });
  assert.equal(snap.has('ad_free'), true);
  assert.equal(snap.has('pro_features'), true);
  assert.equal(snap.has('cloud_sync'), true);
  // 1 月 15 日 + 1 个月 = 2 月 15 日
  assert.equal(snap.entitlements.ad_free.expiresAt, Date.UTC(2026, 1, 15));
});

test('买断商品没有到期时间', () => {
  const s = svc();
  const snap = s.apply({ type: 'purchase', userId: 'u1', productId: 'adfree.lifetime' });
  assert.equal(snap.has('ad_free'), true);
  assert.equal(snap.entitlements.ad_free.lifetime, true);
  assert.equal(snap.entitlements.ad_free.expiresAt, null);
  // 买断只给 ad_free，不该白送 pro_features
  assert.equal(snap.has('pro_features'), false);
});

test('关闭自动续订：到期前仍可用，到期后失效', () => {
  const s = svc();
  s.apply({ type: 'purchase', userId: 'u1', productId: 'pro.monthly' });
  s.apply({ type: 'cancel', userId: 'u1', productId: 'pro.monthly' });

  const before = s.resolve('u1', Date.UTC(2026, 1, 14));
  assert.equal(before.has('ad_free'), true, '到期前一天应该还能用');

  const after = s.resolve('u1', Date.UTC(2026, 1, 16));
  assert.equal(after.has('ad_free'), false, '到期后应该失效');
});

test('自动续订的订阅到期后有 3 天宽限期', () => {
  const s = svc(3);
  s.apply({ type: 'purchase', userId: 'u1', productId: 'pro.monthly' });
  // 到期后第 2 天，还在宽限期
  const inGrace = s.resolve('u1', Date.UTC(2026, 1, 17));
  assert.equal(inGrace.has('ad_free'), true);
  assert.equal(inGrace.entitlements.ad_free.inGrace, true);

  // 到期后第 4 天，宽限期已过
  const afterGrace = s.resolve('u1', Date.UTC(2026, 1, 19));
  assert.equal(afterGrace.has('ad_free'), false);
});

test('退款立即收回权益（不给宽限期）', () => {
  const s = svc();
  s.apply({ type: 'purchase', userId: 'u1', productId: 'pro.yearly' });
  const snap = s.apply({ type: 'refund', userId: 'u1', productId: 'pro.yearly' });
  assert.equal(snap.has('ad_free'), false);
  assert.equal(snap.purchases[0].state.reason, 'refunded');
});

test('撤销权益用于封禁/风控', () => {
  const s = svc();
  s.apply({ type: 'purchase', userId: 'u1', productId: 'pro.lifetime' });
  const snap = s.revoke('u1', 'pro.lifetime');
  assert.equal(snap.has('ad_free'), false);
});

test('续订从较晚的时间点往后推，不会被补发事件缩短', () => {
  const s = svc();
  s.apply({ type: 'purchase', userId: 'u1', productId: 'pro.monthly' }); // 到期 2/15
  // 提前 5 天续订
  s.apply({ type: 'renew', userId: 'u1', productId: 'pro.monthly', at: Date.UTC(2026, 1, 10) });
  const snap = s.resolve('u1', T0);
  assert.equal(snap.entitlements.ad_free.expiresAt, Date.UTC(2026, 2, 15), '应从原到期日 2/15 再推一个月');
});

test('同一权益由多个商品解锁时取最宽松的', () => {
  const s = svc();
  s.apply({ type: 'purchase', userId: 'u1', productId: 'pro.monthly' });
  s.apply({ type: 'purchase', userId: 'u1', productId: 'adfree.lifetime' });
  const snap = s.resolve('u1', Date.UTC(2026, 5, 1)); // 订阅早过期了
  assert.equal(snap.has('ad_free'), true);
  assert.equal(snap.entitlements.ad_free.lifetime, true);
  assert.equal(snap.has('pro_features'), false, 'pro 权益应该随订阅一起过期');
});

test('expiringSoon 只列出临近到期的订阅', () => {
  const s = svc();
  s.apply({ type: 'purchase', userId: 'u1', productId: 'pro.monthly' });
  s.apply({ type: 'purchase', userId: 'u2', productId: 'adfree.lifetime' });
  const list = s.expiringSoon(Date.UTC(2026, 1, 13), 3 * DAY);
  assert.equal(list.length, 1);
  assert.equal(list[0].userId, 'u1');
});

test('addPeriod 支持周/月/年', () => {
  assert.equal(addPeriod(T0, 'week'), Date.UTC(2026, 0, 22));
  assert.equal(addPeriod(T0, 'month'), Date.UTC(2026, 1, 15));
  assert.equal(addPeriod(T0, 'year'), Date.UTC(2027, 0, 15));
  assert.equal(addPeriod(T0, null), null);
});

test('stateOf 对未知状态保持安全（默认不放行）', () => {
  const st = stateOf({ status: 'something-weird', expiresAt: T0 - 1000 }, T0, 3);
  assert.equal(st.granted, false);
});

test('令牌签名与校验，篡改后失效', () => {
  const secret = 'test-secret';
  const { token, payload } = signToken({ sub: 'u1', entitlements: { ad_free: {} } }, secret, { now: T0 });
  assert.equal(payload.ent[0], 'ad_free');

  const ok = verifyToken(token, secret, { now: T0 + 1000 });
  assert.equal(ok.valid, true);
  assert.equal(ok.payload.sub, 'u1');

  // 改 payload
  const [body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 'u1', ent: ['ad_free', 'pro_features'], exp: T0 + 1000, iat: T0 })).toString('base64url');
  assert.equal(verifyToken(`${forged}.${sig}`, secret, { now: T0 }).valid, false);

  // 换密钥
  assert.equal(verifyToken(token, 'other-secret', { now: T0 }).valid, false);

  // 过期
  assert.equal(verifyToken(token, secret, { now: T0 + 25 * 3600_000 }).reason, 'expired');

  // 格式错误
  assert.equal(verifyToken('hello', secret, { now: T0 }).reason, 'malformed');
});

test('Apple 通知映射：关闭自动续订才映射成 cancel', () => {
  const cancel = mapAppleNotification({
    notificationType: 'DID_CHANGE_RENEWAL_STATUS',
    subtype: 'AUTO_RENEW_DISABLED',
    userId: 'u1',
    productId: 'pro.monthly',
  });
  assert.equal(cancel.type, 'cancel');

  const reenable = mapAppleNotification({
    notificationType: 'DID_CHANGE_RENEWAL_STATUS',
    subtype: 'AUTO_RENEW_ENABLED',
    userId: 'u1',
    productId: 'pro.monthly',
  });
  assert.equal(reenable, null);
});
