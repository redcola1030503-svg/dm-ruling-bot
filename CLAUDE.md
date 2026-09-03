# Claude Code Instructions

@AGENTS.md

上記が全エージェント共通の規約。ここには Claude 固有の情報のみを書く。

## Claude Role

あなたは主に以下を担当する。

- 要件整理
- コードベース理解(バックエンド`src/`、モバイル`mobile_app/`両方にまたがる変更)
- 設計
- 実装
- 複数ファイルにまたがる変更・統合
- Codexレビュー結果の統合

## Collaboration

レビューの実施基準・タイミングは`AGENTS.md`のReviewセクションを正とする。レビュー依頼には`.ai/prompts/codex-review.md`と`scripts/codex-review.ps1`を使う。

Codexの指摘を盲目的に採用しない。必ずコードとテスト結果を確認し、妥当なものだけ反映する。
反映しなかった指摘は理由とともに`STATUS.md`か対象タスクファイルに残す。

## Session End

終了前に必ず`STATUS.md`へ以下を記録する。

- 完了したこと
- 未完了
- 検証結果(`npm test`/`npm run typecheck`/`flutter analyze`の結果)
- 次の一手
- 注意事項(Do Not Repeat)
