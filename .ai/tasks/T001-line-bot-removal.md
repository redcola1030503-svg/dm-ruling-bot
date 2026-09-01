# T001: LINE Bot廃止

Status: Completed

> 共同タスクファイル運用の開始前に実装されたため、本ファイルは作業完了後に既存の差分・`STATUS.md`・Codexレビュー記録から遡及作成した。次回以降の大規模変更では実装前にタスクファイルを作成する。

## Goal

利用を終了するLINE Botと、そのためだけに残っている同期API・設定・依存関係・ドキュメントを削除し、モバイルアプリ向けの非同期裁定APIを維持する。

## Acceptance Criteria

- [x] `POST /webhook/line`を削除し、到達時に404を返す
- [x] LINE Bot専用だった`POST /api/ruling`を削除し、到達時に404を返す
- [x] `POST /api/ruling/jobs`と`GET /health`の既存動作を維持する
- [x] LINE関連ルート、クライアント、会話処理、整形処理、署名検証を削除する
- [x] `@line/bot-sdk`とLINE認証用環境変数のコード・テンプレート定義を削除する
- [x] モバイル側の未使用同期APIクライアントを削除する
- [x] LINE Bot前提のドキュメントを削除またはモバイルアプリ前提へ更新する
- [x] Codexによる独立レビューを実施し、P1指摘を修正する
- [x] バックエンドのtypecheck・テストとFlutter解析を通す

## Out of Scope

- Render本番環境からの`LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`削除
- LINE Developersコンソール上のチャネル削除または凍結
- 廃止エンドポイントの404を保証するHTTP統合テスト基盤の新規導入

## Constraints

- モバイルアプリが使用する非同期API`POST /api/ruling/jobs`は変更しない
- LINE Botと無関係な機能・リファクタを混ぜない
- 認証情報をリポジトリへ保存しない
- レビュアーはファイルを変更せず、指摘のみ返す

## Verification

- [x] `npm run typecheck`: PASS
- [x] `npm test`: PASS（469/469。当時のvitestは`.worktrees/subscription-billing`配下のテストも探索しており、この件数はworktree分を含む。T002対応(vitest.config.ts新設)後に確認されたルート単体の基準値は232件）
- [x] `cd mobile_app && flutter analyze`: PASS（0 issues）
- [x] `POST /webhook/line`: 404
- [x] `POST /api/ruling`: 404
- [x] `POST /api/ruling/jobs`: 202
- [x] `GET /health`: 200

## Implementation Owner

Claude Code

## Reviewer

Codex

## Review History

### Review 1 — 2026-09-02

- P0: なし
- P1: ジャッジ削除手順がDB上のジャッジ行を削除せず、パスワード無し認証を残しうる。`DELETE /api/judges/:judgeId`によるDB削除と`VALID_JUDGE_IDS`からの除外を行う2段階手順へ修正し、解消済み
- P2: 廃止エンドポイントの404を保証する自動統合テストがない。curlによる手動検証はPASS。自動化はfollow-up
- P3: なし
- 詳細: `../reviews/2026-09-02-line-bot-removal.md`
