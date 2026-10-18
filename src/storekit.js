/**
 * 平台通知 → 内部事件的映射
 *
 * 真实项目里这一层对应：
 *   iOS/macOS : App Store Server Notifications V2（JWS 签名，需验签后解码）
 *   Android   : Google Play Real-time Developer Notifications（Pub/Sub）
 *   自建/Web  : Stripe Webhook
 *
 * 这里把"各家通知类型"统一翻译成本系统认识的 5 个事件，
 * 好处是业务代码只写一遍。
 *
 * ⚠️ 生产环境务必先验签再解析，不要相信任何未验签的 body。
 */

/** App Store Server Notifications V2 的 notificationType(+subtype) → 内部事件 */
const APPLE_MAP = {
  SUBSCRIBED: 'purchase',
  DID_RENEW: 'renew',
  DID_CHANGE_RENEWAL_STATUS: 'cancel', // 仅当 subtype === 'AUTO_RENEW_DISABLED'
  EXPIRED: 'expire',
  REFUND: 'refund',
  REVOKE: 'revoke',
};

/** Google Play RTDN 的 notificationType → 内部事件 */
const GOOGLE_MAP = {
  1: 'recover', // SUBSCRIPTION_RECOVERED
  2: 'renew', // SUBSCRIPTION_RENEWED
  3: 'cancel', // SUBSCRIPTION_CANCELED
  4: 'purchase', // SUBSCRIPTION_PURCHASED
  5: 'expire', // SUBSCRIPTION_ON_HOLD
  7: 'renew', // SUBSCRIPTION_RESTARTED
  12: 'revoke', // SUBSCRIPTION_REVOKED
  13: 'expire', // SUBSCRIPTION_EXPIRED
};

/**
 * 把 Apple 通知翻译成事件。expire 类事件本系统不落库（靠时间自动判定过期），
 * 所以返回 null —— 但保留映射便于日志。
 */
export function mapAppleNotification({ notificationType, subtype, userId, productId, transactionId, at }) {
  if (notificationType === 'DID_CHANGE_RENEWAL_STATUS' && subtype !== 'AUTO_RENEW_DISABLED') {
    return null; // 用户重新打开自动续订，无需处理
  }
  const type = APPLE_MAP[notificationType];
  if (!type) return null;
  if (type === 'expire') return { type: 'expire', userId, productId, at, note: '到期由时间自动判定' };
  return { type, userId, productId, transactionId, platform: 'apple', at };
}

export function mapGoogleNotification({ notificationType, userId, productId, transactionId, at }) {
  const type = GOOGLE_MAP[notificationType];
  if (!type) return null;
  if (type === 'expire') return { type: 'expire', userId, productId, at, note: '到期由时间自动判定' };
  if (type === 'recover') return { type: 'renew', userId, productId, transactionId, platform: 'google', at };
  return { type, userId, productId, transactionId, platform: 'google', at };
}
