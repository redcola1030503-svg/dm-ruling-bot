# AI Handoff Format

セッション終了前(またはAIを切り替える前)に、この形式で `STATUS.md` を更新する。
自由文の引き継ぎより、この共通形式の方が抜け漏れが少ない。

```md
## Goal
何を達成しようとしているか

## Done
完了したこと

## Changed
変更ファイル

## Decisions
重要な判断(長期的なものは `DECISIONS.md` へ昇格させる)

## Failed Attempts
試したが採用しなかったもの

## Verification
実施したテストと結果

## Risks
残っている懸念

## Next
次にやること

## Human Decision Needed
人間に確認が必要なこと
```
