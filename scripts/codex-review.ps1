#!/usr/bin/env pwsh
# Codexによる独立コードレビュー(read-only)。
# 現在のgit diffをCodexにレビューさせ、ファイルは変更させない。
#
# 使い方:
#   ./scripts/codex-review.ps1
#   ./scripts/codex-review.ps1 -Base main   # mainからの差分をレビュー対象にする
#
# 注記(Windows): Codex CLIの--sandbox read-onlyは、Windows環境では
# git等の外部コマンド実行そのものを全面拒否することが確認されている
# (2026-08-31、PR #1レビュー時に判明)。そのため本スクリプトは、Codexに
# 「自分でgit diffやAGENTS.md/STATUS.md/DECISIONS.mdを読ませる」のではなく、
# このスクリプト側でそれらを取得しプロンプトへ直接埋め込んで渡す方式にしている。
# read-onlyサンドボックス自体は防御多層化の一環として維持する(AGENTS.md参照)。

param(
    [string]$Base = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# 呼び出し元のPowerShellセッションのコンソールエンコーディング(既定では
# 日本語Windowsのシステムコードページ、UTF-8ではないことが多い)に依存すると、
# 標準入力でcodexへ渡す日本語プロンプトが文字化けする(実機で確認済み)。
# セッション設定に関わらずこのスクリプト内では常にUTF-8を強制する。
# ($false = BOM(プリアンブル)を付与しない。既定の[Encoding]::UTF8はBOM付きで、
#  標準入力へパイプする際に先頭へ不要なBOM文字が混入するため避ける)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8NoBom
[Console]::InputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

$repoRoot = git rev-parse --show-toplevel
if ($LASTEXITCODE -ne 0) {
    Write-Error "git rev-parse --show-toplevel に失敗しました(gitリポジトリ外で実行していませんか?)。"
    exit 1
}
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
    Write-Host "[info] git diff $Base...HEAD を対象にします"
    $diffRange = "$Base...HEAD"
} else {
    Write-Host "[info] 作業ツリーの現在の差分(HEAD比較、staged/unstaged両方)を対象にします"
    $diffRange = "HEAD"
}

git status --short

# git diffの出力はPowerShellでは行ごとの文字列配列として返るため、そのまま
# 文字列展開すると既定の$OFS(半角スペース)で連結され改行が失われる
# (実機のCodexレビューでP1指摘・実際に1行へ潰れることを確認済み)。
# 配列のまま`n結合して1つの複数行文字列に変換する。
$diffLines = @(git diff $diffRange)
if ($LASTEXITCODE -ne 0) {
    Write-Error "git diff $diffRange に失敗しました。"
    exit 1
}
$diff = $diffLines -join "`n"

# git diffは追跡済みファイルの変更しか含まない。新規の未追跡ファイルは
# 「差分が空」判定・レビュー対象の両方から漏れてしまう(実機のCodexレビューで
# P1指摘)。-c core.quotepath=falseは、日本語等の非ASCIIパス名が既定で
# バックスラッシュエスケープ付きの引用符表記になり後続のパス解決が壊れるのを防ぐ。
$untrackedLines = @(git -c core.quotepath=false status --porcelain)
if ($LASTEXITCODE -ne 0) {
    Write-Error "git status --porcelain に失敗しました。"
    exit 1
}
$untrackedPaths = $untrackedLines | Where-Object { $_ -match '^\?\? ' } | ForEach-Object { $_.Substring(3) }

if ((-not $diff) -and ($untrackedPaths.Count -eq 0)) {
    Write-Warning "差分が空です($diffRange)。レビュー対象がないため終了します。"
    exit 0
}

$tick = '`'

# 未追跡ファイルを無条件に埋め込むと、.gitignore登録漏れの秘密鍵・認証情報等が
# 外部API(Codex)へ送信されてしまう(実機のCodexレビューでP1指摘。このリポジトリは
# 過去に実際に.p8ファイルの誤配置事故があった、DECISIONS.md/秘密鍵の保管ルール参照)。
# 既知の秘密情報系拡張子と、大きすぎる/バイナリのファイルは中身を送らずパスのみ記載する。
$secretExtensions = @('.p8', '.p12', '.jks', '.pem', '.key', '.keystore', '.env')
$maxUntrackedFileBytes = 200KB

function Get-SafeFence {
    # 埋め込むdiffの内容自体に3連バッククォート(コードフェンス)が含まれていると
    # 固定のフェンスが途中で閉じてしまう(実機のCodexレビューでP2指摘)。
    # 内容中の最長連続バッククォートより長いフェンスを動的に生成する。
    param([string]$Content)
    $maxRun = 0
    $current = 0
    foreach ($ch in $Content.ToCharArray()) {
        if ($ch -eq '`') {
            $current++
            if ($current -gt $maxRun) { $maxRun = $current }
        } else {
            $current = 0
        }
    }
    return ('`' * [Math]::Max(3, $maxRun + 1))
}

function Get-FileBlock {
    # -LiteralPathを使う: 通常のPathパラメーターは`[`・`]`等を含む実在ファイル名を
    # ワイルドカードとして誤解釈しうる(実機のCodexレビューでP2指摘)。
    param([string]$Path, [string]$Label)
    $header = "## $Label ($tick$Path$tick)"
    if (Test-Path -LiteralPath $Path) {
        # BOM無しUTF-8ファイルはWindows PowerShell 5.1のGet-Contentが既定で
        # システムのANSIコードページ(Shift-JIS)として誤読し文字化けするため、
        # -Encoding UTF8を必ず明示する(feedback_vault_encoding_pitfallと同種の罠)。
        $content = Get-Content -Raw -Encoding UTF8 -LiteralPath $Path
        return "$header`n`n$content"
    }
    return "$header`n`n(ファイルが存在しません)"
}

function Get-UntrackedFileBlock {
    param([string]$RelPath, [string]$FullPath)
    $header = "## 未追跡ファイル(git diffには含まれない新規ファイル) ($tick$RelPath$tick)"
    $ext = [System.IO.Path]::GetExtension($FullPath).ToLowerInvariant()
    if ($secretExtensions -contains $ext) {
        return "$header`n`n(拡張子 $tick$ext$tick は秘密情報の可能性があるため内容は送信していません。手動で確認してください)"
    }
    $size = (Get-Item -LiteralPath $FullPath).Length
    if ($size -gt $maxUntrackedFileBytes) {
        return "$header`n`n(ファイルサイズが$($maxUntrackedFileBytes / 1KB)KBを超えるため内容は送信していません。サイズ: $size バイト)"
    }
    $bytes = [System.IO.File]::ReadAllBytes($FullPath)
    if ($bytes -contains 0) {
        return "$header`n`n(バイナリファイルと判定したため内容は送信していません)"
    }
    $content = Get-Content -Raw -Encoding UTF8 -LiteralPath $FullPath
    return "$header`n`n$content"
}

$instructions = Get-Content -Raw -Encoding UTF8 $promptFile

$sections = @($instructions)
$sections += Get-FileBlock -Path (Join-Path $repoRoot "AGENTS.md") -Label "AGENTS.md"
$sections += Get-FileBlock -Path (Join-Path $repoRoot "STATUS.md") -Label "STATUS.md"
$sections += Get-FileBlock -Path (Join-Path $repoRoot "DECISIONS.md") -Label "DECISIONS.md"

$taskFiles = Get-ChildItem -Path (Join-Path $repoRoot ".ai/tasks") -Filter "T*.md" -ErrorAction SilentlyContinue
foreach ($taskFile in $taskFiles) {
    $sections += Get-FileBlock -Path $taskFile.FullName -Label "タスクファイル $($taskFile.Name)"
}

foreach ($relPath in $untrackedPaths) {
    $fullPath = Join-Path $repoRoot $relPath
    if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
        $sections += Get-UntrackedFileBlock -RelPath $relPath -FullPath $fullPath
    } else {
        $sections += "## 未追跡ディレクトリ ($tick$relPath$tick)`n`n(ディレクトリのため内容は省略。個別ファイルをレビュー対象に含めるには``git add -N``で追跡対象にしてから再実行してください)"
    }
}

if ($diff) {
    $fence = Get-SafeFence -Content $diff
    $diffHeader = "## レビュー対象のgit diff ($tick$diffRange$tick)"
    $sections += "$diffHeader`n`n${fence}diff`n$diff`n$fence"
}

$prompt = ($sections -join "`n`n---`n`n")

# read-only sandboxはCodex側の安全境界の1つであって唯一の境界ではない。
# プロンプト側にも「変更禁止」を明示しているのはそのため(AGENTS.md/README参照)。
# 上記の通りコンテキストは全て埋め込み済みのため、Codexはgit/ファイル読み込みを
# 自分で実行する必要がない(Windowsのread-onlyサンドボックス制約を回避)。
#
# プロンプトは引数ではなく標準入力で渡す。Windows PowerShellのネイティブコマンド
# 引数渡しは、文字列中に二重引用符(コード差分に含まれるダブルクォート等)が
# あるとコマンドライン境界が壊れることがある(実機で `error: unexpected argument
# 'git' found` を確認済み)。標準入力経由ならこの問題を回避できる。
$prompt | codex exec --sandbox read-only
if ($LASTEXITCODE -ne 0) {
    Write-Error "codex exec がエラー終了しました(exit code $LASTEXITCODE)。"
    exit $LASTEXITCODE
}
