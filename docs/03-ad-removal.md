# 03 · 去广告的两种含义

这个词在开发里指两件完全不同的事，混在一起会导致架构跑偏：

| 含义 | 场景 | 技术手段 |
|---|---|---|
| **A. 付费去广告**（变现） | 你自己 App 里的插屏/激励视频 | 权益门控 + 广告层抽象 |
| **B. 内容端过滤广告**（功能） | 你的 App 内嵌 WebView 打开网页 | 内容拦截规则（WKContentRuleList） |

本文主要讲 A，因为它是「开会员」的核心卖点；B 放在最后。

## A. 付费去广告的正确写法

### 1. 广告位要抽象成一层

```swift
protocol AdProvider {
    func loadInterstitial()
    func showInterstitial(from vc: UIViewController)
    func showRewarded(from vc: UIViewController) async -> Bool
}

struct RealAdProvider: AdProvider { /* 接 AdMob / Pangle / 穿山甲 */ }
struct NullAdProvider: AdProvider {  // 付费用户用它
    func loadInterstitial() {}
    func showInterstitial(from vc: UIViewController) {}
    func showRewarded(from vc: UIViewController) async -> Bool { true }  // 直接发奖励
}
```

好处是**付费用户从启动开始就不会初始化广告 SDK** —— 不只是"不显示"，
而是完全不加载。省流量、省电、少上报、少一个隐私合规项。

### 2. 全 App 只有一个广告出口

```swift
final class AdGate {
    private let ent: Entitlements
    private let provider: AdProvider

    init(_ ent: Entitlements) {
        self.ent = ent
        self.provider = ent.has("ad_free") ? NullAdProvider() : RealAdProvider()
    }

    func maybeShowInterstitial(from vc: UIViewController, at slot: AdSlot) {
        guard !ent.has("ad_free") else { return }
        guard FrequencyCap.shared.allow(slot) else { return }  // 频次控制
        provider.showInterstitial(from: vc)
    }
}
```

反例是到处写 `if !isPaid { ad.show() }` —— 二十个调用点，二十次判断，
漏一个就有付费用户看到广告，然后一星差评。

### 3. 用户刚买完要立刻生效

购买成功的回调里，做三件事：

1. 更新本地权益缓存
2. 拆掉当前正在显示的 banner（`bannerView.removeFromSuperview()`）
3. 通知各个已存在的页面刷新（用 `NotificationCenter` 或状态流）

别指望"重启 App 后生效"，那是最容易被投诉的点。

### 4. 激励视频是个例外

激励视频是**用户主动看广告换东西**（复活、加次数、解锁临时功能）。
即使买了「去广告」，这个入口也应该保留，并且要标明"看广告可获得 XX"。
如果一刀切禁掉，反而剥夺了付费用户的免费获取途径。

### 5. 留一个远程开关

```json
{ "ads_enabled": true, "interstitial_min_interval_sec": 180 }
```

广告平台故障、审核被拒、节日活动临时关闭广告 —— 这些都要能不发版就改。

## B. WebView 内容端过滤

如果 App 里用 `WKWebView` 打开网页（论坛、新闻、文档），可以用 Apple 原生的内容拦截：

```swift
let json = """
[{
  "trigger": { "url-filter": ".*", "resource-type": ["image"] },
  "action": { "type": "block" }
}]
"""
WKContentRuleListStore.default().compileContentRuleList(
    forIdentifier: "AdBlock", encodedContentRuleList: json
) { list, error in
    webView.configuration.userContentController.add(list!)
}
```

要点：

- 规则可参考 EasyList / AdGuard 的过滤器语法，但 **WKContentRuleList 只支持其中一部分**，
  不能直接复用，需要转换
- 只对 WebView 生效，**管不到 App 自己的原生广告 SDK 流量**
- 别顺手拦截统计/埋点，那会让你的数据失真
- 用户可能因为"你的 App 帮他去广告"而误解为全系统去广告，宣传上要说清

## 隐私合规（这条最容易踩）

- iOS 上个性化广告需要 **ATT 授权**（`ATTrackingManager.requestTrackingAuthorization`），
  用户拒绝就不能拿 IDFA
- 用户买了去广告之后，**不应该再请求广告标识符**，也不该再初始化广告 SDK
- 儿童类 App 的广告限制更严（COPPA / 未成年人保护）
- 隐私清单（`PrivacyInfo.xcprivacy`）里要如实申报广告相关数据收集
