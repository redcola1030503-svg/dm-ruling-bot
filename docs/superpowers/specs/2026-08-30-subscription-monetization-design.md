# サブスクリプション課金機能 設計書

- Status: Current(2026-09-02更新。D-001/D-003/D-005の内容へ整合させた。旧内容との差分は本ファイル末尾「変更履歴」参照)
- 作成日: 2026-08-30
- 対象: dm-ruling-bot モバイルアプリ(Android/iOS)。LINE Bot版は2026-09-02に廃止済み(D-002)
- 背景: アプリ正式リリースにあたり、Claude API原価がAdMob広告収益を大きく上回る赤字構造(Obsidian Vault内「ランニングコスト・AdMob広告収益の概算」参照)を、最低限の追加課金で緩和する
- 目的: 収益最大化ではなく「赤字を防ぐ最低限の水準」に価格を抑えたサブスクリプションを導入する

**この設計書は`DECISIONS.md`(採用判断の正本)に従属する。本文と`DECISIONS.md`が食い違う場合は`DECISIONS.md`を優先し、この設計書側の記載が古い。文書の優先順位: `DECISIONS.md`(採用判断) → 本ファイルを含む`docs/superpowers/specs/`(現行仕様) → 実装/テスト(現在の実際の挙動) → `docs/superpowers/plans/`(当時の実装計画、履歴)。**

## 1. 主要な意思決定サマリー

| 項目 | 決定内容 | 根拠 |
|---|---|---|
| ゲート方式 | 無料枠(月10問)+ 超過分はサブスク必須 | ライトユーザーの体験・口コミを維持しつつ、コストの大半を占めるヘビーユーザー層のみ課金対象にする |
| 無料枠の値 | 月10問 | 2026-08-30実施のテスト利用ログ(124ジョブ/46台)を分析。上位3〜6台(全体の13〜15%)が総質問数の約41%を占めており、この層のみが確実に無料枠を超える設計とした。ただしテストは11日間・46台と小規模かつ初日の一斉インストール急増を含むため、正式リリース後の実データで再検証が必要 |
| 価格 | 月額300円 | Claude API原価(モバイルBatch API適用、中間4.5円/問)を基準に、最悪ケース(月38問・全問が重い質問=5.4円/問)でも赤字にならない水準として算出。250円だと極端なヘビーユーザー1人で利益がほぼ消える |
| プラン形式 | 単一プラン・使い放題(上限なし) | 実装をシンプルに保つため。現状の最大ユーザー規模(11日間で最大14問)ではリスクは小さい |
| 対象範囲 | モバイルアプリのみ | LINE Botは別系統・別決済手段が必要になり実装コストが大きく膨らむため今回は対象外 |
| 決済実装方式 | RevenueCat経由 | Apple/Google個別のサーバー間通知検証・署名検証・鍵管理を自前で持たずに済み、非営利・個人開発の保守コストに見合う。この規模の売上ならRevenueCatは無料枠内 |
| 不正対策レベル | 軽量対策・インストール単位ID(D-005) | App Attest/Play Integrityによる本格対策は非営利アプリには過剰。deviceIdはiOS Keychain・AndroidのEncryptedSharedPreferences(`flutter_secure_storage`)に保存する。Androidでは、この保存領域はアプリデータ削除・アンインストールで失われ、D-005によりこの再インストール時の無料枠リセットを既知の限界として受容する(案A、Android Auto Backup経由の意図しない引き継ぎ自体はバックアップ対象から除外して防いでいる)。iOSのKeychainはアプリ削除後も端末に値が残る場合があり、Androidと同じ限界は当てはまらない(再インストール後もdeviceIdが維持され得る)。いずれのOSでも、再インストールをまたぐdeviceIdの同一性は保証しない仕様として扱う。悪意ある自動化(API直叩き・deviceIdランダム化)までは防がない前提も従来通り許容 |

## 2. アーキテクチャ

```
モバイルアプリ(Flutter)
  ├─ purchases_flutter(RevenueCat SDK)でApple/Google課金を実行
  ├─ RevenueCatのappUserIdには既存の deviceId をそのまま使う(新しいアカウント概念を作らない)
  ├─ deviceId(D-005)は flutter_secure_storage に保存するインストール単位ID。
  │    DeviceIdProvider(mobile_app/lib/push/device_id.dart)が、保存の読み書き
  │    失敗時も同一プロセス内では常に同じIDを返すようクラス共有のメモリ
  │    キャッシュを持つ。アプリデータ削除・再インストールでは新しいIDが
  │    生成される(無料枠リセットは既知の限界として受容)
  └─ 質問送信前に GET /api/ruling/usage で「今月の残り無料回数」「購読状態」を取得し、0かつ未購読ならペイウォールへ誘導

バックエンド(Node.js/Express)
  ├─ device_subscription(device_id PRIMARY KEY, active_until INTEGER, updated_at INTEGER)
  │    購読状態。RevenueCat(Webhook/REST API)を唯一の情報源として更新する
  ├─ device_monthly_usage(device_id, month_key, count。PRIMARY KEY (device_id, month_key))(D-003)
  │    無料枠の消費数を管理する独立カウンタ。当初案の「ruling_jobテーブルの
  │    当月行数を数える」方式は、モバイル側の「スレッド削除」機能がruling_job
  │    行を物理削除するため無料枠が復活してしまう不具合が発覚し却下された
  │    (D-003)。ruling_job/ruling_threadの削除とは非連動で、ジョブ作成時に
  │    のみインクリメントする
  ├─ POST /api/billing/revenuecat-webhook
  │    RevenueCatからの購読開始・更新・解約・返金イベントを受け、共有シークレット検証後にdevice_subscriptionを更新
  ├─ POST /api/billing/sync
  │    購入直後にアプリから呼ばれ、RevenueCatのREST API(GetCustomerInfo)へ即時問い合わせてdevice_subscriptionを即時反映(Webhook到達遅延の救済)
  ├─ GET /api/ruling/usage
  │    当月のdevice_monthly_usage.count(device_id一致)とdevice_subscription.active_untilから残り無料回数・購読状態を返す
  └─ POST /api/ruling/jobs に無料枠チェックを追加
       当月のdevice_monthly_usage.count(device_id一致) ≥ 10 かつ device_subscription.active_until が現在時刻より前(または未登録)なら 402 { error: "subscription_required" } を返す。
       ジョブ作成とカウンタ加算は同一トランザクションで行い(billingTransaction.ts)、購読中(hasActiveSubscription)はカウンタを加算しない(=無料枠を消費しない)
```

**既知の並行性課題**: `getMonthlyUsageCount`による上限判定はトランザクション開始前に行われており、上限直前の並行リクエストで理論上枠超過があり得る(Codexレビュー指摘、PR #1)。現在の本番構成(Render `plan: starter`、単一インスタンス)かつハンドラー内に`await`が無い(同期SQLite呼び出しのみ)ため、実際には他リクエストが割り込む余地が無く実害は無いと考えられるが、将来インスタンスを複数に増やす場合は`BEGIN IMMEDIATE`等での原子化が必要(`actions/dm-ruling-bot_残作業リスト.md`(Vault側)にfollow-upとして記録済み)。

**設計原則**: サーバー側の購読状態は常にRevenueCat(Webhook/REST API)が唯一の情報源(source of truth)。クライアントからの自己申告(「購読済みです」)は一切信用しない。

無料枠のカウントは`device_monthly_usage`独立カウンタで管理する(D-003)。当初は既存の`ruling_job`テーブルを`device_id`+`created_at`(当月分)で集計しデータの二重管理を避ける設計だったが、モバイル側の「スレッド削除」機能で`ruling_job`行が物理削除されると無料枠が復活してしまう不具合が発覚し却下された。

## 3. データフロー

**通常の質問送信(無料枠内)**
```
アプリ → GET /api/ruling/usage (deviceId)
     ← { remainingFree: 3, subscriptionActive: false }
アプリ → POST /api/ruling/jobs (deviceId, question)
サーバー: 当月のdevice_monthly_usage.count < 10 なら受理 → 202 Accepted(非購読ジョブのみカウンタを+1)
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

**Androidでアプリデータ削除・再インストール後(D-005)**

D-005はAndroidの`flutter_secure_storage`(EncryptedSharedPreferences)の挙動を対象とした決定であり、iOSのKeychainには同じ限界が当てはまらない。Keychainはアプリ削除後も値が端末に残る場合があり、再インストール後に旧deviceIdが復元されることがある。この設計書・プライバシーポリシー等では「再インストールをまたぐdeviceIdの同一性は保証しない」という仕様として扱い、OSごとの挙動差を断定しない。

```
(Android、既存IDが失われたケース)
アプリ起動 → flutter_secure_storageに既存IDが無い(削除された)ため、新しいdeviceIdを生成
     → 無料枠(device_monthly_usage)・質問履歴は新しいdeviceId扱いになり、旧IDの分は引き継がれない(既知の限界として受容)
     → RevenueCat SDKの restorePurchases() を呼ぶ。同一ユーザーの既存購読を新しいappUserId
        (=新deviceId)へ引き継ぐには、RevenueCatダッシュボードのRestore Behaviorを
        「Transfer to new App User ID」に設定しておく必要がある(**未確認・要設定確認、T002参照**)
     → アプリ → POST /api/billing/sync (新deviceId) を呼び、restorePurchases()後のRevenueCat
        購読状態をバックエンドのdevice_subscription(新deviceId行)へ即時反映
     → 通常フローに合流(無料枠カウンタは新規、購読状態は正しく設定されていれば復元される)
```
```

## 4. セキュリティ

- **Webhook認証**: `POST /api/billing/revenuecat-webhook`はRevenueCatが送る`Authorization`ヘッダの共有シークレットを定数時間比較で検証し、不一致は401で即拒否。シークレットは環境変数で管理し、ログに出力しない
- **deviceIdなりすまし・リセットリスク(既知の限界、D-005)**: `deviceId`はクライアント自己申告であり、サーバー側の暗号学的検証は行わない。D-005により、deviceIdは永続的な端末/ユーザーIDではなく「インストール単位ID」として扱う方針を採用しており、単純な「アプリデータ削除」や再インストールによる無料枠リセットも既知の限界として明示的に受容する(以前の設計では防止対象としていたが方針転換した)。API直叩きによるdeviceIdランダム化のような能動的な不正利用も同様に技術的に防止しない。非営利・小規模アプリという前提でこれらのリスクは受容する(本格対策=App Attest/Play Integrityは今回は不採用、実際に悪用が顕在化すれば別タスクとして再検討する)
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

- **ユニットテスト**: `device_monthly_usage`カウント(境界値=ちょうど10件)、Webhook署名検証(正/不正)、イベント種別ごとの`active_until`更新ロジック、`/api/billing/sync`のRevenueCat REST API呼び出し、`DeviceIdProvider`の保存読み書き失敗時・並行呼出し時の挙動(`mobile_app/test/device_id_test.dart`)
- **結合テスト**: `device_subscription`の状態(未購読/有効/期限切れ)をモックし、`/api/ruling/jobs`が202/402を正しく返し分けることを確認
- **手動E2E**: Android(ライセンステスター)・iOS(Sandboxアカウント)双方でRevenueCatサンドボックス決済を実行し、購入→即時利用可、アプリデータ削除→新規deviceId発行→`restorePurchases()`で購読状態のみ復元(無料枠は新規扱い)、を実機確認(未実施、T002 follow-up)
- 既存テストスイートへの影響なし、新規テストのみ追加

## 7. 今後の宿題(スコープ外・要フォローアップ)

- Apple/Googleの手数料軽減プログラム(中小企業向けプログラム、年間売上100万ドル未満で15%)への申請が前提の価格設計のため、正式リリース前に申請を済ませておく必要がある
- 無料枠(月10問)は小規模・短期間のテストデータに基づく初期仮説であり、正式リリース後に`device_monthly_usage`/`ruling_job`の実データから再検証すること(2026-08-31に一度実施済み、`STATUS.md`のPricing検討セクション参照。`llm_usage`という名称のテーブルはDB上に存在しないため使わない)
- ~~RevenueCatを利用することで購入データが第三者(RevenueCat)を経由するため、プライバシーポリシー・Google Play Data Safetyへの追記が必要~~ → 2026-09-02完了(下記変更履歴参照)
- ~~本設計はモバイルアプリのみが対象。LINE Bot版への同様の課金導入は別途検討が必要~~ → LINE Bot版は2026-09-02に廃止済み(D-002)のため対応不要
- RevenueCatダッシュボードのRestore Behaviorが「Transfer to new App User ID」に設定されていることの確認、および再インストール後の購読復元(`restorePurchases()`→`POST /api/billing/sync`)の実機E2E確認が未実施(T002 follow-up、上記「3. データフロー」参照)

## 変更履歴

- 2026-08-30: 初版作成。無料枠カウントは`ruling_job`テーブル集計、deviceIdは「アプリ削除後も残る永続領域」への保存を前提としていた
- 2026-09-02: Codex横断レビュー(T002)で当初案とD-003/D-005の齟齬を指摘され、現行実装に合わせて全面更新。無料枠カウントを`device_monthly_usage`独立カウンタ方式(D-003)、deviceIdをインストール単位ID方式(D-005、Androidのアプリデータ削除・再インストールでの無料枠リセットを既知の限界として受容。iOSのKeychainは削除後も値が残る場合がありAndroidと同じ限界は当てはまらない)に修正。プライバシーポリシー・Google Play Data SafetyへRevenueCat/購読データの記載を追加。当初の実装計画(`docs/superpowers/plans/2026-08-30-subscription-backend.md`・`2026-08-30-subscription-mobile.md`)は内容を書き換えず、履歴として保持している
