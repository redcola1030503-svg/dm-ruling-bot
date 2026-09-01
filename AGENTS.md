# Project Agent Rules

このファイルはClaude Code / Codex双方が守る共通ルールの正本(唯一の情報源)。
ツール固有の設定は書かない(Claude固有は`CLAUDE.md`、Codex固有はCodex側の設定へ)。

## Goal

デュエル・マスターズの裁定(ルール判定)を、公式情報を根拠にAIが回答するアプリ。
バックエンド(Node.js/TypeScript/Express、`src/`)+ モバイルアプリ(Flutter、`mobile_app/`)の2構成。

## Definition of Done

- 要件を満たす
- 既存テストを壊さない
- 新しい挙動にはテストを追加する(バックエンド: vitest。モバイルは既存の起動スモークテスト1本のみで、追加のテスト慣行は無い)
- 以下を通す:
  - バックエンド: `npm run typecheck && npm test`
  - モバイル: `cd mobile_app && flutter analyze`
- `STATUS.md`を更新する

## Development Rules

- 既存アーキテクチャ・既存の命名/コメント規約を優先する(日本語コメントで「なぜ」を書く、自明な「何を」は書かない)
- 不要な依存ライブラリを追加しない
- 大規模変更は実装前に計画を書く(`.ai/tasks/`参照)
- 1タスクで無関係なリファクタを混ぜない
- 失敗したアプローチを同じ形で繰り返さない(`DECISIONS.md`の「却下した代替案」を確認する)
- YAGNI: 依頼されていない機能・過剰な抽象化を追加しない

## Verification

変更後は可能な範囲で以下を実行する。

1. バックエンド: `npm run typecheck`
2. バックエンド: `npm test`
3. モバイル: `flutter analyze`
4. `git diff`で意図しない変更が無いか確認

## Review

**今後の開発は原則として共同体制(Claude実装 → Codex独立レビュー → Claude修正 → 再検証)で行う**(ユーザー方針、2026-09-02)。実装を行っていない別エージェント(Claude実装なら Codex、Codex実装なら Claude)に独立レビューさせることを標準の流れとし、「重要な変更のときだけ」に限定しない。誤字修正やドキュメントのみの変更等、影響範囲が自明に小さいものは省略してよいが、判断に迷う場合は実施する。
レビュアーは修正しない。指摘のみ返し、実装側が反映を判断する。
レビューは `scripts/codex-review.ps1` を使う(git diffとAGENTS.md/STATUS.md/DECISIONS.mdをプロンプトへ埋め込み、`codex exec --sandbox read-only`へstdin経由で渡す方式。2026-08-31にWindows不具合を修正済み)。

## Shared State

作業開始時に以下を読む。

- `STATUS.md`(現在地・担当・検証結果・次の作業)
- `DECISIONS.md`(長期的な設計判断)
- 対象の `.ai/tasks/<task>.md`(あれば)

作業終了時に`STATUS.md`を更新する。チャット履歴ではなくこれらの共有ファイルを正とする。

## Security

以下をリポジトリへ保存しない(既存の`.gitignore`にも一部反映済み)。

- API key(`LLM_API_KEY`、`VOYAGE_API_KEY`、`REVENUECAT_API_KEY`等)
- LINE / RevenueCat / Firebase等の認証情報
- Apple秘密鍵(`*.p8`/`*.p12`/`*.jks`)
- OAuth token / browser session / cookie / password

## Git

- 大きな変更を一括コミットしない
- 意図の違う変更を分離する
- force pushは禁止
- Claude/Codexに同じファイルを同時編集させない(片方が実装、片方はread-onlyレビュー。並列実装が必要ならgit worktreeで分離する)
