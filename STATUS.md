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

## In Progress

- PR #1: Codexレビューで判明したP0/P1指摘への対応方針検討(実装側でのコード照合・反映判断が未着手)
- LINE Bot廃止方針(即時停止か移行期間を設けるか)が未確定

## Blocked

- なし(RevenueCatダッシュボード未作成のため実キー未設定だが、これは「次にやること」であってブロッカーではない)

## Verification

PR #1時点(subscription-billingブランチ):
- `npm test`: PASS(227/227)
- `npm run typecheck`: PASS
- `flutter analyze`: PASS(0 issues)
- モバイル `flutter test test/widget_test.dart`: FAIL(この機能と無関係のmaster由来の既知の問題。`ruling_screen.dart`のネットワーク呼び出しがテスト環境でブロックされるため)

## Reviewer Findings

Codexによる独立レビュー実施済み(2026-08-31、詳細は `.ai/reviews/2026-08-31-pr1-subscription-billing.md`)。総評: マージ非推奨、P0 1件・P1 4件・P2 1件。

- P0: `deviceId`省略で無料枠制限・課金ゲートを完全に迂回できる(`src/routes/rulingJobs.ts`)
- P1: 購読中の質問でも無料枠カウンタを消費してしまう(`src/routes/rulingJobs.ts`)
- P1: 遅延した`EXPIRATION`/`REFUND`イベントが新しい更新状態を巻き戻す(`src/billing/revenueCatEventPolicy.ts`, `src/routes/billing.ts`)
- P1: ジョブ作成とカウンタ加算が同一トランザクションでない(`src/routes/rulingJobs.ts`, `src/billing/deviceMonthlyUsageRepository.ts`)
- P1: 課金ルートの統合テストが不足
- P2: Webhookとアプリ同期が同一IPレート制限枠を共有

**注記**: このレビューはWindows環境で`--sandbox read-only`がローカルのgit/ファイル読み取りコマンド自体を全面拒否したため、diffとAGENTS.md/STATUS.md/DECISIONS.mdをプロンプトへ直接埋め込む方式で実施した(`scripts/codex-review.ps1`そのままでは動作しなかった)。

## Next

1. 上記Codex指摘をClaude Codeが実コードと照合し、妥当なものを分類する(まだ未着手)
2. **P0(`deviceId`必須化)の対応方針を人間に確認する**: 既に配信済みのv1.4.0〜v1.6.1との互換性に影響するため、強制アップデートか移行期間を設けるかの判断が必要
3. 採用する指摘を反映し、`npm test`/`npm run typecheck`/`flutter analyze`を再実行
4. 必要ならCodexへ再レビューを依頼
5. PR #1のマージ可否を判断する
6. LINE Bot廃止の進め方を決定する(詳細は `actions/dm-ruling-bot_残作業リスト.md`(Vault側)参照)
7. RevenueCatダッシュボード・ストア側のサブスク商品を設定する
8. `scripts/codex-review.ps1`のWindows read-onlyサンドボックス問題を恒久対応する(diff埋め込み方式へ変更するか、read-only省略+プロンプト制約のみに切り替えるか検討)

## Do Not Repeat

- `deviceId`のような自己申告値を使う無料枠カウントは、ユーザーが削除操作できるテーブル(`ruling_job`等)から数えない。削除の影響を受けない独立カウンタ(`device_monthly_usage`)を使うこと(PR #1で実際に発生した不具合)
- Webhook等の外部通知は、特定フィールド(`expiration_at_ms`等)が無いイベントでも安全側(既存値を保持/明示的な失効イベントのみ反映)に倒すこと。全イベントで無条件に状態を上書きしない
