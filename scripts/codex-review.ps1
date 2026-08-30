#!/usr/bin/env pwsh
# Codexによる独立コードレビュー(read-only)。
# 現在のgit diffをCodexにレビューさせ、ファイルは変更させない。
#
# 使い方:
#   ./scripts/codex-review.ps1
#   ./scripts/codex-review.ps1 -Base main   # mainからの差分をレビュー対象にする場合の目安を表示

param(
    [string]$Base = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = git rev-parse --show-toplevel
Set-Location $repoRoot

if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
    Write-Error "codex CLIが見つかりません。'codex login' でサインインしてから再実行してください。"
    exit 1
}

$promptFile = Join-Path $repoRoot ".ai/prompts/codex-review.md"
if (-not (Test-Path $promptFile)) {
    Write-Error "$promptFile が見つかりません。"
    exit 1
}

if ($Base) {
    Write-Host "[info] git diff $Base...HEAD を対象にします(参考表示のみ、Codex自身がgitで差分を取得します)"
    git diff --stat "$Base...HEAD"
} else {
    Write-Host "[info] 作業ツリーの現在の差分を対象にします"
    git status --short
}

$prompt = Get-Content -Raw $promptFile

# read-only sandboxはCodex側の安全境界の1つであって唯一の境界ではない。
# プロンプト側にも「変更禁止」を明示しているのはそのため(AGENTS.md/README参照)。
codex exec --sandbox read-only $prompt
