#!/usr/bin/env pwsh
# Codexによる独立コードレビュー(read-only)。
# 現在のgit diffをCodexにレビューさせ、ファイルは変更させない。
#
# 使い方:
#   ./scripts/codex-review.ps1
#   ./scripts/codex-review.ps1 -Base main         # mainからの差分をレビュー対象にする
#   ./scripts/codex-review.ps1 -Task T012         # タスクファイル.ai/tasks/T012*.mdも埋め込む
#   ./scripts/codex-review.ps1 -Base main -Task T012,T017
#
# 注記(Windows): Codex CLIの--sandbox read-onlyは、Windows環境では
# git等の外部コマンド実行そのものを全面拒否することが確認されている
# (2026-08-31、PR #1レビュー時に判明)。そのため本スクリプトは、Codexに
# 「自分でgit diffやAGENTS.md/STATUS.md/DECISIONS.mdを読ませる」のではなく、
# このスクリプト側でそれらを取得しプロンプトへ直接埋め込んで渡す方式にしている。
# read-onlyサンドボックス自体は防御多層化の一環として維持する(AGENTS.md参照)。

param(
    [string]$Base = "",
    [string[]]$Task = @()
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

git status --short

# git diffの出力はPowerShellでは行ごとの文字列配列として返るため、そのまま
# 文字列展開すると既定の$OFS(半角スペース)で連結され改行が失われる
# (実機のCodexレビューでP1指摘・実際に1行へ潰れることを確認済み)。
# 配列のまま`n結合して1つの複数行文字列に変換する。
#
# -Base指定時、以前は`git diff $Base...HEAD`(コミット済み差分)だけを対象にしており、
# 作業ツリーの未コミット変更(staged/unstaged)がレビューから漏れていた
# (STATUS.md記載のfollow-up、2026-09-13修正)。-Base指定の有無に関わらず常に
# 作業ツリーの差分(git diff HEAD)を対象にし、-Base指定時はコミット済み差分も
# 別セクションとして追加で埋め込む。
$committedDiff = ""
if ($Base) {
    Write-Host "[info] git diff $Base...HEAD をコミット済み差分として対象にします"
    $committedDiffLines = @(git diff "$Base...HEAD")
    if ($LASTEXITCODE -ne 0) {
        Write-Error "git diff $Base...HEAD に失敗しました。"
        exit 1
    }
    $committedDiff = $committedDiffLines -join "`n"
}

Write-Host "[info] 作業ツリーの現在の差分(HEAD比較、staged/unstaged両方)を対象にします"
$workingTreeDiffLines = @(git diff HEAD)
if ($LASTEXITCODE -ne 0) {
    Write-Error "git diff HEAD に失敗しました。"
    exit 1
}
$workingTreeDiff = $workingTreeDiffLines -join "`n"

# git diffは追跡済みファイルの変更しか含まない。新規の未追跡ファイルは
# 「差分が空」判定・レビュー対象の両方から漏れてしまう(実機のCodexレビューで
# P1指摘)。-c core.quotepath=falseは、日本語等の非ASCIIパス名が既定で
# バックスラッシュエスケープ付きの引用符表記になり後続のパス解決が壊れるのを防ぐ。
# --untracked-files=allは、新規untrackedディレクトリを1エントリにまとめず配下の
# ファイルを個別に列挙させるため(既定のnormalモードだと新規ディレクトリ自体が
# 1行にまとまり、配下のファイル群がレビュー対象から漏れる、STATUS.md記載の
# follow-up、2026-09-13修正)。
#
# -z(NUL区切り出力)を使う: -z無しの`git status --porcelain`は、空白を含む
# パスを`"review notes.md"`のようにダブルクォートで囲んで返す。単純な
# Substring(3)ではこの引用符込みの文字列をそのままパスとして扱ってしまい、
# 実際には存在しないパスとして後続のTest-Path等が失敗し、当該ファイルが
# レビュー対象から静かに脱落する(Codexレビュー指摘、2026-09-13。実機で
# 空白を含むファイル名を使って再現・確認済み)。-zは引用符処理を行わず、
# 各エントリをNUL文字(`0)区切りの生パスで返すため、この問題が起きない。
# PowerShellのネイティブコマンド出力リダイレクト(`>`)は既定でBOM付き
# UTF-8として書き込むため、後続でBOM文字(U+FEFF)を明示的に除去する。
$untrackedRawPath = [System.IO.Path]::GetTempFileName()
try {
    & git -c core.quotepath=false status --porcelain -z --untracked-files=all > $untrackedRawPath
    if ($LASTEXITCODE -ne 0) {
        Write-Error "git status --porcelain に失敗しました。"
        exit 1
    }
    $untrackedRawBytes = [System.IO.File]::ReadAllBytes($untrackedRawPath)
} finally {
    Remove-Item -LiteralPath $untrackedRawPath -Force -ErrorAction SilentlyContinue
}
$untrackedRawText = [System.Text.Encoding]::UTF8.GetString($untrackedRawBytes).TrimStart([char]0xFEFF)
$untrackedEntries = @($untrackedRawText -split "`0" | Where-Object { $_ -ne "" })
$untrackedPaths = @(
    $untrackedEntries | Where-Object { $_.StartsWith("?? ") } | ForEach-Object { $_.Substring(3) }
)

if ((-not $committedDiff) -and (-not $workingTreeDiff) -and ($untrackedPaths.Count -eq 0)) {
    Write-Warning "差分が空です。レビュー対象がないため終了します。"
    exit 0
}

$tick = '`'

# 未追跡ファイルを無条件に埋め込むと、.gitignore登録漏れの秘密鍵・認証情報等が
# 外部API(Codex)へ送信されてしまう(実機のCodexレビューでP1指摘。このリポジトリは
# 過去に実際に.p8ファイルの誤配置事故があった、DECISIONS.md/秘密鍵の保管ルール参照)。
# 判定ロジック(拡張子+ファイル名パターン+JSON内容の構造チェック)はTest-IsSecretUntrackedPath/
# Test-IsSecretFileContentへ切り出し、単体テスト(codexReviewUntrackedFileGuard.Tests.ps1)
# できるようにしている。ファイル名に"secret"を含めていないのは、.gitignoreの`*secret*`
# ルールに一致してこのファイル自体がgit管理対象から除外されてしまうため(Codexレビューで
# 実際に発生を確認、2026-09-13)。
. (Join-Path $PSScriptRoot "codexReviewUntrackedFileGuard.ps1")
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
        # AGENTS.md/STATUS.md/DECISIONS.md/タスクファイルはこれまで秘密情報検査の
        # 対象外だった(Codexレビュー指摘、2026-09-13)。既にコミット済みの資料とはいえ、
        # 過去にタスクファイルへ実ジャッジIDを誤記載した事故(T008参照)もあるため、
        # 未追跡ファイル・diffと同じ検査をここにも適用する。
        if (Test-IsSecretFileContent -Content $content) {
            return "$header`n`n(内容が秘密情報の可能性が高いと判定したため内容は送信していません。手動で確認してください)"
        }
        return "$header`n`n$content"
    }
    return "$header`n`n(ファイルが存在しません)"
}

function Get-UntrackedFileBlock {
    param([string]$RelPath, [string]$FullPath)
    $header = "## 未追跡ファイル(git diffには含まれない新規ファイル) ($tick$RelPath$tick)"
    if (Test-IsSecretUntrackedPath -RelPath $RelPath) {
        return "$header`n`n(パスまたは拡張子から秘密情報の可能性が高いと判定したため内容は送信していません。手動で確認してください)"
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
    # ファイル名からは秘密情報と判別できないケース(ランダムな名前のサービスアカウント
    # JSON等)への対策として、内容そのものも追加でチェックする(Codexレビュー指摘、
    # 2026-09-13。このリポジトリで実際に使っているサービスアカウントJSONの実名は
    # ファイル名に手がかりが無い)。
    if (Test-IsSecretFileContent -Content $content) {
        return "$header`n`n(内容が秘密情報(サービスアカウント鍵・OAuthクライアントシークレット・PEM形式の秘密鍵等)の可能性が高いと判定したため内容は送信していません。手動で確認してください)"
    }
    return "$header`n`n$content"
}

$instructions = Get-Content -Raw -Encoding UTF8 $promptFile

$sections = @($instructions)
$sections += Get-FileBlock -Path (Join-Path $repoRoot "AGENTS.md") -Label "AGENTS.md"
$sections += Get-FileBlock -Path (Join-Path $repoRoot "STATUS.md") -Label "STATUS.md"
$sections += Get-FileBlock -Path (Join-Path $repoRoot "DECISIONS.md") -Label "DECISIONS.md"

# 以前はタスクファイルが1件も無かったため、.ai/tasks配下のT*.mdを無条件に全件
# 埋め込んでいたが、タスク数が増えた現在は対象の差分と無関係なタスクファイルまで
# 毎回埋め込むことになり、プロンプトが肥大化する(STATUS.md記載のfollow-up、
# 2026-09-13修正)。-Taskで明示的に指定されたタスクIDに前方一致するファイルだけを
# 埋め込む(未指定時は埋め込まない。関連タスクがあれば呼び出し側が明示すること)。
if ($Task.Count -gt 0) {
    $allTaskFiles = Get-ChildItem -Path (Join-Path $repoRoot ".ai/tasks") -Filter "T*.md" -ErrorAction SilentlyContinue
    $taskFiles = @(
        $allTaskFiles | Where-Object {
            $fileBaseName = $_.BaseName
            @($Task | Where-Object { $fileBaseName -like "$_*" }).Count -gt 0
        }
    )
    foreach ($taskFile in $taskFiles) {
        $sections += Get-FileBlock -Path $taskFile.FullName -Label "タスクファイル $($taskFile.Name)"
    }
} else {
    # AGENTS.mdはタスクに関わる作業でタスクファイルの参照を求めているため、単なる
    # 情報メッセージ(Write-Host)ではなく警告として目立たせる(Codexレビュー指摘、
    # 2026-09-13: 未指定のまま見落とされ、タスク文脈を欠いたレビューが完了扱いに
    # なりうる)。-Taskを必須化はしない(タスクに紐付かない変更のレビューも
    # 正当な用途のため)。
    Write-Warning "-Taskが未指定です。タスクに関する作業であれば、関連タスクファイルを埋め込むために -Task T012 のように指定して再実行してください(このままではタスクファイルの内容を欠いたままレビューされます)。"
}

foreach ($relPath in $untrackedPaths) {
    $fullPath = Join-Path $repoRoot $relPath
    if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
        $sections += Get-UntrackedFileBlock -RelPath $relPath -FullPath $fullPath
    } else {
        $sections += "## 未追跡ディレクトリ ($tick$relPath$tick)`n`n(ディレクトリのため内容は省略。個別ファイルをレビュー対象に含めるには``git add -N``で追跡対象にしてから再実行してください)"
    }
}

# 秘密情報の内容検査は、これまで未追跡ファイル(Get-UntrackedFileBlock)にしか
# 適用しておらず、`git add`済み・追跡済みファイルの差分(committedDiff/workingTreeDiff)は
# 無検査のまま送信していた(Codexレビュー指摘、2026-09-13: ランダム名のサービスアカウント
# JSONをstageして実行すると鍵がそのまま送信されうる)。diff側にも同じ検査を適用し、
# 検出した場合は送信せず停止する(未追跡ファイルのように「パスのみ記載」できるほど
# diffは構造化されていないため、fail-closedで実行自体を止める)。
if ($committedDiff -and (Test-IsSecretFileContent -Content $committedDiff)) {
    Write-Error "コミット済み差分($Base...HEAD)に秘密情報の可能性が高い内容が含まれています。該当ファイルを確認し、秘密情報であれば.gitignoreへ追加のうえhistory からも除去してから再実行してください。"
    exit 1
}
if ($workingTreeDiff -and (Test-IsSecretFileContent -Content $workingTreeDiff)) {
    Write-Error "作業ツリーの差分(staged/unstaged)に秘密情報の可能性が高い内容が含まれています。該当ファイルを確認し、秘密情報であればstageを取り消す・.gitignoreへ追加するなどしてから再実行してください。"
    exit 1
}

if ($committedDiff) {
    $fence = Get-SafeFence -Content $committedDiff
    $diffHeader = "## レビュー対象のgit diff(コミット済み、$tick$Base...HEAD$tick)"
    $sections += "$diffHeader`n`n${fence}diff`n$committedDiff`n$fence"
}
if ($workingTreeDiff) {
    $fence = Get-SafeFence -Content $workingTreeDiff
    $diffHeader = "## レビュー対象のgit diff(作業ツリーの未コミット変更、${tick}HEAD比較$tick)"
    $sections += "$diffHeader`n`n${fence}diff`n$workingTreeDiff`n$fence"
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
