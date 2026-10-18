# app-monetization-kit

给自研 App 准备的**变现骨架**：会员/内购的权益服务 + 付费去广告的实现模式 + 授权防篡改要点。
零第三方依赖，纯 Node.js，自带 21 个测试。

> 面向「实现侧」：你自己 App 怎么加会员、怎么用权益控制去广告、怎么防别人改你的授权。
> 不包含绕过他人内购校验的内容 —— 那属于侵权，且会直接导致应用商店拒审。

## 30 秒跑起来

```bash
npm test                 # 21 个测试，全绿
ADMIN_KEY=dev-admin TOKEN_SECRET=dev-secret npm start
```

```bash
# 模拟一次月订阅购买（真实场景由平台回调触发）
curl -X POST http://127.0.0.1:8787/v1/events \
  -H "authorization: Bearer dev-admin" -H "content-type: application/json" \
  -d '{"type":"purchase","userId":"u_1001","productId":"pro.monthly","transactionId":"tx_abc"}'
```

返回该用户当前权益：

```json
{
  "userId": "u_1001",
  "entitlements": ["ad_free", "pro_features", "cloud_sync"]
}
```

一次退款，权益立刻清空：

```bash
curl -X POST http://127.0.0.1:8787/v1/events \
  -H "authorization: Bearer dev-admin" -H "content-type: application/json" \
  -d '{"type":"refund","userId":"u_1001","productId":"pro.monthly"}'
# → {"userId":"u_1001","entitlements":[]}
```

## 核心设计：商品与权益解耦

```
用户 ──购买──> 商品 ──解锁──> 权益 ──控制──> 功能
             pro.monthly      ad_free       去广告
             pro.yearly       pro_features  高级功能
             adfree.lifetime  cloud_sync    云同步
```

客户端只判断 `has('ad_free')`，不关心这个权益是谁给的。
以后换价格、加年付、搞捆绑包、做限时促销 —— **客户端一行都不用改**。

## 目录

```
src/
  products.js      商品目录：周期 + 它解锁哪些权益
  entitlement.js   状态机：购买/续订/取消/退款/撤销 → 当前权益（时间是注入的）
  token.js         离线令牌：HMAC 签名，客户端断网也能判断
  storekit.js      平台通知翻译：Apple / Google → 内部 5 种事件
  server.js        HTTP 层（node:http，零依赖）
test/
  entitlement.test.js   13 个：状态机边界（宽限期、退款、续订、权益合并）
  server.test.js         8 个：接口鉴权、令牌篡改、通知幂等
docs/
  01-entitlement-model.md   授权模型与状态机
  02-iap-platforms.md       StoreKit2 / Play Billing / Stripe 接入要点
  03-ad-removal.md          付费去广告的正确写法（含反例）
  04-hardening.md           防篡改分层防线 + 自测清单
references.md               值得读的源码仓库
```

## 接口

| 方法 | 路径 | 鉴权 | 作用 |
|---|---|---|---|
| GET | `/healthz` | 无 | 健康检查 |
| POST | `/v1/events` | admin key | 写入购买/续订/取消/退款/撤销，或直接投喂平台通知 |
| GET | `/v1/users/:id` | admin key | 查权益与购买记录 |
| GET | `/v1/users/:id/token` | admin key | 签发离线令牌（默认 24h） |
| POST | `/v1/users/:id/revoke` | admin key | 风控撤销某商品权益 |
| GET | `/v1/me` | Bearer token | 客户端凭令牌自证 |

`POST /v1/events` 支持两种入参：内部事件，或带 `source: "apple" | "google"` 的平台通知。

## 已经处理掉的坑

- **cancel 不等于立即失效**：用户关自动续订，已付周期要用完
- **宽限期只给还在自动续订的订阅**：扣款失败重试期间不断服务，已取消的不给
- **退款/撤销立即失效，不给宽限期**
- **续订从「原到期时间」往后推**，不是从"现在"推 —— 否则补发的旧事件会缩短用户订阅期
- **多商品解锁同一权益取最宽松的**：永久 > 到期晚 > 宽限期内
- **令牌失败安全**：未知状态一律不放行，签名用定长比较
- **到期不落库**：过期由时间推导，避免脏数据

## 测试

```bash
$ npm test
ℹ tests 21
ℹ pass 21
ℹ fail 0
```

时间通过 `clock` 注入，所以「三个月后会不会过期」可以瞬间验证，不用真的等。

## 上生产前必改

1. `ADMIN_KEY` / `TOKEN_SECRET` 换成真随机值（默认值仅本地调试）
2. 把 `EntitlementService` 的内存 Map 换成数据库（PostgreSQL / SQLite），同时落事件表
3. 平台通知**先验签再解析**（Apple 是 JWS，Google 是 Pub/Sub）
4. 加限流与审计日志（谁在什么时候改了谁的权益）

## License

MIT
