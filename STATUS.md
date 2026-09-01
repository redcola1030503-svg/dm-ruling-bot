# Project Status

Updated: 2026-08-31
Owner: Claude Code
Reviewer: Codex(PR #1の独立レビューを実施済み)

## Current Goal

複数の並行課題があり、単一の目標に絞れていない状態。

1. サブスクリプション課金機能(PR #1)のレビュー・マージ判断
2. LINE Bot廃止の進め方決定・実施
3. モバイルアプリ(Android/iOS)のストア審査対応

## Completed

- サブスクリプション課金機能(無料枠月10問+月額300円、RevenueCat経由)を実装し `subscription-billing` ブランチとしてPR化(`https://github.com/redcola1030503-svg/dm-ruling-bot/pull/1`)
- Claude Code × Codex 協働環境の初期構築(このファイル一式)
- **PR #1をmasterへマージ**(2026-08-31、マージコミット`2f0f22a`)。ローカルmasterをrebase・push済み
- **RevenueCat/Android側の課金セットアップ**(2026-08-31):
  - RevenueCatプロジェクト「デュエマ裁定確認」作成、Entitlement `unlimited_questions`、Offering `default`(Monthlyパッケージ)を設定
  - Google Play Consoleで定期購入 `monthly_plan`(基本プランID `p1m`、¥300/月、日本限定)を作成・有効化
  - RevenueCat側に商品 `monthly_plan:p1m` を作成し、Entitlement・Offeringへ紐付け
  - `mobile_app/lib/billing/revenue_cat_keys.dart` を実際のPublic API Key(Android/iOS両方)に更新
  - バージョン1.7.0+16をビルドし、エミュレータでクラッシュ無し確認後、Play Console内部テストトラックへ公開
  - iOS側は App Store Connect の In-App Purchase Key(Key ID `7ZPG6FCZBW`)を発行しRevenueCatに設定済みだが、サブスクリプション商品自体はApp Store Connect側で未作成

## In Progress

- LINE Bot廃止方針(即時停止か移行期間を設けるか)が未確定
- iOS側のRevenueCat/App Store Connectサブスクリプション商品設定(Android側と同等の作業が未着手)
- Android側のService Account Credentials JSON(Google Cloud、RevenueCatの自動インポート・Webhook検証に必要)が未アップロード
- 有料化の形態(価格・プラン設計)の見直し検討(下記「Pricing検討」参照)

## Decided (このセッション)

- 残るP1(無料枠上限判定の原子性)とP2(ジョブ失敗時のスレッドロールバック)は今回のPRのスコープ外とし、`actions/dm-ruling-bot_残作業リスト.md`(Vault側)へfollow-upとして切り出した(2026-08-31、ユーザー判断)。理由: 現状のRender starterプラン(単一インスタンス)かつハンドラー内に`await`が無いため実害が低いと判断
- PR #1はマージ判断へ進んでよい状態

## Blocked

- なし(RevenueCatダッシュボード未作成のため実キー未設定だが、これは「次にやること」であってブロッカーではない)

## Verification

PR #1、修正反映後(subscription-billingブランチ、コミット`fdae217`/`d018dd4`):
- `npm test`: PASS(237/237、修正前227から+10)
- `npm run typecheck`: PASS
- `flutter analyze`: 未実施(モバイル側は今回変更していない)
- モバイル `flutter test test/widget_test.dart`: FAIL(この機能と無関係のmaster由来の既知の問題、未変更)

## Reviewer Findings

Codexによる独立レビューを2回実施。

**1回目(2026-08-31、`.ai/reviews/2026-08-31-pr1-subscription-billing.md`)**: マージ非推奨、P0 1件・P1 4件・P2 1件。

**対応(コミット`fdae217`/`d018dd4`)**:
- P0: `deviceId`必須化(`src/routes/rulingJobsSchema.ts`新設)。モバイルアプリは既にdeviceIdを常に送信済みのため実質影響なし
- P1: 購読中は無料枠を消費しない(`accessControl.ts`に`hasActiveSubscription`追加)
- P1: 遅延`EXPIRATION`/`REFUND`はRevenueCat REST APIから再取得してから反映(`revenueCatEventPolicy.ts`, `billing.ts`)
- P1: ジョブ作成とカウンタ加算をトランザクション化(`billing/billingTransaction.ts`新設)

**2回目(2026-08-31、`.ai/reviews/2026-08-31-pr1-subscription-billing-round2.md`)**: 上記3件は解消確認。残課題:

- **P1(未解消)**: 無料枠の上限判定(`getMonthlyUsageCount`/`evaluateRulingAccess`)がトランザクション開始前に行われており、上限直前の並行リクエストで枠超過があり得る。**ただし現在の本番構成(Render `plan: starter`、単一インスタンス)かつハンドラー内に`await`が無い(同期SQLite呼び出しのみ)ため、実際には他リクエストが割り込む余地が無く、今この瞬間の実害は無いと考えられる(将来インスタンスを複数に増やす場合は要対応)**
- **P2(新規)**: ジョブ作成失敗時、先に作成/更新したスレッド(`createThread`/`touchThread`)がロールバックされず残る。課金回避にはならないが、失敗時に空スレッドが残るUXの不整合
- P1: 課金ルートの統合テストが不足(未対応、予定どおりスコープ外)
- P2: Webhookとアプリ同期が同一IPレート制限枠を共有(未対応、予定どおりスコープ外)

**注記**: このレビューはWindows環境で`--sandbox read-only`がローカルのgit/ファイル読み取りコマンド自体を全面拒否したため、diffとAGENTS.md/STATUS.md/DECISIONS.mdをプロンプトへ直接埋め込む方式で実施した(`scripts/codex-review.ps1`そのままでは動作しなかった)。

## Pricing検討(2026-08-31、marketing:pricingスキルで分析)

現行の「無料枠月10問+月額300円・単一プラン・使い放題」について、原価とのミスマッチを指摘。

- Claude API原価は1質問あたり約6〜11円(Batch API適用のモバイル経由でも約2.2〜5.4円)に対し、月額300円は損益分岐点が月43問程度(保守的試算)。使い放題プランに月間上限が無いため、ヘビーユーザー1人で赤字になりうる
- Freemiumの前提(無料ユーザーの限界費用が低いこと)を満たしていない
- 「$10/月」個人向けバケットの中でも300円(≒$2)は安すぎる側("$9トラップ": 安すぎる価格は偽の需要を生み後から値上げしづらい)
- 有料化しても広告(AdMobバナー)が消えない、能動的なアップグレード導線もない、という訴求面の弱さも判明済み

**検討した改善案**:
- 案A(最小変更): 価格を¥980程度に引き上げ+広告非表示を有料特典に追加
- 案B(構造変更): Value Metricを「質問数」に合わせた上限付き複数プラン or クレジット制へ移行(例: ライト¥300/月=50問、ヘビー¥980/月=300問)
- 案C(データファースト、**これを選択・実施済み**): `device_monthly_usage`/`ruling_job`の実データで実際の質問数分布を確認してから案A/Bを決める

**実データ分析結果(2026-08-31実施、Render Web Shell経由)**:

`llm_usage`はテーブルではなくログイベント(DB上には存在しない)と判明。代わりに`ruling_job`テーブル(2026-08-19〜08-31の12日間、48台・127ジョブ、device_id別集計)を分析。

| 質問数(累計12日間) | 端末数 |
|---:|---:|
| 1問 | 26台(54%) |
| 2〜5問 | 17台(35%) |
| 6〜10問 | 3台 |
| 11〜30問 | 2台(最大14問) |
| 31問以上 | 0台 |

最もヘビーな端末でも12日間で14問(30日換算で約35問/月)。この水準ならBatch API適用時(2.2〜5.4円/問)は235円未満、保守的単価(7円/問)でも245円で¥300を下回り黒字。最悪ケース(複雑な質問ばかり・11円/問)でようやく385円と¥300をわずかに超える程度。

**結論**: 当初懸念した「ヘビーユーザーで即座に赤字化する」リスクは、少なくとも現在の実利用パターン(48台のベータテスター)では顕在化していない。TCGの裁定確認は対戦中に迷った時だけ聞く性質上、そもそも高頻度利用になりにくいと考えられる。

**留保点**:
- サンプルが小さい(48台)。外れ値のヘビーユーザーが未出現の可能性
- 無料ベータテスターのデータであり、実際の課金後の利用行動は変わりうる(逆選択のリスク)
- 構造的な上限は依然として無い(1問=数円のコストが理論上は青天井、悪意ある高頻度利用やbotへの備えとしては弱い)

**更新した推奨**: 案B(上限付きプラン化)は緊急性が下がったと判断。案Aは原価リスクというより価格心理("$9トラップ")・収益バッファ確保の観点で引き続き検討価値あり。正式公開後、実際の課金ユーザーの利用データで再検証する。

## Next

1. iOS側のRevenueCat/App Store Connectサブスクリプション商品設定(Android側と同等の作業)
2. Android側のService Account Credentials JSON(Google Cloud)の作成・アップロード
3. (任意、緊急性は下がった)Pricing案A(価格を¥980程度へ引き上げ+広告非表示を有料特典化)の実施要否をユーザーと最終判断
4. LINE Bot廃止の進め方を決定する(詳細は `actions/dm-ruling-bot_残作業リスト.md`(Vault側)参照)
5. `scripts/codex-review.ps1`のWindows read-onlyサンドボックス問題を恒久対応する(diff埋め込み方式へ変更するか、read-only省略+プロンプト制約のみに切り替えるか検討)
6. (follow-up、詳細は`actions/dm-ruling-bot_残作業リスト.md`(Vault側)参照)課金ルートのExpress統合テスト整備、無料枠上限判定の原子化、ジョブ失敗時のスレッドロールバック、Webhook/同期APIのレート制限分離
7. 正式公開後、実際の課金ユーザーの利用データでPricing分析を再実施する

## Do Not Repeat

- `deviceId`のような自己申告値を使う無料枠カウントは、ユーザーが削除操作できるテーブル(`ruling_job`等)から数えない。削除の影響を受けない独立カウンタ(`device_monthly_usage`)を使うこと(PR #1で実際に発生した不具合)
- Webhook等の外部通知は、特定フィールド(`expiration_at_ms`等)が無いイベントでも安全側(既存値を保持/明示的な失効イベントのみ反映)に倒すこと。全イベントで無条件に状態を上書きしない
