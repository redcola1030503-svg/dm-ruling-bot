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

## In Progress

- LINE Bot廃止方針(即時停止か移行期間を設けるか)が未確定
- マージ後の手動対応(RevenueCatダッシュボード設定等、下記Next参照)が未着手

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

## Next

1. RevenueCatダッシュボード・ストア側のサブスク商品を設定する(詳細は `actions/dm-ruling-bot_残作業リスト.md`(Vault側)参照)
2. LINE Bot廃止の進め方を決定する(詳細は `actions/dm-ruling-bot_残作業リスト.md`(Vault側)参照)
3. `scripts/codex-review.ps1`のWindows read-onlyサンドボックス問題を恒久対応する(diff埋め込み方式へ変更するか、read-only省略+プロンプト制約のみに切り替えるか検討)
4. (follow-up、詳細は`actions/dm-ruling-bot_残作業リスト.md`(Vault側)参照)課金ルートのExpress統合テスト整備、無料枠上限判定の原子化、ジョブ失敗時のスレッドロールバック、Webhook/同期APIのレート制限分離

## Do Not Repeat

- `deviceId`のような自己申告値を使う無料枠カウントは、ユーザーが削除操作できるテーブル(`ruling_job`等)から数えない。削除の影響を受けない独立カウンタ(`device_monthly_usage`)を使うこと(PR #1で実際に発生した不具合)
- Webhook等の外部通知は、特定フィールド(`expiration_at_ms`等)が無いイベントでも安全側(既存値を保持/明示的な失効イベントのみ反映)に倒すこと。全イベントで無条件に状態を上書きしない
