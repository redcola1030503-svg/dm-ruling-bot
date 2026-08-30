# Project Status

Updated: 2026-08-31
Owner: Claude Code
Reviewer: (Codex導入直後のため実績なし。次回の重要な変更から開始する)

## Current Goal

複数の並行課題があり、単一の目標に絞れていない状態。

1. サブスクリプション課金機能(PR #1)のレビュー・マージ判断
2. LINE Bot廃止の進め方決定・実施
3. モバイルアプリ(Android/iOS)のストア審査対応

## Completed

- サブスクリプション課金機能(無料枠月10問+月額300円、RevenueCat経由)を実装し `subscription-billing` ブランチとしてPR化(`https://github.com/redcola1030503-svg/dm-ruling-bot/pull/1`)
- Claude Code × Codex 協働環境の初期構築(このファイル一式)

## In Progress

- PR #1のレビュー・マージ判断待ち
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

(Codexによる独立レビューはまだ実施していない)

## Next

1. **`codex login`の完了確認**(このセッションの終了時点で未完了。ブラウザでのOAuth認可待ちの状態でセッションを終えた。次回開始時に`codex --version`・`codex exec "Reply only: CODEX_OK"`で疎通確認すること)
2. `AGENTS.md`/`CLAUDE.md`/`STATUS.md`/`DECISIONS.md`/`.ai/`/`scripts/`一式をコミットしてよいか、ユーザーに確認する(このセッション終了時点でまだ未コミット)
3. PR #1をレビューしマージ可否を判断する
4. LINE Bot廃止の進め方を決定する(詳細は `actions/dm-ruling-bot_残作業リスト.md`(Vault側)参照)
5. RevenueCatダッシュボード・ストア側のサブスク商品を設定する

## Do Not Repeat

- `deviceId`のような自己申告値を使う無料枠カウントは、ユーザーが削除操作できるテーブル(`ruling_job`等)から数えない。削除の影響を受けない独立カウンタ(`device_monthly_usage`)を使うこと(PR #1で実際に発生した不具合)
- Webhook等の外部通知は、特定フィールド(`expiration_at_ms`等)が無いイベントでも安全側(既存値を保持/明示的な失効イベントのみ反映)に倒すこと。全イベントで無条件に状態を上書きしない
