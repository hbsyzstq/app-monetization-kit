/**
 * 离线权益令牌（Entitlement Token）
 *
 * 为什么需要：App 每次启动都打服务端接口很慢，断网就废。
 * 做法是服务端签一个短期令牌交给客户端缓存，客户端离线时校验签名即可。
 *
 * 注意：这只是"减少请求 + 离线可用"，不是防破解的银弹 ——
 * 真正的防线是服务端在提供付费内容时再校验一次（见 docs/04-hardening.md）。
 */

import crypto from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(s, 'base64url');

export function signToken({ sub, entitlements, exp }, secret, { now = Date.now(), ttlMs = 24 * 3600_000 } = {}) {
  if (!secret) throw new Error('缺少签名密钥');
  const payload = {
    sub,
    ent: Object.keys(entitlements),
    iat: now,
    exp: exp ?? now + ttlMs,
  };
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return { token: `${body}.${sig}`, payload };
}

export function verifyToken(token, secret, { now = Date.now() } = {}) {
  if (typeof token !== 'string' || !token.includes('.')) {
    return { valid: false, reason: 'malformed' };
  }
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');

  // 定长比较，避免时序侧信道
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, reason: 'bad_signature' };
  }

  let payload;
  try {
    payload = JSON.parse(unb64u(body).toString('utf8'));
  } catch {
    return { valid: false, reason: 'bad_payload' };
  }
  if (typeof payload.exp === 'number' && now > payload.exp) {
    return { valid: false, reason: 'expired', payload };
  }
  return { valid: true, payload };
}
