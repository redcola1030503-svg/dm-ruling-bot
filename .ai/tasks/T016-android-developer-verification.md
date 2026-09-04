# T016: Google Play「Android デベロッパーの確認」対応調査

Status: Draft(調査完了・Codexレビュー実施済み、調査内容自体への異議は無し。結論はユーザー判断待ちではなくPlay Console実機確認待ち)

## Goal

ユーザーがGoogle Playから以下のメールを受信した。

> 件名: 「syotyo 様: [最終リマインダー] 2026年9月30日までにアプリと署名鍵を登録して、Androidデベロッパーの確認要件を満たしてください」
> 要点: 2026年9月30日までに配信継続予定のGoogle Playアプリの「パッケージ名+署名鍵」の登録が必要。未登録の場合、期限後に対象アプリがGoogle Playから削除される可能性がある。Google Playアプリの99%以上はGoogle Play署名鍵(Play App Signing)を利用しているため自動登録済み。

対象アプリ: デュエマ裁定確認アプリ AIティーチャーくん(パッケージ名 `com.dmrulingbot.aiteacher`、現在Google Play Consoleでクローズドテスト配信中)。

このアプリのAndroid/Flutter設定を調査し、コード・署名設定・Google Play Consoleそれぞれで必要な対応を整理する。

## 調査結果(2026-09-04、コード確認済み・読み取り専用)

### 1. パッケージ名の確認

`mobile_app/android/app/build.gradle.kts`で`applicationId`・`namespace`ともに`com.dmrulingbot.aiteacher`。`AndroidManifest.xml`に旧形式の`package=`属性による上書きは無く、productFlavors等の分岐も存在しない。メール記載のパッケージ名と一致している。

### 2. Google Play App Signingの利用有無

コードからは直接確認できない(Play Console側の設定情報のため)が、以下2点から利用している可能性が非常に高いと判断した。

- このアプリのPlay Console登録は2026年8月末〜9月(RevenueCat/内部テスト設定の時期、STATUS.md記載)と新しく、**Google Play App Signingは2021年8月以降に新規作成されたアプリでは必須(オプトアウト不可)**。
- ローカル署名鍵のエイリアス名が`upload`(Googleの鍵生成ツールがPlay App Signingモデルの「開発者保持アップロード鍵」に用いる標準的な命名)。

**断定はできない**(Play Console側の実際の表示を見ないと確定しない)。

### 3. ローカルのupload key / keystore設定状況(値は本ファイルに記載しない)

- `mobile_app/android/key.properties`に`keyAlias`(`upload`)・`keyPassword`・`storeFile`(`upload-keystore.jks`)・`storePassword`の4項目。パスワード等の値はこのファイル・会話ログのいずれにも記載していない。
- `key.properties`・`*.jks`はルート`.gitignore`(48〜50行目)・`android/.gitignore`(12〜14行目)の両方で除外されており、`git ls-files`で追跡対象に含まれていないことを確認済み(コミット漏れなし)。
- 署名設定は`android/app/build.gradle.kts`の`signingConfigs.release`1箇所のみ。予備の署名設定・flavor別設定は存在しない。

### 4. Play Console側で追加対応が必要になりそうな構成か

Web検索(Android Developers公式ドキュメント・Google公式ブログ)で確認した現行制度の内容:
- Play App Signingを利用しているアプリは自動登録(auto-registration)の対象になる
- Google Play以外での配布や、Play版と異なる署名鍵を使っている場合は、その組み合わせを個別に手動登録する必要がある
- 登録状況はPlay Console内の「Android developer verification」ページでアプリごとに確認できる

このアプリは上記2の通りPlay App Signingを利用している可能性が高く、かつ下記5の通り他経路の配布実績も無いため、**手動登録が必要な典型パターンには該当しないと推定される**。ただし最終確認はPlay Console実機でのステータス表示に依存する。

### 5. Google Play以外での配布・別署名鍵の使用形跡

- リポジトリ全体を検索し、`upload-keystore.jks`以外の`.jks`/`.keystore`ファイルは存在しないことを確認
- CI設定は`codemagic.yaml`のみ存在するが、内容はiOSビルド専用(Android関連の記述なし、`grep -i "android|apk|aab|keystore|jks"`で0件)
- fastlane等の他配布ツールも見つからず
- STATUS.md記載のAndroidビルド運用は一貫してローカルで`flutter build appbundle --release`を実行しPlay Consoleへ手動アップロードのみ

**Google Play以外での配布や別署名鍵の使用形跡は無い。**

## 結論(現段階)

**「Google Play Console上の確認だけ必要」** — コード・署名設定の変更は不要と判断。ただし断定的な判断根拠(Play App Signing利用の有無、登録状況)はPlay Console側の実際の表示に依存するため、ユーザーによるPlay Console実機確認が必要。

### Play Console確認手順(ユーザー向けに提示済み)

1. [Google Play Console](https://play.google.com/console/)にログイン
2. 対象アプリ「デュエマ裁定確認アプリ AIティーチャーくん」を選択
3. ホーム画面上部、または「Android デベロッパーの確認」ページを開く(検索窓で"Android developer verification"等)
4. パッケージ名`com.dmrulingbot.aiteacher`の登録ステータスを確認
   - 「登録済み」→ 対応不要、完了
   - 「未登録」「ドラフト」→ 追加対応が必要になるため、その時点で表示内容を確認の上、対応を再検討する
5. あわせて開発者アカウント自体の本人確認状況も同セクション内で確認する

## 未確定・要確認事項

- Play Console実機での登録ステータス表示(ユーザー確認待ち)
- 万一「未登録」だった場合の具体的な追加対応(公開鍵証明書の提出等)は、実際の表示内容を見てから個別に検討する

## Acceptance Criteria(現段階)

- [x] パッケージ名がメール記載の対象と一致するか確認する → 完了、一致を確認
- [x] Play App Signing利用の蓋然性をコードから調査する → 完了(直接確認は不可、状況証拠から蓋然性が高いと判断)
- [x] ローカルのkeystore/key.properties設定状況を確認する(値は非開示) → 完了
- [x] Google Play以外での配布・別署名鍵使用の形跡を調査する → 完了、形跡なしを確認
- [x] コード/署名設定/Play Consoleそれぞれの対応要否を整理する → 完了
- [x] Play Console側で確認すべき手順を具体的にまとめる → 完了
- [ ] ユーザーがPlay Consoleで実際の登録ステータスを確認し、結果をこのタスクへ反映する
- [ ] 「未登録」だった場合の追加対応要否を確認・実施する(該当する場合のみ)

## Implementation Owner

(調査のみ、実装無し)

## Reviewer

Codex

## Review History

### Review 1 — 2026-09-04(`scripts/codex-review.ps1`で他の未コミット差分と共に実施)

このタスクの調査内容・結論自体への異議は無し。唯一の関連指摘はP2(共有状態の同期漏れ): 「T016の調査結果とPlay Console確認待ちがSTATUS.mdへ反映されていない」→ STATUS.mdの`## In Progress`へT016のサマリーと確認待ち状況を追記して解消(2026-09-04)。
