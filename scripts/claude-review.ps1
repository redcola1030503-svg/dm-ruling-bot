#!/usr/bin/env pwsh
# Claude Codeによる独立コードレビュー(非対話モード)。
# 主にCodexが実装した変更をClaudeがレビューする用途。
#
# 使い方:
#   ./scripts/claude-review.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = git rev-parse --show-toplevel
Set-Location $repoRoot

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Write-Error "claude CLIが見つかりません。"
    exit 1
}

$promptFile = Join-Path $repoRoot ".ai/prompts/claude-review.md"
if (-not (Test-Path $promptFile)) {
    Write-Error "$promptFile が見つかりません。"
    exit 1
}

Write-Host "[info] 作業ツリーの現在の差分を対象にします"
git status --short

$prompt = Get-Content -Raw $promptFile

# claude -p は非対話実行。このリポジトリのファイルを変更しないようプロンプト側で
# 明示しているが、権限モードは実行環境の既定に従う点に注意(必要ならreadOnlyの
# permission modeを別途指定すること)。
claude -p $prompt
