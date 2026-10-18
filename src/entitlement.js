/**
 * 权益（Entitlement）状态机
 *
 * 时间永远从外部注入（clock / now 参数），
 * 这样测试里可以把时间"快进"，不用真的等一个月。
 */

import { getProduct, PERIODS } from './products.js';

const DAY = 86_400_000;

/** 把一个时间戳按周期往后推 */
export function addPeriod(ts, period) {
  if (!period) return null;
  const d = new Date(ts);
  PERIODS[period].add(d);
  return d.getTime();
}

/**
 * 单笔购买记录的权益状态
 *   granted : 现在能不能用
 *   inGrace : 是否处于"扣款失败宽限期"（续订扣款失败但还没彻底断）
 *   reason  : 不能用的原因（退款/撤销/过期）
 */
export function stateOf(purchase, now, graceDays) {
  if (purchase.status === 'refunded' || purchase.status === 'revoked') {
    return { granted: false, inGrace: false, reason: purchase.status };
  }
  // 买断：没有到期时间
  if (purchase.expiresAt == null) {
    return { granted: true, inGrace: false, lifetime: true };
  }
  if (now < purchase.expiresAt) {
    return { granted: true, inGrace: false, expiresAt: purchase.expiresAt };
  }
  // 已到期：只有"仍在自动续订"的订阅才享受宽限期（扣款重试）
  const graceEndsAt = purchase.expiresAt + graceDays * DAY;
  if (purchase.status === 'active' && now < graceEndsAt) {
    return { granted: true, inGrace: true, expiresAt: purchase.expiresAt, graceEndsAt };
  }
  return { granted: false, inGrace: false, reason: 'expired', expiresAt: purchase.expiresAt };
}

export class EntitlementService {
  #purchases = new Map(); // key: `${userId}|${productId}`
  #clock;
  #graceDays;

  constructor({ clock = () => Date.now(), graceDays = 3 } = {}) {
    this.#clock = clock;
    this.#graceDays = graceDays;
  }

  /** 写入一条平台回调事件，返回该用户的权益快照 */
  apply(event) {
    const now = event.at ?? this.#clock();
    const product = getProduct(event.productId);
    const key = `${event.userId}|${event.productId}`;
    const prev = this.#purchases.get(key);

    switch (event.type) {
      case 'purchase': {
        this.#purchases.set(key, {
          userId: event.userId,
          productId: event.productId,
          platform: event.platform ?? 'unknown',
          transactionId: event.transactionId ?? null,
          status: 'active',
          autoRenew: Boolean(product.period),
          startedAt: now,
          expiresAt: addPeriod(now, product.period),
          updatedAt: now,
        });
        break;
      }

      case 'renew': {
        if (!prev) throw new Error(`续订失败：没有 ${event.productId} 的购买记录`);
        // 从"原到期时间"和"现在"里取较晚的，避免补发事件把到期时间往前推
        const base = Math.max(now, prev.expiresAt ?? now);
        prev.expiresAt = addPeriod(base, product.period);
        prev.status = 'active';
        prev.autoRenew = true;
        prev.updatedAt = now;
        break;
      }

      case 'cancel': {
        // 用户关闭自动续订：到期前仍可用，到期后自动失效
        if (!prev) throw new Error('取消失败：没有订阅记录');
        prev.status = 'canceled';
        prev.autoRenew = false;
        prev.updatedAt = now;
        break;
      }

      case 'refund': {
        if (!prev) throw new Error('退款失败：没有购买记录');
        prev.status = 'refunded';
        prev.updatedAt = now;
        break;
      }

      case 'revoke': {
        if (!prev) throw new Error('撤销失败：没有购买记录');
        prev.status = 'revoked';
        prev.updatedAt = now;
        break;
      }

      default:
        throw new Error(`未知事件类型: ${event.type}`);
    }

    return this.resolve(event.userId, now);
  }

  /** 直接撤销（后台封禁 / 风控命中），不需要走平台回调 */
  revoke(userId, productId, now = this.#clock()) {
    const key = `${userId}|${productId}`;
    const p = this.#purchases.get(key);
    if (!p) return this.resolve(userId, now);
    p.status = 'revoked';
    p.updatedAt = now;
    return this.resolve(userId, now);
  }

  /**
   * 解析某个用户当前拥有的全部权益。
   * 同一权益被多个商品解锁时，取"最宽松"的那个：
   *   永久 > 到期晚的 > 宽限期内的
   */
  resolve(userId, now = this.#clock()) {
    const purchases = [];
    const entitlements = {};

    for (const p of this.#purchases.values()) {
      if (p.userId !== userId) continue;
      const state = stateOf(p, now, this.#graceDays);
      purchases.push({ ...p, state });

      if (!state.granted) continue;
      const product = getProduct(p.productId);
      for (const name of product.entitlements) {
        const cur = entitlements[name];
        if (!cur || rank(state) > rank(cur)) {
          entitlements[name] = {
            source: p.productId,
            lifetime: p.expiresAt == null,
            expiresAt: p.expiresAt,
            inGrace: Boolean(state.inGrace),
            transactionId: p.transactionId,
          };
        }
      }
    }

    return {
      userId,
      entitlements,
      has: (name) => Boolean(entitlements[name]),
      purchases,
    };
  }

  /** 到期提醒用：列出将在 windowMs 内到期的订阅 */
  expiringSoon(now = this.#clock(), windowMs = 3 * DAY) {
    const out = [];
    for (const p of this.#purchases.values()) {
      if (!p.expiresAt || p.status !== 'active') continue;
      const left = p.expiresAt - now;
      if (left > 0 && left <= windowMs) out.push({ ...p, msLeft: left });
    }
    return out.sort((a, b) => a.expiresAt - b.expiresAt);
  }
}

/** 权益优先级：永久 3 > 正常订阅 2 > 宽限期 1 */
function rank(t) {
  if (t.lifetime) return 3;
  if (t.inGrace) return 1;
  return 2;
}
