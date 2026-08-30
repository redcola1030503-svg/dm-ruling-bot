# サブスクリプション課金機能 設計書

- 作成日: 2026-08-30
- 対象: dm-ruling-bot モバイルアプリ(Android/iOS)。LINE Bot版はスコープ外
- 背景: アプリ正式リリースにあたり、Claude API原価がAdMob広告収益を大きく上回る赤字構造(Obsidian Vault内「ランニングコスト・AdMob広告収益の概算」参照)を、最低限の追加課金で緩和する
- 目的: 収益最大化ではなく「赤字を防ぐ最低限の水準」に価格を抑えたサブスクリプションを導入する

## 1. 主要な意思決定サマリー

| 項目 | 決定内容 | 根拠 |
|---|---|---|
| ゲート方式 | 無料枠(月10問)+ 超過分はサブスク必須 | ライトユーザーの体験・口コミを維持しつつ、コストの大半を占めるヘビーユーザー層のみ課金対象にする |
| 無料枠の値 | 月10問 | 2026-08-30実施のテスト利用ログ(124ジョブ/46台)を分析。上位3〜6台(全体の13〜15%)が総質問数の約41%を占めており、この層のみが確実に無料枠を超える設計とした。ただしテストは11日間・46台と小規模かつ初日の一斉インストール急増を含むため、正式リリース後の実データで再検証が必要 |
| 価格 | 月額300円 | Claude API原価(モバイルBatch API適用、中間4.5円/問)を基準に、最悪ケース(月38問・全問が重い質問=5.4円/問)でも赤字にならない水準として算出。250円だと極端なヘビーユーザー1人で利益がほぼ消える |
| プラン形式 | 単一プラン・使い放題(上限なし) | 実装をシンプルに保つため。現状の最大ユーザー規模(11日間で最大14問)ではリスクは小さい |
| 対象範囲 | モバイルアプリのみ | LINE Botは別系統・別決済手段が必要になり実装コストが大きく膨らむため今回は対象外 |
| 決済実装方式 | RevenueCat経由 | Apple/Google個別のサーバー間通知検証・署名検証・鍵管理を自前で持たずに済み、非営利・個人開発の保守コストに見合う。この規模の売上ならRevenueCatは無料枠内 |
| 不正対策レベル | 軽量対策(永続ストレージにdeviceId保存) | App Attest/Play Integrityによる本格対策は非営利アプリには過剰。iOS Keychain・AndroidのKeystore/暗号化SharedPreferences等、アプリ削除後も残る領域にdeviceIdを保存し、単純な「アプリデータ削除」による無料枠リセットを防ぐ。悪意ある自動化(API直叩き・deviceIdランダム化)までは防がない前提を許容 |

## 2. アーキテクチャ

```
モバイルアプリ(Flutter)
  ├─ purchases_flutter(RevenueCat SDK)でApple/Google課金を実行
  ├─ RevenueCatのappUserIdには既存の deviceId をそのまま使う(新しいアカウント概念を作らない)
  ├─ deviceIdはiOS Keychain / AndroidのEncryptedSharedPreferences等、永続領域に保存(アプリ再インストールでも維持)
  └─ 質問送信前に GET /api/ruling/usage で「今月の残り無料回数」「購読状態」を取得し、0かつ未購読ならペイウォールへ誘導

バックエンド(Node.js/Express)
  ├─ 新規テーブル device_subscription(device_id PRIMARY KEY, active_until INTEGER, updated_at INTEGER)
  ├─ POST /api/billing/revenuecat-webhook
  │    RevenueCatからの購読開始・更新・解約・返金イベントを受け、共有シークレット検証後にdevice_subscriptionを更新
  ├─ POST /api/billing/sync
  │    購入直後にアプリから呼ばれ、RevenueCatのREST API(GetCustomerInfo)へ即時問い合わせてdevice_subscriptionを即時反映(Webhook到達遅延の救済)
  ├─ GET /api/ruling/usage
  │    当月のruling_job件数(device_id一致)とdevice_subscription.active_untilから残り無料回数・購読状態を返す
  └─ POST /api/ruling/jobs に無料枠チェックを追加
       当月のruling_job件数(device_id一致) ≥ 10 かつ device_subscription.active_until が現在時刻より前(または未登録)なら 402 { error: "subscription_required" } を返す
```

**設計原則**: サーバー側の購読状態は常にRevenueCat(Webhook/REST API)が唯一の情報源(source of truth)。クライアントからの自己申告(「購読済みです」)は一切信用しない。

無料枠のカウントは新しいカウンターテーブルを作らず、既存の`ruling_job`テーブルを`device_id`+`created_at`(当月分)で集計する(データの二重管理を避ける)。

## 3. データフロー

**通常の質問送信(無料枠内)**
```
アプリ → GET /api/ruling/usage (deviceId)
     ← { remainingFree: 3, subscriptionActive: false }
アプリ → POST /api/ruling/jobs (deviceId, question)
サーバー: 当月のruling_job件数 < 10 なら受理 → 202 Accepted
```

**無料枠超過・未購読**
```
アプリ → POST /api/ruling/jobs
サーバー: 当月10件以上 かつ 未購読/期限切れ → 402 { error: "subscription_required" }
アプリ: ペイウォール画面を表示
```

**購入**
```
アプリ → RevenueCat SDK経由でApple/Google課金を実行
アプリ → 購入完了コールバック後 POST /api/billing/sync を呼び、即時に購読状態をDBへ反映
Apple/Google → RevenueCat → Webhook → POST /api/billing/revenuecat-webhook (非同期の以後の更新・解約・返金反映用)
アプリ: 質問送信を再試行
```

**再インストール後の復元**
```
アプリ起動 → Keychain/Keystoreから永続deviceIdを読み出し(新規発行しない)
     → RevenueCat SDKの restorePurchases() で購読状態を再同期
     → 通常フローに合流(サーバー側のdevice_subscriptionは既存レコードがそのまま有効)
```

## 4. セキュリティ

- **Webhook認証**: `POST /api/billing/revenuecat-webhook`はRevenueCatが送る`Authorization`ヘッダの共有シークレットを定数時間比較で検証し、不一致は401で即拒否。シークレットは環境変数で管理し、ログに出力しない
- **deviceIdなりすまし・リセットリスク(既知の限界)**: `deviceId`はクライアント自己申告であり、サーバー側の暗号学的検証は行わない。iOS Keychain/AndroidのEncryptedSharedPreferences等の永続領域に保存することで、単純な「アプリデータ削除」による無料枠リセットは防止するが、API直叩きによるdeviceIdランダム化のような能動的な不正利用までは技術的に防止しない。非営利・小規模アプリという前提でこのリスクは受容する(本格対策=App Attest/Play Integrityは今回は不採用)
- **信頼境界**: 購読状態の判定は常にサーバー側DBの`device_subscription`を参照し、クライアントからの自己申告フラグは一切信用しない

## 5. エラーハンドリング・エッジケース

- Webhookの署名不正 → 401、DBは変更しない
- Webhookの二重配信・リトライ → `active_until`を絶対時刻で上書きする設計のため冪等
- 未知のイベント種別 → 無視してログのみ残す
- 購入直後のWebhook遅延 → `POST /api/billing/sync`で即時救済
- 解約・返金(`EXPIRATION`/`CANCELLATION`イベント) → `active_until`を過去に更新し、以降のリクエストは無料枠判定へ戻る
- 請求リトライ猶予期間 → RevenueCatが計算済みの有効期限をそのまま信頼し、特別扱いしない
- 既存のレート制限(`rulingRateLimiter`) → サブスク状態に関わらず現状通り適用を継続

## 6. テスト方針

- **ユニットテスト**: 月内ジョブ件数カウント(境界値=ちょうど10件)、Webhook署名検証(正/不正)、イベント種別ごとの`active_until`更新ロジック、`/api/billing/sync`のRevenueCat REST API呼び出し
- **結合テスト**: `device_subscription`の状態(未購読/有効/期限切れ)をモックし、`/api/ruling/jobs`が202/402を正しく返し分けることを確認
- **手動E2E**: Android(ライセンステスター)・iOS(Sandboxアカウント)双方でRevenueCatサンドボックス決済を実行し、購入→即時利用可、アプリ再インストール→deviceId復元→`restorePurchases()`で購読復元、を実機確認
- 既存テストスイート(137件超)への影響なし、新規テストのみ追加

## 7. 今後の宿題(スコープ外・要フォローアップ)

- Apple/Googleの手数料軽減プログラム(中小企業向けプログラム、年間売上100万ドル未満で15%)への申請が前提の価格設計のため、正式リリース前に申請を済ませておく必要がある
- 無料枠(月10問)は小規模・短期間のテストデータに基づく初期仮説であり、正式リリース後に`llm_usage`ログと実際の質問数から再検証すること
- RevenueCatを利用することで購入データが第三者(RevenueCat)を経由するため、プライバシーポリシー(`docs/mobile-app-privacy-policy.html`)への追記が必要
- 本設計はモバイルアプリのみが対象。LINE Bot版への同様の課金導入は別途検討が必要
