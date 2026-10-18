# 参考仓库与资料

已克隆到本地 `../repos/`（浅克隆，只取最新代码）。

## 内购 / 订阅 SDK（读源码最有价值的部分）

| 仓库 | 本地 | 规模 | 看什么 |
|---|---|---|---|
| [RevenueCat/purchases-ios](https://github.com/RevenueCat/purchases-ios) | `repos/purchases-ios` | 62M | 业界最成熟的订阅封装。重点看它如何统一 StoreKit 1/2、如何做权益缓存与离线降级、如何抽象 Purchases/Entitlement/CustomerInfo 三层 |
| [bizz84/SwiftyStoreKit](https://github.com/bizz84/SwiftyStoreKit) | `repos/SwiftyStoreKit` | 2.8M | 轻量版 StoreKit 1 封装，代码量小适合通读。理解 `restore`、`verifyReceipt`、交易队列 |

**建议阅读顺序**：先 SwiftyStoreKit 搞懂交易生命周期，再看 purchases-ios 学工程化。

## 广告过滤

| 仓库 | 本地 | 规模 | 看什么 |
|---|---|---|---|
| [gorhill/uBlock](https://github.com/gorhill/uBlock) | `repos/uBlock` | 20M | 过滤引擎的实现。`src/js/` 下的静态网络过滤、动态过滤、规则解析器，是同类里最完整的 |
| [AdguardTeam/AdguardFilters](https://github.com/AdguardTeam/AdguardFilters) | 未克隆 | 大 | 过滤规则本身（不是代码），体积大，按需拉 |
| [easylist/easylist](https://github.com/easylist/easylist) | 未克隆 | 中 | EasyList 规则源，App 内 WebView 过滤可直接取用 |

## 授权/许可服务（自建参考）

| 仓库 | 说明 |
|---|---|
| [keygen-sh/keygen-api](https://github.com/keygen-sh/keygen-api) | 开源许可证管理服务（Ruby），适合看"设备绑定、离线激活、许可策略"怎么建模 |
| [apple/app-store-server-library-node](https://github.com/apple/app-store-server-library-node) | 苹果官方服务端库（Node 版），做 App Store Server API 校验和通知验签直接用 |
| [stripe/stripe-node](https://github.com/stripe/stripe-node) | Web 端订阅，配合 Checkout + Webhook |

## 官方文档（比任何教程都准）

- App Store Server API / Notifications V2：<https://developer.apple.com/documentation/appstoreserverapi>
- StoreKit 2 迁移：<https://developer.apple.com/documentation/storekit>
- Google Play Billing：<https://developer.android.com/google/play/billing>
- Play Developer API 订阅查询：<https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2>
- Stripe 订阅：<https://docs.stripe.com/billing/subscriptions/overview>
- ATT 隐私授权：<https://developer.apple.com/documentation/apptrackingtransparency>

## 关于 Android 官方 sample

`android/play-billing-samples` 与 `android/play-samples` 都已不可访问（仓库被移除/改名），
建议直接看上面 Google 官方文档里的最小示例，或参考 RevenueCat 的 Android SDK
（[RevenueCat/purchases-android](https://github.com/RevenueCat/purchases-android)）的结构。
