#!/usr/bin/env pwsh
# 現在地の一括表示。ClaudeとCodexを切り替える前後の状況把握用。
#
# 使い方:
#   ./scripts/ai-status.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = git rev-parse --show-toplevel
Set-Location $repoRoot

function Show-Section {
    param([string]$Title)
    Write-Host ""
    Write-Host "=== $Title ===" -ForegroundColor Cyan
}

Show-Section "STATUS.md"
if (Test-Path "STATUS.md") { Get-Content -Encoding utf8 "STATUS.md" } else { Write-Host "(STATUS.mdが無い)" }

Show-Section "DECISIONS.md (見出しのみ)"
if (Test-Path "DECISIONS.md") {
    Select-String -Encoding utf8 -Path "DECISIONS.md" -Pattern "^## " | ForEach-Object { $_.Line }
} else {
    Write-Host "(DECISIONS.mdが無い)"
}

Show-Section "未完了タスク (.ai/tasks/)"
if (Test-Path ".ai/tasks") {
    Get-ChildItem ".ai/tasks" -Filter "T*.md" -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }
} else {
    Write-Host "(タスクファイル無し)"
}

Show-Section "git status"
git status --short

Show-Section "直近のコミット"
git log --oneline -10
