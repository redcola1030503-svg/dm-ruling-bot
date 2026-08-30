#!/usr/bin/env pwsh
# .ai/skills-src/ を正本として、各ツールが参照する場所へコピーする。
#
# 注意: Codex CLIには2026年時点でClaude Codeの `.claude/skills/` に相当する
# 「自動検出されるSkillディレクトリ」の仕様が(本スクリプト作成時点で)確認できていない。
# そのためCodex向けは `.ai/skills-compiled/codex/` へ集約するに留め、
# 実際にCodexへ読ませる場合は `.ai/prompts/*.md` やAGENTS.mdからファイルパスを
# 明示的に参照させること。この前提が変わった場合はこのコメントごと更新すること。
#
# 使い方:
#   ./scripts/sync-ai-skills.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = git rev-parse --show-toplevel
Set-Location $repoRoot

$srcRoot = Join-Path $repoRoot ".ai/skills-src"
if (-not (Test-Path $srcRoot)) {
    Write-Error "$srcRoot が無い。"
    exit 1
}

$claudeDest = Join-Path $repoRoot ".claude/skills"
$codexDest = Join-Path $repoRoot ".ai/skills-compiled/codex"

New-Item -ItemType Directory -Force -Path $claudeDest | Out-Null
New-Item -ItemType Directory -Force -Path $codexDest | Out-Null

$categories = @("superpowers", "ecc-selected", "project-specific")
$syncedCount = 0

foreach ($category in $categories) {
    $categoryPath = Join-Path $srcRoot $category
    if (-not (Test-Path $categoryPath)) { continue }

    Get-ChildItem $categoryPath -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $skillName = $_.Name
        $skillSrc = $_.FullName

        # Claude Code: <name>/SKILL.md 形式で正本から上書きコピー
        $claudeTarget = Join-Path $claudeDest $skillName
        Copy-Item -Path $skillSrc -Destination $claudeTarget -Recurse -Force

        # Codex: 参照用に集約するのみ(自動検出は保証しない、上記注意書き参照)
        $codexTarget = Join-Path $codexDest $skillName
        Copy-Item -Path $skillSrc -Destination $codexTarget -Recurse -Force

        Write-Host "[synced] $category/$skillName"
        $syncedCount++
    }
}

if ($syncedCount -eq 0) {
    Write-Host "[info] .ai/skills-src/ 配下にまだSkillが無い。README.mdの構成に従って正本を配置してから再実行すること。"
} else {
    Write-Host "[info] $syncedCount 件のSkillを同期した。"
}

Write-Host "[warn] 各ツール側(.claude/skills/、.ai/skills-compiled/codex/)を直接編集しないこと。正本(.ai/skills-src/)のみを編集し、このスクリプトで再同期すること。"
