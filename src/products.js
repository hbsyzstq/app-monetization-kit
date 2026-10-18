/**
 * 商品目录（Product Catalog）
 *
 * 设计要点：商品（Product）和权益（Entitlement）解耦。
 * App 代码里判断的永远是 "用户有没有 ad_free 这个权益"，
 * 而不是 "用户买没买 pro.monthly" —— 这样以后换价格、加促销、搞捆绑包，
 * 客户端一行都不用改。
 */

export const PERIODS = {
  week: { label: '周', add: (d) => d.setDate(d.getDate() + 7) },
  month: { label: '月', add: (d) => d.setMonth(d.getMonth() + 1) },
  year: { label: '年', add: (d) => d.setFullYear(d.getFullYear() + 1) },
};

/**
 * period 为 null 表示买断（永久），没有到期时间。
 * entitlements 是这个商品解锁的权益列表，一个商品可以给多个权益。
 */
export const PRODUCTS = {
  'pro.monthly': {
    title: 'Pro 月订阅',
    period: 'month',
    entitlements: ['ad_free', 'pro_features', 'cloud_sync'],
  },
  'pro.yearly': {
    title: 'Pro 年订阅',
    period: 'year',
    entitlements: ['ad_free', 'pro_features', 'cloud_sync'],
  },
  'pro.lifetime': {
    title: 'Pro 买断',
    period: null,
    entitlements: ['ad_free', 'pro_features', 'cloud_sync'],
  },
  'adfree.lifetime': {
    title: '去广告（买断）',
    period: null,
    entitlements: ['ad_free'],
  },
};

export function getProduct(productId) {
  const p = PRODUCTS[productId];
  if (!p) throw new Error(`未知商品: ${productId}`);
  return p;
}
