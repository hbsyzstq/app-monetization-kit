# 02 · 各平台接入要点

## 通用原则

**客户端的购买结果不能直接信。** 客户端只能告诉你「我买了」，是否真的付了钱，
必须问商店的服务器（或商店签名的凭据）。任何"客户端说买了就给他权限"的设计，
等于把付费功能免费开放。

标准流程：

```
客户端发起购买 → 商店扣款 → 拿到交易凭据
                              │
                              ├─> 客户端把凭据发给你的服务端
                              │
你的服务端 ──> 商店校验接口（Apple/Google）──> 确认有效
                              │
                        写入 Purchase → 返回权益
```

## iOS / macOS（StoreKit 2）

StoreKit 2 起，交易对象自带 **JWS 签名**，可以本地校验，比老版 `receipt` 简单得多。

```swift
for await result in Transaction.updates {
    guard case .verified(let tx) = result else { continue }  // 未通过签名的直接丢弃
    // tx.productID / tx.expirationDate / tx.revocationDate
    await sendToServer(tx.jsonRepresentation)
    await tx.finish()
}
```

要点：

- `Transaction.updates` 必须**在 App 启动时就监听**，用来接住「在别的设备上买的」「家长批准后到账的」「退款」这些异步事件。
- 服务端用 **App Store Server API** 二次校验，并接收 **App Store Server Notifications V2**
  （退款、续订失败都靠它推送过来）。通知是 JWS，**必须先验签**再解 payload。
- 恢复购买用 `AppStore.sync()`，注意它不是"恢复"按钮的唯一实现，`Transaction.currentEntitlements` 才是真相来源。

## Android（Google Play Billing）

- 客户端拿到 `PurchaseToken` 后立刻发给服务端
- 服务端调 **Google Play Developer API** `purchases.subscriptionsv2.get` 确认状态
- 必须**消费/确认**交易（`acknowledge`），否则 3 天后自动退款
- 订阅状态变化靠 **Real-time Developer Notifications**（Pub/Sub 推送）
- 注意 Google 的 `PaymentState`：`PENDING`（延迟付款）在部分地区很常见，别当成功处理

## Web / 自建

- Stripe Checkout + Webhook，`checkout.session.completed` / `invoice.paid` /
  `customer.subscription.deleted` 对应本项目的 purchase / renew / cancel
- Webhook **必须验签**（`stripe.webhooks.constructEvent`），并用事件 ID 做幂等

## 幂等：别把续订记成两笔

平台的通知会重发（至少一次投递），网络也会重试。所以：

- 用 `transactionId` 做唯一键，重复事件直接丢弃
- `renew` 事件的到期时间应该从**原到期时间**往后推，而不是从"现在"推 ——
  否则补发的旧事件会把用户的订阅期缩短（本项目 `apply()` 里 `Math.max(now, expiresAt)` 就是干这个的）

## 一张对照表

| 概念 | Apple | Google | Stripe |
|---|---|---|---|
| 交易唯一标识 | `transactionId` | `purchaseToken` | `event.id` |
| 到期时间 | `expirationDate` | `expiryTime` | `current_period_end` |
| 退款通知 | `REFUND` | `SUBSCRIPTION_REVOKED` | `charge.refunded` |
| 关闭自动续订 | `DID_CHANGE_RENEWAL_STATUS` | `SUBSCRIPTION_CANCELED` | `customer.subscription.updated` |
| 扣款失败宽限 | `DID_FAIL_TO_RENEW` + `GRACE_PERIOD` | `SUBSCRIPTION_ON_HOLD` | `invoice.payment_failed` |
