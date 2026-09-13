# T021: 最小レビュー方針への変更

Status: Complete

## Goal

Codexレビューが細かい留意点や任意改善を反復し、不要な改修コストを生む状況を止める。標準レビューは重大な問題だけを扱い、方針変更・ドキュメント修正は編集前にClaude Codeが確認する。

## Findings

- 現行規約はP0〜P3を対象とし、再レビューの終了条件が曖昧だった。
- レビュープロンプトがスタイル、過剰実装、将来リスク等を広く列挙していたため、完了を妨げない留意点まで改修対象になりやすかった。
- ドキュメントのみの変更はレビュー省略可とされ、今回のユーザー指示と矛盾していた。

## Changes

- 標準レビューをP0/P1だけに限定し、再現経路または具体的影響と最小修正案を必須化
- P2/P3、スタイル、任意改善、根拠の薄い将来仮定、スコープ外を標準レビューから除外
- 実装前方針レビューは1回、コードの実装後レビューは1回とし、再レビューは挙動・リスクを変えるP0/P1対応後の1回までに制限
- 方針変更・ドキュメント修正は編集前にClaude Codeレビューを必須化。同じ事前レビューで列挙した対象文書は個別の追加レビュー不要
- ドキュメントのみの変更は、事前レビューどおりの編集であれば実装後レビューを省略可能

## Implementation Owner

Codex

## Reviewer

Claude Code

## Pre-implementation Review

Claude Codeによるread-onlyレビューを編集前に実施。

- P0: なし
- P1: 3件
  - ClaudeがImplementation Ownerの場合にClaudeレビューを固定すると自己レビューになり得る → 原則CodexをImplementation Ownerとし、Claudeが明示指定された場合はReviewerの扱いをユーザーへ確認する
  - コード改修の実装前方針レビューを残すか不明確 → 1回・P0/P1限定で維持する
  - 旧「ドキュメントのみはレビュー省略可」と矛盾 → 旧文言を削除する
- P2: 3件。レビュー対象の追加細分化となり今回の最小化方針に反するため不採用

## Verification

- `git diff --check`: PASS（LFからCRLFへの作業ツリー警告のみ）
- `AGENTS.md`、`CLAUDE.md`、レビュー用プロンプト、`STATUS.md`の整合性確認: PASS
- アプリコードを変更していないため、typecheck/test/flutter analyzeは対象外

## Post-implementation Review

Claude Codeが更新差分と本タスクをread-onlyで確認した。

- 事前レビューのP1 3件がすべて反映されていることを確認
- P0/P1: なし
- 結論: 完了可
