# LINE Bot廃止 独立レビュー

- 実施日: 2026-09-02
- 実装担当: Claude Code
- レビュアー: Codex
- タスク: `../tasks/T001-line-bot-removal.md`
- 対象: LINE Bot関連コード・同期API・設定・ドキュメントの削除に関する未コミット差分
- 実行方法: `scripts/codex-review.ps1`から、git差分と共有コンテキストを標準入力で`codex exec --sandbox read-only`へ渡した

> このファイルは、Claude Codeのレビュー実行画面と`STATUS.md`に記録された結果から再構成した追跡用サマリーです。Codexの生の出力を逐語保存したものではありません。

## 結論

CodexのP1指摘は実装担当が修正し、再検証済み。P2の自動統合テスト不足は、廃止エンドポイントが実際に404となることを手動検証したうえでfollow-upとして記録した。現時点でLINE Bot廃止を妨げる未解消のブロッカーはない。

## P1 — ジャッジ削除手順がセキュリティ境界を満たさない

- 対象: `docs/ジャッジID追加手順.md`
- 指摘: `VALID_JUDGE_IDS`からIDを除外するだけでは`judge`テーブルの行が残る。認証処理は`judge`テーブルとのJOINでロールを取得するため、パスワード無し認証が引き続き成立しうる。
- 対応: ドキュメントを「`DELETE /api/judges/:judgeId`でDBから削除し、その後`VALID_JUDGE_IDS`からも除外する」という2段階手順へ修正。
- 判定: 解消済み。

## P2 — 廃止エンドポイントの404を保証する自動テストがない

- 対象: `src/index.ts`、削除した`src/routes/lineWebhook.ts`・`src/routes/ruling.ts`
- 指摘: `POST /webhook/line`と`POST /api/ruling`が到達不能になったことを保証するHTTP統合テストがない。
- 対応: サーバーを実際に起動し、curlで両エンドポイントが404になることを確認。既存コードベースにはsupertest等を使うHTTP統合テストの慣行がなく、導入には`app`構築と`listen`の分離が必要なため、今回は自動化を見送った。
- 判定: 手動検証済み。自動テスト追加はfollow-up。

## 再検証

- `npm run typecheck`: PASS
- `npm test`: PASS（469/469。worktree内のテストを含む。T002対応後に確認されたルート単体の基準値は232件）
- `cd mobile_app && flutter analyze`: PASS（0 issues）
- `POST /webhook/line`: 404
- `POST /api/ruling`: 404
- `POST /api/ruling/jobs`: 202
- `GET /health`: 200

## 残課題

- 廃止エンドポイントの404を保証するHTTP統合テストを、必要性と導入コストを踏まえて追加する。
- Render本番環境から`LINE_CHANNEL_SECRET`と`LINE_CHANNEL_ACCESS_TOKEN`を削除する。
- LINE Developersコンソール上のチャネルを削除または凍結する。
