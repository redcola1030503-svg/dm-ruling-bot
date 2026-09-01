# Claude Code × Codex 協働開発環境

Claude CodeとOpenAI Codexのどちらで作業しても、同じ判断基準・同じ進捗・同じ意思決定履歴を
参照でき、片方が実装、もう片方が独立レビューできる状態を作るための構成。

設計の背景・詳細な考え方は Obsidian Vault内
`inbox/Claude_Code_Codex_協働開発環境_設計ガイド.md` を参照(このリポジトリ外)。

## 1. 作成したファイル一覧

```
AGENTS.md              全エージェント共通の規約(唯一の正本)
CLAUDE.md               Claude固有の設定(@AGENTS.mdをimport)
STATUS.md               現在地・担当・検証結果・次の作業
DECISIONS.md            長期的な設計判断(ADR-lite)

.ai/
├─ README.md            このファイル
├─ tasks/
│  └─ README.md         タスクファイルの書き方
├─ reviews/              Codex/Claudeによる独立レビュー結果の保存先
├─ prompts/
│  ├─ codex-review.md   Claude→Codexへのレビュー依頼プロンプト
│  ├─ claude-review.md  Codex→Claudeへのレビュー依頼プロンプト
│  └─ handoff.md        セッション終了時の引き継ぎ形式
└─ skills-src/
   ├─ README.md         Skill正本管理の方針
   ├─ superpowers/       (空、採用したSkillをここに置く)
   ├─ ecc-selected/      (空、同上)
   └─ project-specific/  (空、同上)

scripts/
├─ codex-review.ps1      現在のgit diffをCodexにread-onlyレビューさせる
├─ claude-review.ps1     現在のgit diffをClaudeにレビューさせる(非対話)
├─ ai-status.ps1         STATUS.md/DECISIONS.md/git状態を一括表示
└─ sync-ai-skills.ps1    .ai/skills-src/ を各ツール向けにコピー
```

## 2. 設計意図

- **共通ルールは`AGENTS.md`のみ**。`CLAUDE.md`はそれをimportしClaude固有の役割だけ書く。Codex固有設定(モデル・sandbox等)はCodex側の設定へ置き、`AGENTS.md`へ混ぜない
- **チャット履歴ではなく`STATUS.md`/`DECISIONS.md`を正とする**。AIを切り替えても「なぜこの実装にしたか」「次に何をすべきか」が失われない
- **レビュアーに修正させない**。実装者と独立レビュアーを分離し、同じモデルが自分のミスを自分で承認する状態を避ける
- **Skillの正本は1つ**(`.ai/skills-src/`)。Claude版・Codex版を手作業で二重管理しない

## 3. 初回セットアップ手順

1. Codex CLIを導入・サインイン
   ```powershell
   npm install -g @openai/codex
   codex login
   ```
2. 動作確認(下記4章参照)
3. `.ai/skills-src/` へ採用するSkillを配置し `./scripts/sync-ai-skills.ps1` を実行(任意、今は空)

## 4. 動作確認コマンド

```powershell
claude --version
claude -p "Reply only: CLAUDE_OK"

codex --version
codex exec "Reply only: CODEX_OK"

git status
```

両方動けば準備完了。

## 5. 日常の使い方

作業開始時に必ず `AGENTS.md` → `STATUS.md` → `DECISIONS.md` → 対象の `.ai/tasks/*.md` の順に読む。
終了時は `.ai/prompts/handoff.md` の形式で `STATUS.md` を更新する。

```powershell
./scripts/ai-status.ps1   # 現在地を素早く把握
```

## 6. Claude → Codex レビューフロー

```
1. Claudeが実装
2. npm run typecheck / npm test / flutter analyze
3. ./scripts/codex-review.ps1 で独立レビュー依頼
4. Claudeが指摘を分類、妥当なものだけ反映
5. 再テスト
6. 必要ならCodex再レビュー
7. STATUS.md更新
```

## 7. Codex → Claude レビューフロー

```
1. Codexが実装
2. npm run typecheck / npm test / flutter analyze
3. ./scripts/claude-review.ps1 で独立レビュー依頼
4. Codexが指摘を分類、妥当なものだけ反映
5. 再テスト
6. STATUS.md更新
```

## 8. セキュリティ上の注意

以下は絶対にリポジトリへ保存しない・AI間で共有しない(詳細は`AGENTS.md`参照)。

- API key(`LLM_API_KEY`/`VOYAGE_API_KEY`/`REVENUECAT_API_KEY`等)、OAuth token、browser session、cookie、password、秘密鍵
- `dangerously-*`系オプションを常用しない
- Windows環境では `codex exec --sandbox read-only` を「絶対安全」とは考えない。実行前後に`git status`/`git diff`を確認し、reviewerには常に「変更禁止」を明示する
- 並列で実装させる場合は同じファイルを同時編集させない。git worktreeで分離するか、片方をread-onlyレビュー専任にする

## 9. 現状の制約

- Codex CLIによる独立レビューは運用済み。レビュー結果は`.ai/reviews/`へ保存する
- `.ai/skills-src/` は空。採用するSkillは今後、実際に頻繁に使うもの(code-review, security-review, test-first等)から順に追加していく方針
- Codex CLIに`.claude/skills/`相当の自動検出Skillディレクトリがあるかは未確認のため、`sync-ai-skills.ps1`はCodex向けを`.ai/skills-compiled/codex/`への集約に留めている(自動読み込みは保証しない)
