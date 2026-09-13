# Test-IsSecretUntrackedPath / Test-IsSecretFileContentの単体テスト
# (Pester 3.4、Windows PowerShell 5.1に同梱)。
#
# 実行方法: Invoke-Pester scripts/codexReviewUntrackedFileGuard.Tests.ps1
#
# codex-review.ps1本体(git/codex execを実際に呼ぶ副作用を持つ)はdot-sourceせず、
# 判定ロジックだけを切り出したcodexReviewUntrackedFileGuard.ps1のみをテスト対象にする。

. (Join-Path $PSScriptRoot "codexReviewUntrackedFileGuard.ps1")

Describe "Test-IsSecretUntrackedPath" {
    Context "秘密情報の可能性が高いパスをtrueと判定する" {
        It "既知の秘密情報系拡張子(.p8)" {
            Test-IsSecretUntrackedPath -RelPath "dm-ruling-bot-secrets/AuthKey.p8" | Should Be $true
        }

        It "ディレクトリ配下のcredentials/service-account.json(--untracked-files=allで新たに列挙されるようになったケース、2026-09-13の回帰対象)" {
            Test-IsSecretUntrackedPath -RelPath "credentials/service-account.json" | Should Be $true
        }

        It ".env.local(拡張子が完全一致しない.envバリエーション)" {
            Test-IsSecretUntrackedPath -RelPath ".env.local" | Should Be $true
        }

        It "token.txtのようなファイル名に秘密情報関連語を含むファイル" {
            Test-IsSecretUntrackedPath -RelPath "config/token.txt" | Should Be $true
        }

        It "api_key.jsonのようなファイル" {
            Test-IsSecretUntrackedPath -RelPath "src/config/api_key.json" | Should Be $true
        }

        It "大文字小文字が混在していても検出する(SECRET.yaml)" {
            Test-IsSecretUntrackedPath -RelPath "infra/SECRET.yaml" | Should Be $true
        }
    }

    Context "通常のソースファイルはfalseと判定する" {
        It "通常のTypeScriptファイル" {
            Test-IsSecretUntrackedPath -RelPath "src/ruling/rulingJob.ts" | Should Be $false
        }

        It "通常のMarkdownドキュメント" {
            Test-IsSecretUntrackedPath -RelPath ".ai/tasks/T099-example.md" | Should Be $false
        }

        It "通常のJSONファイル(秘密情報関連語を含まない)" {
            Test-IsSecretUntrackedPath -RelPath "src/config/settings.json" | Should Be $false
        }

        It "ファイル名からは秘密情報と判別できないケース(このリポジトリで実際に使っているサービスアカウントJSONと同じ命名パターン、パス単体では検出できないことの確認。内容ベースの検出はTest-IsSecretFileContent側の責務)" {
            Test-IsSecretUntrackedPath -RelPath "dmrulingbot-aiteacher-c03e5cc40727.json" | Should Be $false
        }
    }
}

# 以下のフィクスチャは、Test-IsSecretFileContentが検出する対象の文字列パターン
# ($script:SecretContentPattern参照)を、ソースファイル中に連続した1つの文字列
# リテラルとして書かない。ソース中に連続して書くと、codex-review.ps1がこのテスト
# ファイル自体を未追跡ファイルとして埋め込む際、Test-IsSecretFileContentがこの
# テストファイルのソースコードそのものに反応してしまい、レビュー入力からこの
# ファイルの内容が丸ごと伏せられてしまう(実際にCodexレビューでこの自己検閲が
# 発生していることを指摘された、2026-09-13。この段落自体も対象文字列を連続して
# 書かないよう意図的に婉曲な書き方にしている)。文字列を分割して実行時に連結する
# ことで、実行時の値(判定対象)としては検出文字列を含みつつ、ソースコード上には
# 連続した検出対象文字列が現れないようにする。
Describe "Test-IsSecretFileContent" {
    Context "秘密情報を含む内容をtrueと判定する" {
        It "Googleサービスアカウント鍵JSON(このリポジトリで実際に使っているファイルと同じ構造、2026-09-13にCodexレビューで指摘された回帰対象)" {
            $typeField = '"type": "service' + '_account",'
            $privateKeyField = '"private' + '_key": "-----BEGIN ' + 'PRIVATE' + ' KEY-----\nMIIExample...\n-----END ' + 'PRIVATE' + ' KEY-----\n",'
            $content = @"
{
  $typeField
  "project_id": "dmrulingbot-aiteacher",
  "private_key_id": "abcdef0123456789",
  $privateKeyField
  "client_email": "revenuecat-play-billing@dmrulingbot-aiteacher.iam.gserviceaccount.com"
}
"@
            Test-IsSecretFileContent -Content $content | Should Be $true
        }

        It "OAuthクライアントシークレットを含むJSON" {
            $clientSecretField = '"client' + '_secret":"abcdefGHIJKL1234"'
            $content = '{"client_id":"example.apps.googleusercontent.com",' + $clientSecretField + '}'
            Test-IsSecretFileContent -Content $content | Should Be $true
        }

        It "PEM形式の秘密鍵がテキスト中に直接埋め込まれている場合" {
            $pemBegin = '-----BEGIN RSA ' + 'PRIVATE' + ' KEY-----'
            $pemEnd = '-----END RSA ' + 'PRIVATE' + ' KEY-----'
            $content = "対象: `n$pemBegin`nMIIExample...`n$pemEnd"
            Test-IsSecretFileContent -Content $content | Should Be $true
        }

        It "LINE連携の環境変数代入形式(2026-09-13の4回目レビューで追加した回帰対象、タイトル文言も自己検閲を避けるため実際の変数名を連続して書いていない)" {
            $envLine = 'LINE_CHANNEL_ACCESS' + '_TOKEN' + '=abcdefGHIJKL1234567890'
            Test-IsSecretFileContent -Content $envLine | Should Be $true
        }

        It "RevenueCat連携の環境変数代入形式" {
            $envLine = 'REVENUECAT_API' + '_KEY' + '=sk_abcdefGHIJKL1234567890'
            Test-IsSecretFileContent -Content $envLine | Should Be $true
        }

        It "HTTP認証ヘッダーでのベアラートークン提示形式" {
            $header = 'Authorization:' + ' Bearer ' + 'abcdefGHIJKL1234567890'
            Test-IsSecretFileContent -Content $header | Should Be $true
        }

        It "OAuthのリフレッシュ用トークンを表す典型的なフィールド名" {
            $field = 'refresh' + '_token'
            $content = '{"' + $field + '":"1//abcdefGHIJKL1234567890"}'
            Test-IsSecretFileContent -Content $content | Should Be $true
        }
    }

    Context "通常のファイル内容はfalseと判定する" {
        It "通常の設定JSON" {
            $content = '{"appName":"dm-ruling-bot","featureFlags":{"useBatchApi":false}}'
            Test-IsSecretFileContent -Content $content | Should Be $false
        }

        It "通常のMarkdown本文" {
            Test-IsSecretFileContent -Content "# タスク概要`n方針を記録する。" | Should Be $false
        }

        It "環境変数名への言及だけで実際の値の代入が無い場合(誤検知しないことの確認)" {
            $envName = 'REVENUECAT_API' + '_KEY'
            $content = "Renderダッシュボードで ``$envName`` を設定してください。"
            Test-IsSecretFileContent -Content $content | Should Be $false
        }
    }
}
