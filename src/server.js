/**
 * 权益服务 HTTP 层（零依赖，node:http）
 *
 * 接口：
 *   GET  /healthz
 *   POST /v1/events                      平台回调/模拟下单（需 admin key）
 *   GET  /v1/users/:id                   查询权益（需 admin key）
 *   GET  /v1/users/:id/token             签发离线令牌（需 admin key）
 *   POST /v1/users/:id/revoke            撤销某商品的权益（需 admin key）
 *   GET  /v1/me                          客户端凭令牌自证（需 Bearer token）
 *
 * 启动：ADMIN_KEY=xxx TOKEN_SECRET=yyy node src/server.js
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { EntitlementService } from './entitlement.js';
import { signToken, verifyToken } from './token.js';
import { mapAppleNotification, mapGoogleNotification } from './storekit.js';

const MAX_BODY = 64 * 1024;

function send(res, code, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const safeEqual = (a, b) => {
  const A = Buffer.from(String(a ?? ''));
  const B = Buffer.from(String(b ?? ''));
  return A.length === B.length && A.length > 0 && crypto.timingSafeEqual(A, B);
};

function adminOk(req, adminKey) {
  const h = req.headers.authorization ?? '';
  const key = h.startsWith('Bearer ') ? h.slice(7) : (req.headers['x-admin-key'] ?? '');
  return safeEqual(key, adminKey);
}

export function createServer({
  service = new EntitlementService(),
  secret = process.env.TOKEN_SECRET || 'dev-secret-change-me',
  adminKey = process.env.ADMIN_KEY || 'dev-admin-change-me',
  now = () => Date.now(),
} = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;

    try {
      if (req.method === 'GET' && path === '/healthz') {
        return send(res, 200, { ok: true, ts: now() });
      }

      // ---- 客户端自证：拿离线令牌换当前权益 ----
      if (req.method === 'GET' && path === '/v1/me') {
        const h = req.headers.authorization ?? '';
        const token = h.startsWith('Bearer ') ? h.slice(7) : '';
        const v = verifyToken(token, secret, { now: now() });
        if (!v.valid) return send(res, 401, { error: '令牌无效', reason: v.reason });
        const snap = service.resolve(v.payload.sub, now());
        return send(res, 200, {
          userId: v.payload.sub,
          tokenEntitlements: v.payload.ent,
          current: Object.keys(snap.entitlements),
          entitlements: snap.entitlements,
        });
      }

      // ---- 以下都需要 admin key ----
      if (!adminOk(req, adminKey)) {
        return send(res, 401, { error: '需要 admin key' });
      }

      if (req.method === 'POST' && path === '/v1/events') {
        const raw = await readBody(req);
        let event;
        try {
          event = JSON.parse(raw);
        } catch {
          return send(res, 400, { error: 'JSON 解析失败' });
        }

        // 平台通知 → 内部事件
        let mapped = event;
        if (event.source === 'apple') mapped = mapAppleNotification(event);
        if (event.source === 'google') mapped = mapGoogleNotification(event);

        if (!mapped) return send(res, 200, { ignored: true, note: '该通知无需处理' });
        if (mapped.type === 'expire') {
          // 到期不落库，由时间判定
          return send(res, 200, { ignored: true, note: mapped.note });
        }
        if (!mapped.userId || !mapped.productId) {
          return send(res, 400, { error: '缺少 userId 或 productId' });
        }

        const snap = service.apply({ ...mapped, at: mapped.at ?? now() });
        return send(res, 200, {
          userId: snap.userId,
          entitlements: Object.keys(snap.entitlements),
          detail: snap.entitlements,
        });
      }

      const m = /^\/v1\/users\/([^/]+)(?:\/(token|revoke))?$/.exec(path);
      if (m) {
        const userId = decodeURIComponent(m[1]);
        const action = m[2];

        if (req.method === 'GET' && !action) {
          const snap = service.resolve(userId, now());
          return send(res, 200, {
            userId,
            entitlements: snap.entitlements,
            purchases: snap.purchases.map((p) => ({
              productId: p.productId,
              status: p.status,
              autoRenew: p.autoRenew,
              expiresAt: p.expiresAt ? new Date(p.expiresAt).toISOString() : null,
              granted: p.state.granted,
              inGrace: Boolean(p.state.inGrace),
            })),
          });
        }

        if (req.method === 'GET' && action === 'token') {
          const ttlDays = Number(url.searchParams.get('ttlDays') ?? 1);
          const snap = service.resolve(userId, now());
          const { token, payload } = signToken(
            { sub: userId, entitlements: snap.entitlements },
            secret,
            { now: now(), ttlMs: ttlDays * 86_400_000 },
          );
          return send(res, 200, { token, payload });
        }

        if (req.method === 'POST' && action === 'revoke') {
          const raw = await readBody(req);
          const { productId } = JSON.parse(raw || '{}');
          if (!productId) return send(res, 400, { error: '缺少 productId' });
          const snap = service.revoke(userId, productId, now());
          return send(res, 200, {
            userId,
            entitlements: Object.keys(snap.entitlements),
            detail: snap.entitlements,
          });
        }
      }

      return send(res, 404, { error: 'not found', path });
    } catch (err) {
      return send(res, 500, { error: err.message });
    }
  });
}

// 直接运行则启动服务
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8787);
  const server = createServer();
  server.listen(port, () => {
    console.log(`权益服务已启动 http://127.0.0.1:${port}`);
    if (!process.env.ADMIN_KEY || !process.env.TOKEN_SECRET) {
      console.warn('⚠️  正在使用默认密钥，仅限本地调试，上线前务必设置 ADMIN_KEY / TOKEN_SECRET');
    }
  });
}
