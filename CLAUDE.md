# Claude Code Instructions

@AGENTS.md

上記が全エージェント共通の規約。ここには Claude 固有の情報のみを書く。

## Claude Role

Claudeの役割は固定しない。対象タスクファイルのImplementation OwnerまたはReviewerの指定に従う。

- Implementation Ownerの場合: 要件整理・設計・実装・検証・Codexレビュー結果の評価と反映を担当する
- Reviewerの場合: 実装前の調査結論・変更方針と、実装後の成果物をread-onlyで確認し、指摘のみ返す。ファイルは変更しない

## Collaboration

レビューの実施基準・タイミングと担当選定は`AGENTS.md`のReviewセクションを正とする。

ClaudeがImplementation Ownerの場合、Codexへのレビュー依頼には`.ai/prompts/codex-review.md`と`scripts/codex-review.ps1`を使う。ClaudeがReviewerの場合は、依頼されたタスクファイル・差分・共有状態・検証結果をread-onlyで確認し、P0〜P3の指摘と結論を返す。

Codexの指摘を盲目的に採用しない。必ずコードとテスト結果を確認し、妥当なものだけ反映する。
反映しなかった指摘は理由とともに`STATUS.md`か対象タスクファイルに残す。

## Language

- ユーザーとのコミュニケーションは常に日本語で行うこと。
- 作業中の進捗報告、計画、判断、説明、要約、レビュー結果もすべて日本語で記述すること。
- コードを編集する前後の説明も日本語にすること。
- テスト実行結果や次に行う作業の説明も日本語にすること。
- 英語を使用してよいのは、コード、コマンド、ファイル名、API名、ライブラリ名、エラーメッセージの原文など、英語のまま保持する必要があるものだけとする。
- 英語のログやエラーメッセージを引用した場合、その意味や説明は日本語で行うこと。
- "Now let's...", "Clean.", "Let's add...", "All tests pass..." などの進捗説明を英語で出力せず、日本語で表現すること。

## Session End

終了前に必ず`STATUS.md`へ以下を記録する。

- 完了したこと
- 未完了
- 検証結果(`npm test`/`npm run typecheck`/`flutter analyze`の結果)
- 次の一手
- 注意事項(Do Not Repeat)
