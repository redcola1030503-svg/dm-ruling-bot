# codex-review.ps1が使う、未追跡ファイルの内容をCodexへ送信してよいかどうかの判定ロジック。
# 関数定義のみで副作用(git呼び出し・codex exec等)を一切持たないため、
# codex-review.ps1本体からdot-sourceされるのと同時に、
# codexReviewUntrackedFileGuard.Tests.ps1からも直接dot-sourceしてテストできる。
#
# ファイル名に"secret"を含めていない: .gitignoreの`*secret*`ルール(誤って秘密鍵等が
# コミットされるのを防ぐための既存ルール)に一致してこのファイル自体がgit管理対象から
# 除外されてしまい、クリーン環境でcodex-review.ps1のdot-sourceが失敗する事故が実際に
# 起きたため(Codexレビューで発見、2026-09-13)。

# 既知の秘密情報系拡張子だけでは、`--untracked-files=all`でディレクトリ配下の
# ファイルが個別に列挙されるようになった際、拡張子を伴わない/異なる拡張子の
# 秘密情報ファイル(例: credentials/service-account.json、.env.local、token.txt)を
# 見逃してしまう(実機のCodexレビューでP1指摘、2026-09-13。このリポジトリは過去に
# 実際に.p8ファイルの誤配置事故があった、DECISIONS.md/秘密鍵の保管ルール参照)。
# 拡張子チェックに加え、パス中の代表的な秘密情報関連語(大文字小文字を区別しない)も
# 判定に使う。
$script:SecretExtensions = @('.p8', '.p12', '.jks', '.pem', '.key', '.keystore', '.env', '.pfx')
$script:SecretNamePattern = 'secret|credential|password|token|api[-_]?key|private[-_]?key|service[-_]?account|\.env($|\.)|id_rsa'

function Test-IsSecretUntrackedPath {
    <#
    .SYNOPSIS
    未追跡ファイルのパスが、秘密情報を含む可能性が高いかどうかを判定する。
    trueの場合、呼び出し元はファイル内容を送信せずパスのみ記載すること。
    #>
    param([Parameter(Mandatory = $true)][string]$RelPath)

    $ext = [System.IO.Path]::GetExtension($RelPath)
    if ($script:SecretExtensions -contains $ext.ToLowerInvariant()) {
        return $true
    }
    return [bool]($RelPath -match $script:SecretNamePattern)
}

# パスだけでは判定できない秘密情報ファイルへの対策。このリポジトリで実際に使っている
# Googleサービスアカウントの秘密鍵JSON(`dmrulingbot-aiteacher-c03e5cc40727.json`のような
# ランダムな名前)は、ファイル名から秘密情報だと推測できない(Codexレビュー指摘、
# 2026-09-13)。そのため、JSON/テキストファイルの内容そのものに、サービスアカウント鍵・
# OAuthクライアントシークレット・PEM形式の秘密鍵に典型的なマーカーが含まれていないかを
# 追加でチェックする。
$script:SecretContentPattern = '"private_key"\s*:|"type"\s*:\s*"service_account"|"client_secret"\s*:|-----BEGIN (RSA )?PRIVATE KEY-----'

function Test-IsSecretFileContent {
    <#
    .SYNOPSIS
    ファイルの中身(テキスト)が、秘密情報を含む可能性が高いかどうかを判定する。
    ファイル名からは秘密情報と判別できないケース(ランダムな名前のサービスアカウント
    JSON等)への対策。trueの場合、呼び出し元は内容を送信せずパスのみ記載すること。
    #>
    param([Parameter(Mandatory = $true)][string]$Content)

    return [bool]($Content -match $script:SecretContentPattern)
}
