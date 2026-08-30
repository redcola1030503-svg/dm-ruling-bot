# Skillの正本

同じSkillをClaude版・Codex版として手修正しない。ここを唯一の正本とし、
`scripts/sync-ai-skills.ps1` で各ツールが認識する場所へコピーする。

symlinkだけに依存しない(Windows環境やツールによってはSkillのsymlink検出に
問題が出ることがあるため、正本→同期スクリプト→各ツールのSkillディレクトリ、という
コピー方式を基本とする)。

## 構成

```
.ai/skills-src/
├─ superpowers/       Superpowers由来で採用したSkillのみ
├─ ecc-selected/       ECC由来で採用したSkillのみ(全部は入れない)
└─ project-specific/   このプロジェクト固有のSkill
```

全部を無条件に読み込ませるより、planning / debugging / test-first / code-review /
security-review など頻繁に使うものから始める方がコンテキスト汚染を抑えられる。

## 同期ルール

- 正本からのみ上書きする
- 各ツール側(`.claude/skills/`やCodex側のSkill配置先)で直接編集しない
- 差分があれば`scripts/sync-ai-skills.ps1`が警告する(実装は今後)
- 認証情報をSkillに含めない

## 現状

このディレクトリはまだ空。採用するSkillが決まり次第、正本として配置する。
