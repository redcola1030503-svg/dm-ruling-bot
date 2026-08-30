# タスクファイルの書き方

`.ai/tasks/T<連番3桁>-<短い名前>.md` で1タスク1ファイルを作る。実装前にこれを書き、
ClaudeとCodexが同じ「完成」をイメージできるようにする。

## テンプレート

```md
# T001: <タスク名>

## Goal
<何を達成するか>

## Acceptance Criteria
- [ ] <満たすべき条件>

## Out of Scope
- <今回やらないこと>

## Constraints
- <制約>

## Verification
- unit
- integration
- manual

## Implementation Owner
Claude Code / Codex

## Reviewer
Claude Code / Codex

## Review History
### Review 1
- P0:
- P1:
- P2:
- P3:
```

小さな変更(1ファイル・数行程度)にはタスクファイルを作らなくてよい。
複数ファイルにまたがる変更、仕様判断が必要な変更、後で経緯を追いたい変更にのみ作成する。
