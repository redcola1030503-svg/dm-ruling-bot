# T016: Google Play「Android デベロッパーの確認」対応調査

Status: Completed

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

## 結論

**対応完了** — 2026-09-06にGoogle Play Consoleで対象パッケージが「登録済み」であることを確認した。2026年9月30日のAndroidデベロッパー確認要件に対する追加登録、コード変更、署名設定変更は不要。開発者アカウント本人確認については明示的なステータス文言が表示されなかったため、その状態自体は断定しないが、対象パッケージの登録完了判定には影響しない。

### Play Console確認手順(ユーザー向けに提示済み)

1. [Google Play Console](https://play.google.com/console/)にログイン
2. 対象アプリ「デュエマ裁定確認アプリ AIティーチャーくん」を選択
3. ホーム画面上部、または「Android デベロッパーの確認」ページを開く(検索窓で"Android developer verification"等)
4. パッケージ名`com.dmrulingbot.aiteacher`の登録ステータスを確認
   - 「登録済み」→ 対応不要、完了
   - 「未登録」「ドラフト」→ 追加対応が必要になるため、その時点で表示内容を確認の上、対応を再検討する
5. あわせて開発者アカウント自体の本人確認状況も同セクション内で確認する

## 留保事項

- 「ID」タブには開発者アカウント本人確認の明示的なステータス文言が無かったため、本人確認状態そのものは断定していない。
- 将来、対象パッケージのステータスが「未登録」「要対応」等へ変化した場合のみ、表示内容に基づいて追加対応を別途検討する。

## Acceptance Criteria(現段階)

- [x] パッケージ名がメール記載の対象と一致するか確認する → 完了、一致を確認
- [x] Play App Signing利用の蓋然性をコードから調査する → 完了(直接確認は不可、状況証拠から蓋然性が高いと判断)
- [x] ローカルのkeystore/key.properties設定状況を確認する(値は非開示) → 完了
- [x] Google Play以外での配布・別署名鍵使用の形跡を調査する → 完了、形跡なしを確認
- [x] コード/署名設定/Play Consoleそれぞれの対応要否を整理する → 完了
- [x] Play Console側で確認すべき手順を具体的にまとめる → 完了
- [x] Play Consoleで実際の登録ステータスを確認し、結果をこのタスクへ反映する → **2026-09-06、Codexがread-only確認し「登録済み」を確認**
- [x] 「未登録」だった場合の追加対応要否を確認・実施する(該当する場合のみ) → **登録済みのため該当なし**

## Play Console実確認結果（2026-09-06）

- デベロッパーアカウント内の対象アプリ名が「デュエマ裁定確認アプリ AIティーチャーくん」、パッケージ名が`com.dmrulingbot.aiteacher`であり、T016の調査対象と一致することを確認した。
- 「Android デベロッパーの確認」→「パッケージ名」一覧で、対象パッケージのステータスが明確に**「登録済み」**と表示されていた。2026年9月30日の要件に対する追加登録操作は不要と判断する。
- 「ID」タブには、正式名称と住所を既存のGoogle Play Consoleデベロッパーアカウントから取得する旨が表示され、登録・確認を促す操作は表示されなかった。ただし「本人確認済み」等の明示的なステータス文言は無かったため、開発者アカウント本人確認の状態そのものは断定しない。
- アプリの登録状態確認に必要な画面だけを閲覧した。設定変更、登録ボタン、フォーム送信、鍵・証明書操作、公開状態変更は行っていない。対象外アプリ情報、収益情報、個人情報、鍵・証明書の値は記録していない。

## Play Console実確認方針（2026-09-06）

1. Google Play Consoleをread-onlyで開き、対象アプリ名とパッケージ名`com.dmrulingbot.aiteacher`が一致することを確認する。
2. 「Android デベロッパーの確認」または同等の登録状況画面で、アプリ・署名鍵の登録ステータスと開発者アカウントの確認状態を読み取る。
3. 「登録済み」等の完了表示を確認できた場合だけT016をCompletedとする。未登録・ドラフト・要対応の場合は登録操作を行わず、表示内容と必要な次手を記録して停止する。
4. 設定変更、フォーム送信、鍵・証明書の作成/ダウンロード、アプリの公開状態変更は行わない。パスワード、証明書、鍵、個人情報の値は取得・記録しない。
5. 対象外のアプリ名、収益・課金情報、プロフィール情報等は記録・スクリーンショットへ含めない。開発者アカウントの確認状態は「確認済み」「未確認」「要対応」相当の状態だけを記録し、氏名・書類種別等の詳細は記録しない。

### Stop Conditions

- ログイン、二要素認証、CAPTCHA等でユーザー操作が必要になった場合は、その画面で停止して引き継ぐ。
- 対象アプリまたは登録ステータスを一意に特定できない場合は推測せず停止する。
- 登録・同意・送信等の外部状態変更が必要な場合は、実行直前で停止してユーザーへ確認する。

## Implementation Owner

Codex（2026-09-06のPlay Console実確認。ユーザーが本Codexセッションへ明示依頼し、ブラウザーでread-only確認できるため）

## Reviewer

Claude Code（2026-09-06のPlay Console実確認に対する実施前・実施後レビュー）

## Review History

### Review 1 — 2026-09-04(`scripts/codex-review.ps1`で他の未コミット差分と共に実施)

このタスクの調査内容・結論自体への異議は無し。唯一の関連指摘はP2(共有状態の同期漏れ): 「T016の調査結果とPlay Console確認待ちがSTATUS.mdへ反映されていない」→ STATUS.mdの`## In Progress`へT016のサマリーと確認待ち状況を追記して解消(2026-09-04)。

### Review 2 — 2026-09-06（Play Console実確認の実施前レビュー、Claude Code）

- P0/P1: なし。read-only境界、秘密情報・個人情報の非記録、外部状態変更前の停止、認証・対象特定不能時の停止条件を確認
- P2: 対象外のアプリ名・収益情報等を記録へ含めないことを明文化すると安全。採用し、実確認方針へ追記
- P3: 開発者本人確認の記録粒度を状態だけに限定するとよい。採用し、氏名・書類種別等を記録しないことを追記
- 結論: 重大な問題なし。実施着手可

### Review 3 — 2026-09-06（Play Console実確認後の成果物レビュー、Claude Code）

- P0/P1: なし。read-only境界、秘密・個人情報の非記録、「登録済み」の主張範囲、本人確認状態の未確定保持を確認
- P2: 「結論(現段階)」「未確定・要確認事項」に旧いPlay Console確認待ちの記述が残っている。採用し、実確認済みの結論と本人確認状態の留保へ更新
- P3: なし
- 結論: 重大な問題なし。完了可
