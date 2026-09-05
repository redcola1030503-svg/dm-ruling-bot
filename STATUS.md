# Project Status

Updated: 2026-09-04
Owner: Claude Code
Reviewer: Codex(PR #1・LINE Bot廃止・設計整合性・検証済み裁定原則移行・複数面カード名サジェスト修正・D-004認証強化の対応案の独立レビューを実施済み)、Claude Code(T007共同環境修正をレビュー済み)

## 引継ぎ(2026-09-04、ユーザー指示によりT008作業を中断)

**中断時点の状態**: T008(`ruling_job.result_json`のジャッジID漏洩残存の移行、詳細は`.ai/tasks/T008-correction-leak-quick-fix.md`)のCodexレビュー19回目を実行し、レビュープロンプトの埋め込み完了までは確認したが、**Codexの回答本文はまだ読んでいない**(出力は`C:\Users\redco\.claude\projects\C--Users-redco-Documents-my-knowledge\12e0adb0-438f-4ed9-9e68-2e7ff023c27e\tool-results\bm30vq07h.txt`に保存済み)。

**完了したこと(round 18まで反映済み、未コミット)**:
- `ruling_job.result_json`の旧title移行を「フィールド値全体が旧title形式と完全一致する場合のみ自動置換」する安全な設計(`buildLegacyTitles`/`migrateLegacyCorrectionTitlesInResultJson`、Set<string>による完全一致比較)に統一
- 上記だけでは自動解決できない「説明文への埋め込みケース」(本番に既知の残存1件あり)を、raw JSON・jobId・ジャッジIDを一切画面へ出さずに復旧する専用スクリプト`src/scripts/repairEmbeddedLegacyCorrectionTitle.ts`(`repairEmbeddedLegacyCorrectionTitles`関数、dry-run→`--apply`の2段階運用)を新設
- `runMigration()`が正常終了時も3種類の監査件数を必ず出力するよう修正
- 廃止済み設計(正規表現ベース)を前提にした古いコメントの整理
- `.ai/tasks/T008-correction-leak-quick-fix.md`のReview History項目18・STATUS.mdへ上記を反映済み

**検証結果**: `npm run typecheck`・`npm test`(49ファイル/367テスト)PASS。実SQLiteでの検証スクリプトでも動作確認済み(検証後は削除済み、実DBへの影響なし確認済み)。`flutter analyze`は今回未実行(バックエンドのみの差分のため)。

**未完了・次の一手**:
1. 上記`bm30vq07h.txt`からCodexレビュー19回目の回答本文を読む(`grep -n "^codex$" -A 60`で抽出する、これまでのラウンドと同じ手順)
2. 指摘があれば対応→`npm run typecheck && npm test`→実SQLite検証→次ラウンドレビュー、のサイクルを継続(AGENTS.mdの「Claude実装→Codex独立レビュー→Claude修正→再確認」を収束するまで繰り返す)
3. 収束したら、未追跡ファイル(`src/scripts/repairEmbeddedLegacyCorrectionTitle.ts`・`tests/repairEmbeddedLegacyCorrectionTitle.script.test.ts`、および他の変更済みファイル一式)をコミットする前に`git status`で確認する
4. コミット後、ユーザーの承認を得てpush・Renderデプロイ
5. デプロイ後、ユーザーがRender Web Shellから`node dist/scripts/migrateCorrectionCredentials.js`→(残存1件があれば)`node dist/scripts/repairEmbeddedLegacyCorrectionTitle.js`(dry-run→`--apply`)の順で実行し、3種類の監査件数がすべて0になることを確認する(詳細手順は`.ai/tasks/T008-correction-leak-quick-fix.md`の「残作業」参照)

**注意事項(Do Not Repeat)**:
- 本番のジャッジID・jobId・result_json生データは、チャット・ファイル・Codexレビュープロンプトのいずれにも一切書き残さない(このタスクで過去に2回、この経路で実際に漏洩した実績がある)
- ジャッジIDを5桁数字などに固定する変更は**却下済み**(`POST /api/login`がジャッジID単独で認証するため、候補数を絞ると総当たり攻撃耐性が大きく下がるとCodexレビューで指摘され撤回した。再提案する場合はT006の認証強化と合わせて検討すること)
- 検証用スクリプトは必ず`DATABASE_URL`をシェル環境変数として渡す(TypeScript/ESMのimport巻き上げにより、スクリプト内で`process.env.DATABASE_URL`を代入しても無効化され、実際のローカル開発用DB`data/cache.db`を汚染する事故が過去に発生している)

## Current Goal

複数の並行課題があり、単一の目標に絞れていない状態。

1. モバイルアプリ(Android/iOS)のストア審査対応
2. 有料化の形態(価格・プラン設計)の見直し検討
3. LINE Bot廃止の残作業(Render環境変数・LINE Developersコンソール側の後始末) — 保留(手動操作)
4. T002 設計整合性の是正 — 実装・ドキュメント面は完了。残る手動操作項目(RevenueCat実機E2E・Renderダッシュボード確認等)は保留(2026-09-02ユーザー判断)
5. ~~T004 複数面カード(サイキック/ドラグハート等)の名前サジェスト漏れ修正~~ → **2026-09-03完了**(`--force`全件再構築・本番動作確認済み)
6. ~~T005 全件クロールから漏れる特殊サブIDカード(DCR/spd等)への対応~~ → **2026-09-03、再調査の結果、対応見送りと判断しClosed**(実害はごく限定的と判明。詳細は`.ai/tasks/T005-missing-special-subid-cards.md`参照)
7. T006 D-004ジャッジ認証強化の対応案 — 方針決定段階でCodex Review 1完了、ユーザー判断待ち(下記Completed/Next参照)

## Completed

- サブスクリプション課金機能(無料枠月10問+月額300円、RevenueCat経由)を実装し `subscription-billing` ブランチとしてPR化(`https://github.com/redcola1030503-svg/dm-ruling-bot/pull/1`)
- Claude Code × Codex 協働環境の初期構築(このファイル一式)
- **iOS App Store配信設定(価格・配信地域)**(2026-09-04): App Store Connectで「価格および配信状況」を設定。基準地域を日本(JPY)、価格を¥0.00(無料)、配信地域を日本のみに設定(ユーザー指示)。反映まで最大24時間
- **T008 訂正機能のジャッジID・セッショントークン漏洩の緊急先行修正**(2026-09-03、コミット`38275ea`、push済み): 認証不要API`GET /api/corrections/:id`のjudgeIdマスク漏れ、`corrected_by`列への生セッショントークン保存を修正。Codexレビュー2回で、裁定結果・利用統計API経由のジャッジID漏洩(`retrieveEvidence.ts`のEvidenceタイトル由来)、過去の裁定結果(`ruling_job.result_json`)への旧title残存も追加発見・修正。`npm run typecheck`・`npm test`(270件)・`flutter analyze`すべてPASS、route挙動はcurlで実機確認。**本番マイグレーション実行完了(2026-09-04)**: ユーザー本人がRender Web Shellから`node dist/scripts/migrateCorrectionCredentials.js`を実行(失効セッション3・移行訂正3・source_reference_stat移行1・ruling_job.result_json移行3)。実行前後をClaude Codeが読み取り専用クエリで検証し、mismatch 3→0・judge_session総数17→14(3件失効)・`source_reference_stat`の旧title残存0件を確認。**この初回修正・初回マイグレーションはここまでで完了**。**残存データの移行(result_jsonの旧title)も2026-09-05に完了しClosed**: 通算3回の残存発覚を経て通常移行を完全一致方式(`buildLegacyTitles`、`Set<string>`)へ収束させ本番デプロイ、既知の残存1件(explanation文中への全角括弧embedded形式)は診断専用スクリプト`findUnresolvedLegacyCorrectionTitleJobIds.js`で特定した上でRender Web Shellから手動UPDATE(CJK入力欠落を`String.fromCharCode`で回避)し解消した。`unresolvedRulingJobResultJsonMarkerCount`・`invalidRulingJobResultJsonCount`は0を達成したが、`possibleKnownIdCollisionRulingJobResultJsonCount`が51件残った(ジャッジID値がルール番号等に偶然一致した可能性が高い)。ジャッジIDは「知っていれば使えるレベルの弱い秘密」でありパスワード相当、漏洩の実害は限定的というユーザーのリスク許容度を踏まえ、51件の個別確認はコストに見合わないと判断し保留のままClosedとした(T006側への引き継ぎ事項として記録、詳細は`.ai/tasks/T008-correction-leak-quick-fix.md`「本番実行結果・完了(round24)」参照)。
- **T008関連: 実ジャッジIDの平文記載インシデント2件・対応完了**(2026-09-04): 上記の残存データ調査を記録する過程で、実際のジャッジIDを誤って平文でタスクファイルへ記載する事故が2回発生した。**1件目**: 単独コミット経由でGitHubへpushしてしまい(Codexレビューで発覚)、伏字修正・push(コミット`45e5516`)、当該IDのDB削除(`judge`テーブル)+Render環境変数`VALID_JUDGE_IDS`からの除外・再デプロイまで完了し、当該IDでのログインは不可能な状態にした(git履歴上のコミット`e48137b`には値が残るが、無効化により実害は無い)。ジャッジID自体の再発行見送りの判断(バグ稼働期間中の漏洩リスク受容)はこの追加インシデントとは別問題で変更なし。**2件目**: このファイル自身に別の実在ジャッジID(1件目除外後にVALID_JUDGE_IDSへ残っていた最後の1件)を平文記載してしまっていた(コミット前に発覚・即座に伏字修正、gitコミット履歴・GitHub公開は一度も無く、Codexレビューへの送信のみ)。ユーザー判断「無効化して」を受け、本番DBから`judge`テーブルの該当行を削除、Render環境変数`VALID_JUDGE_IDS`から除外(結果、VALID_JUDGE_IDSは空に。ユーザーへ明示の上で「空のまま保存・デプロイする」の判断を得て実施)、再デプロイ・"Deploy succeeded"を確認済み。**ログイン機能は正常化済み**: ユーザーが管理者アカウント経由の管理API(`POST /api/judges`)で新しいジャッジを`judge`テーブルへ直接追加。ログイン処理は`VALID_JUDGE_IDS`ではなく`judge`テーブルを直接参照するため、VALID_JUDGE_IDSが空のままでも問題なくログイン可能(本番DBの読み取り専用クエリでjudge件数2件〈admin 1件・judge 1件〉を確認済み)。VALID_JUDGE_IDSへの追加は不要。詳細は`.ai/tasks/T008-correction-leak-quick-fix.md`参照
- **T007 Claude/Codex共同環境の小規模修正(2026-09-03)**: `scripts/codex-review.ps1`で、差分なし時に未追跡パスが0件または1件だとStrictMode下の`.Count`参照が異常終了する問題を、パイプライン全体の配列化で修正。`CLAUDE.md`の古い「重要な実装のみ」レビュー方針を削除し、正本である`AGENTS.md`のReviewセクション参照へ一本化した。Codexが作成・実装し、Claude Codeが変更前・変更後にread-onlyレビュー。詳細は`.ai/tasks/T007-collaboration-environment-hardening.md`参照
- **PR #1をmasterへマージ**(2026-08-31、マージコミット`2f0f22a`)。ローカルmasterをrebase・push済み
- **RevenueCat/Android側の課金セットアップ**(2026-08-31):
  - RevenueCatプロジェクト「デュエマ裁定確認」作成、Entitlement `unlimited_questions`、Offering `default`(Monthlyパッケージ)を設定
  - Google Play Consoleで定期購入 `monthly_plan`(基本プランID `p1m`、¥300/月、日本限定)を作成・有効化
  - RevenueCat側に商品 `monthly_plan:p1m` を作成し、Entitlement・Offeringへ紐付け
  - `mobile_app/lib/billing/revenue_cat_keys.dart` を実際のPublic API Key(Android/iOS両方)に更新
  - バージョン1.7.0+16をビルドし、エミュレータでクラッシュ無し確認後、Play Console内部テストトラックへ公開
  - iOS側は App Store Connect の In-App Purchase Key(Key ID `7ZPG6FCZBW`)を発行しRevenueCatに設定済みだが、サブスクリプション商品自体はApp Store Connect側で未作成
- **iOS側のRevenueCat/App Store Connectサブスクリプション商品設定**(2026-09-01):
  - App Store Connectで既存のサブスクリプショングループ「月額プラン」内に商品を新規作成(製品ID `monthly_plan`、参照名「月額プラン(¥300)」、期間1か月、配信国を日本のみに限定、価格¥300、日本語ローカリゼーション設定)
  - 審査用スクリーンショットが必要と判明(Apple公式のScreenshot specifications: JPEG/PNG・アルファチャンネル無し・実機解像度と厳密一致した寸法のみ受理、640x920等の任意サイズは不可)。Android実機で撮影したペイウォール画面のスクリーンショットを、PowerShellの`System.Drawing.Bitmap`で6.5"ディスプレイ向けの`1284x2778`(24bppRgb、アルファチャンネル無し)へリサイズしてアップロードし解消
  - RevenueCat側にApp Store商品`monthly_plan`を作成、`unlimited_questions` Entitlementへ紐付け、`default`オファリングの`Monthly`パッケージにAndroid/iOS/Test Store全プラットフォームの商品が揃った状態にした
  - App Store Connect側で「審査用に追加」を実行し、ステータスが「審査準備完了」に。ただし「最初の自動更新サブスクリプションは新しいアプリバージョンとともに提出する必要がある」という警告が出ており、実際の審査提出にはCodemagicで新しいiOSビルドを作成しアップロードする作業が別途必要(今回は未実施)
  - **技術メモ(ペイウォール画面のスクリーンショット撮影)**: 無料枠(月10問)を使い切るまで実際に質問を送信する方式は時間・コストがかかりすぎるため、`main.dart`のホーム画面を一時的に`PaywallScreen`に差し替え、`paywall_screen.dart`の`_buildPlanInfo()`もRevenueCatのオファリング取得に依存せずハードコードした表示に一時変更してビルド・撮影し、撮影後は`git checkout --`で完全に元へ戻した(コミットはしていない)。エミュレータ(Google Play非対応システムイメージ)ではRevenueCatのオファリング取得自体が`purchaseNotAllowedError`で失敗するため、この一時変更が必要だった
- **ペイウォール画面のテキスト改善**(2026-09-01、コミット`73d93f1`): 実機での不自然な改行(見出しの「た」が孤立、「App Store / Google Play」が店舗名の途中で分断)をユーザー報告に基づき修正。見出しは文節境界で明示改行、店舗名の括弧書きは改行禁止スペースで1つのまとまりとして扱うように変更。購入ボタンの文言も「購読する」から「アップグレード」表記に変更
- **有料プランの特典を2件追加**(2026-09-01): 「有料版への訴求が弱い」というユーザー課題感を受け、`paywalls`スキルとコードベース実態調査(広告表示箇所・Batch API分岐・履歴上限の有無を確認)に基づき特典案を起案・実装。
  1. **広告非表示**(`mobile_app/lib/widgets/loading_banner_ad.dart`): `LoadingBannerAd`が`SubscriptionProvider.isSubscribed`を見て、購読中は広告を読み込み・表示しない(`initState`でロード自体をスキップ、`build`でも二重に非表示化)。呼び出し元2箇所(`ruling_screen.dart`/`ruling_turn_view.dart`)は無変更
  2. **優先処理(高速回答)**: 従来`RULING_USE_BATCH_API`は全ユーザー一律のグローバル設定だったが、`runRulingJobInBackground`(`src/ruling/rulingJob.ts`)に`useBatchApi`引数を追加し、`src/routes/rulingJobs.ts`側で`access.hasActiveSubscription`(既存の無料枠判定と同じ変数)を見て購読者は常に`false`(通常API、低レイテンシ)を渡すように変更。非購読者は従来通り環境変数の設定に従う
  - 検証: バックエンド`npm test`(477件全パス)・`npm run typecheck`クリーン、`rulingJob.test.ts`に`useBatchApi`分岐の新規テスト3件追加。モバイル`flutter analyze`(mobile_app全体)クリーン。広告非表示の実機視覚確認は、購読状態をエミュレータで実際に作れないため未実施(コードレビュー+静的解析のみ)
  - 検討したが見送った案: 質問履歴・お気に入り上限の拡張(既にほぼ無制限で訴求材料として弱い)、新機能の先行ベータ提供(無料会員の裁定精度をあえて劣後させることになり信頼性に反するため非推奨と判断)
- **v1.7.1+17を両OSに配信完了**(2026-09-01): ペイウォールのテキスト改善・広告非表示特典を含めてバージョンを上げ、両OSまとめてビルド・配信。
  - Android: リリースAPK(x64)をエミュレータへクリーンインストールしFATALなし・プロセス生存を確認後、`flutter build appbundle --release`でAAB(60.8MB)作成。ファイルサイズがfile_uploadツールの10MB上限を超えるため、Play Consoleでのファイル選択のみユーザー本人に依頼し、それ以外(アップロード後の確認・保存して公開)はClaudeが実施。内部テストトラックへ即時公開完了
  - iOS: Codemagicで`ios-release`ワークフローのビルド(#14、コミット`75b12df`)を実行。ビルド・IPAアップロードは成功したが、想定通りPost-processingで輸出コンプライアンス未提出のため失敗(過去と同じパターン)。ビルド17の輸出コンプライアンス情報を提出(標準的な暗号化のみ使用/フランス配信予定なし)して解消し、外部テストグループ「クローズドテスト」の「ビルド」タブからビルド17を追加、テスト内容を日本語で入力して「審査へ提出」まで完了。ステータスは「審査待ち」
  - **How to apply**: 次に両OSの審査状況を聞かれたら、Play Console(内部テストトラック)とApp Store Connect(TestFlight外部テストグループ「クローズドテスト」のビルド一覧)を実際に開いて確認すること(過去の教訓通り、メモリ・STATUS.mdの記述を鵜呑みにしない)
- **能動的なアップグレード導線を追加**(2026-09-01、v1.7.1+17未反映・コード変更のみ): ユーザー依頼「有料版移行画面を作っていつでも有料版移行ができるようにしたい」に対応。従来`PaywallScreen`は無料枠超過(402)時にしか表示されず、実利用データ上ほとんどのユーザーがこの上限に到達しないため露出機会が乏しいという課題があった(Pricing検討セクション参照)。
  - `PaywallScreen`に`triggeredByQuotaLimit`(既定false)を追加。trueの場合のみ「無料枠(月10問)を使い切りました」の導入文を表示し、オプション画面等からの能動的アクセス時は表示しない(未使用ユーザーへの誤解を防止)。既存の2呼び出し元(`ruling_screen.dart`/`ruling_thread_detail_screen.dart`)は`triggeredByQuotaLimit: true`を明示
  - 既に購読中の場合は購入導線ではなく「ご利用中のプラン」表示+「サブスクリプションを管理」ボタン(`SubscriptionProvider.getManagementUrl()`が返す`CustomerInfo.managementURL`を開く)に自動的に切り替わる新規ビュー(`_buildSubscribedView`)を追加。オプション画面の「購読」セクション先頭に、購読状態に応じてラベルが変わるエントリ(未購読「質問し放題プランにアップグレード」/購読中「質問し放題プラン(ご利用中)」)を新設
  - 検証: `flutter analyze`(mobile_app全体)クリーン、`flutter test test/widget_test.dart`は既存の無関係な既知failureのみ(新規リグレッションなし)。エミュレータで両状態(未購読/購読中)を`SubscriptionProvider`の一時的な上書きで再現し視覚確認、確認後は完全に元へ戻した(コミットなし)。確認中に見出しの新規テキストで同様の孤立文字・店舗名分断が発生したため、既存の教訓(明示改行・改行禁止スペース)を同様に適用して解消
  - ~~**未反映**: この変更はv1.7.1+17のビルドには含まれていない~~ → **2026-09-01完了**、v1.7.2+18として配信済み(下記参照)
- **v1.7.2+18を両OSに配信完了**(2026-09-01): 能動的アップグレード導線を含めてバージョンを上げ、v1.7.1+17と同じ手順(Android内部テストトラック即時公開、iOS Codemagicビルド→輸出コンプライアンス提出→クローズドテスト審査提出)で両OSへ配信。Codemagicビルド#15(コミット`a0da73a`)、iOSビルド18のステータスは「審査待ち」。Android v1.7.2(18)は内部テストトラックへ即時公開完了。**iOS版は1.7.1(17)・1.7.2(18)の2件が同時に審査待ちの状態**
- **Android側のService Account Credentials JSON(Google Cloud)を作成・アップロード**(2026-09-01): RevenueCatのGoogle Play自動インポート・Webhook署名検証に必要な設定を完了。
  - Google Cloud Console(プロジェクト`dmrulingbot-aiteacher`)で以下3つのAPIを有効化: Google Play Android Developer API、Google Play Developer Reporting API、Cloud Pub/Sub API(最後の1つはRevenueCat公式ガイドに未記載だったが、アップロード時のエラーメッセージ「Google Cloud Pub/Sub API must first be enabled」で判明)
  - サービスアカウント`revenuecat-play-billing@dmrulingbot-aiteacher.iam.gserviceaccount.com`を作成、ロール「Pub/Sub 編集者」「モニタリング閲覧者」を付与(RevenueCat公式ガイド`https://www.revenuecat.com/docs/service-credentials/creating-play-service-credentials`に準拠)
  - JSON秘密鍵を作成・ダウンロードし、`dm-ruling-bot-secrets/dmrulingbot-aiteacher-c03e5cc40727.json`に保存(リポジトリ外、Git管理対象外)
  - Play Console「ユーザーと権限」で当該サービスアカウントを招待。アカウント権限4つ(アプリ情報の閲覧・一括レポートのダウンロード/売上データ・注文・解約アンケートの回答の閲覧/注文と定期購入の管理/ストアでの表示の管理)を付与
  - **つまずいた点**: アカウント権限のみでは不十分で、RevenueCat側の検証(Debug error)が「Can validate Google Play subscription purchases」で失敗し続けた。詳細ヒントに「Grant this service account app access plus ...」とあり、ユーザー詳細画面の「アプリの権限」タブでアプリ(デュエマ裁定確認アプリ AIティーチャーくん)個別のアクセスも明示的に追加する必要があると判明・対応
  - RevenueCatへJSONファイルをアップロードし保存。当初は「Service account credentials need attention」のまま未解消だったが、**2026-09-02再確認したところ「Valid credentials」に変わっており解消済みと確認**(反映待ちの想定通り)
  - **残作業**: RevenueCatの同じ設定画面下部「Google developer notifications」セクションがまだ未設定(Topic IDの選択欄が空欄)。RevenueCatはリアルタイムのPub/Sub通知連携を強く推奨しているため、後日設定するとよい(Webhook経由の同期自体は動作するため必須ではない)
- **LINE Bot版の廃止・削除**(2026-09-02、ユーザー判断「告知無しで今廃止」): モバイルアプリへの一本化に伴い実施。詳細は`DECISIONS.md`のD-002参照。
  - コード削除: `src/routes/lineWebhook.ts`・`src/line/`(5ファイル)・同期API`src/routes/ruling.ts`(`POST /api/ruling`、モバイル側で未使用のデッドコードだったことを確認済み)・対応テスト2件(`tests/formatRuling.test.ts`・`tests/verifySignature.test.ts`)
  - 依存関係・設定削除: `@line/bot-sdk`(package.json)、`LINE_CHANNEL_SECRET`/`LINE_CHANNEL_ACCESS_TOKEN`(env.ts・render.yaml・.env.example)、`webhookRateLimiter`(rateLimit.ts、`rulingRateLimiter`は`/api/cards/suggest`等で引き続き使用のため残置)
  - モバイル側: 未使用だった`ApiClient.getRuling()`(同期`/api/ruling`呼び出し、UIから未参照のデッドコードと確認)を削除
  - ドキュメント整理: `docs/LINE Bot利用ガイド（完全版/簡易版）.md`削除、`README.md`・`docs/judge-login-setup.md`・`docs/ジャッジID追加手順.md`のLINE前提の記述をモバイルアプリ前提に更新
  - 検証: `npm run typecheck`・`npm test`(469件全パス、削除した2テストファイル分-8件を除き従来通り)・`flutter analyze`(0件)。加えて実際に`npm run dev`でサーバーを起動し、`POST /webhook/line`・`POST /api/ruling`が404、`POST /api/ruling/jobs`が202、`GET /health`が200であることをcurlで実機確認済み(廃止エンドポイントがセキュリティ境界として実際に閉じたことの検証)
  - Codex独立レビューで発見・対応した重大な問題: `docs/ジャッジID追加手順.md`の削除手順が誤っていた(`VALID_JUDGE_IDS`から除外するだけでは`judge`テーブルの行は消えず、パスワード無し認証のジャッジIDが有効なまま残ってしまう)。`getSession`が`judge`テーブルとのJOINでroleを取得する実装(`src/judges/repository.ts`)であることを確認し、「`DELETE /api/judges/:judgeId`でDB削除→`VALID_JUDGE_IDS`からも除外」の正しい2段階手順に修正
  - **残作業**: Render本番環境変数からの`LINE_CHANNEL_SECRET`/`LINE_CHANNEL_ACCESS_TOKEN`削除(ブラウザ操作が必要、未実施)、LINE Developersコンソールでのチャネルの扱い決定(削除/凍結、緊急性は低い)
- **検証済み裁定原則への移行 第1弾(D-006、2026-09-02、T003)**: ルール17(置換効果の決定順)・18(複数ブレイカー能力の宣言)・19(攻撃/ブロック指定の持続)を、システムプロンプト常時ハードコードから出典・適用条件付きのデータ(`src/rules/data/verified-ruling-principles.json`)へ移行。関連するルール概念・キーワードが質問文に含まれる場合のみ`RulingEvidence`へ注入される方式に変更。詳細は`.ai/tasks/T003-verified-ruling-principles-migration.md`参照。
  - 正本データはビルド対象の`src/rules/data/`配下に置く(`/app/data`はRenderの永続ディスクマウント先のため、Git管理の静的データは置けないとCodexレビューで判明。TypeScriptのJSON importでビルド成果物`dist/rules/data/`に自動複製される設計に修正)
  - `retrieveEvidence.ts`の検索条件はカードテキスト由来の概念(`cardDerivedConcepts`)を含めず、質問文由来のルール概念・キーワードのみを使う(Codexレビューで、カードが該当能力を持つだけで無関係な質問にも原則が注入される問題を指摘され修正)
  - `confidence.ts`は原則ヒットを機械的なhigh判定には含めない(トリガーキーワードの単純一致のため過剰マッチのリスクがあり、安全側に倒す設計。D-006の文言もこれに合わせて修正)
  - Codexレビューを2回実施し、P0 1件(上記の永続ディスク問題)・P1 3件(検索漏れ、過剰マッチ、appliesWhenに例外ケースが混在し誤判定を招く不備)・P2 3件(confidenceの矛盾、出典メタデータの喪失、統計APIのsourceType欠落)・P3 1件(DECISIONS.mdのセクション構造崩れ)を検出・全件修正
  - 検証: `npm run typecheck`・`npm test`(41ファイル/248テスト)PASS、ビルド成果物(`dist/`)からの動作確認済み
  - **未着手(次回以降)**: ルール15(キリコ³系、公認ジャッジ再確認が必要)・ルール16(句点区切りの一般化再確認が必要)・ルール20(公式条文/Q&A特定が必要)の移行
- **サイキック/ドラグハート等の複数面カードの名前サジェスト漏れ修正(2026-09-03、T004)**: ユーザー報告「サイキック・ドラグハートが検索サジェストから漏れている」を調査。まず本番`GET /api/cards/suggest`の実データ(サイキック全138件・ドラグハート全66件)を確認したところ体系的な欠落はなく(初回チェックで多発したMISSINGは`publicReadRateLimiter`(1分60リクエスト)への連続アクセスによる429の偽陽性だった)、真因はユーザー指摘の通り別にあった: サイキック等は1枚のカードが`.cardDetail`ブロックを複数(表/裏の面)持つが、`cardParser.ts`は名前を最初の面のみ取得しており、もう一方の面の名前が`card_index`に登録されていなかった。
  - `CardInfo`に`faces: CardFace[]`(面ごとの名前+文明+タイプ+パワー等の属性一式)を追加。`CardNameMatch`に`matchedFace`(実際に入力名と一致した面)を追加し、`retrieveEvidence.ts`が`matchedFace`の属性をEvidenceに使うよう修正(Codexレビュー指摘: 単純に別名を追加しただけだと、裏面名で質問された場合でも表面の文明・パワー等の誤った属性がLLMへ渡ってしまう不具合があった)
  - `card_index_alt_name`テーブル新設、`suggestCardNames`は`card_index`とのUNION+`GROUP BY id`でどちらの面の名前でもヒットし、かつ重複行を返さないようにした
  - `card_index`(主要名)と`card_index_alt_name`(別名)の更新を`upsertCardIndexEntryWithAltNames`でBEGIN/COMMIT/ROLLBACKの単一トランザクションにまとめた(片方だけ更新済みになる不整合を防止)
  - `card_cache`に`faces`列(JSON)を追加、`deriveAlternateNames`共通関数でパース時・キャッシュ復元時の重複除去ロジックを一本化
  - 正本データのスキーマ変更が既存キャッシュ(card_cache 24hTTL・card_index 30日TTL)には反映されないため、`getOfficialCard`/`runCardIndexBuild`/`buildCardIndex.ts`に`--force`オプションを追加(`node dist/scripts/buildCardIndex.js --force`で全件強制再取得。一部失敗時は非ゼロ終了)
  - Codexレビューを2回実施し、P1 1件(裏面名一致時の属性誤り)・P2 4件(トランザクション化、テストが実DB動作を検証していない、サジェストの前方一致重複、`--force`部分失敗の終了コード)・P3 1件(キャッシュ往復でのalternateNames不変条件崩れ)を検出・全件修正
  - 検証: `npm run typecheck`・`npm test`(44ファイル/264テスト)PASS
  - **本番`--force`全件再構築(2026-09-03完了)**: Render Web Shellから`nohup node dist/scripts/buildCardIndex.js --force > /app/data/force_reindex_20260903.log 2>&1 &`をバックグラウンド実行(シェル切断後もプロセス継続を別セッションで確認)。結果: 更新11,650件・スキップ0件・失敗1件(一時的な504/タイムアウト、次回差分更新で自動再試行)、card_index総登録数16,373件。本番`GET /api/cards/suggest`に裏面名で問い合わせ正しくサジェストされることを実機確認済み
  - **副次的な発見(未対応)**: card_index総登録数(16,373件)が実カード数(11,650件)より多い。削除・統合等で現行一覧に無くなった過去のクロール結果が残存している可能性がある(削除ロジックが無いため)。実害は軽微、対応するなら別タスク

## In Progress

- **T017(新規、2026-09-04起票、調査完了・実装済み・Codexレビュー完了)**: ユーザーからスレッド内フォローアップで裁定結論が「0枚→1枚→4枚」と矛盾する形で変化する不具合報告(モルトDREAM×エモーショナル・ハードコアの相互作用)。原因を実データで特定: (1)`threadContext.ts`が前ターンの結論の一文しか引き継がず理由・根拠が失われる (2)`retrieveEvidence.ts`がフォローアップのたびに公式Q&A・総合ルールを独立に再検索しており、質問の言い回しで検索結果が丸ごと変わる(実証済み、3ターンで上位5件の総合ルールが完全に別物だった)。対応: D-006検証済み裁定原則の仕組みを使い、この相互作用を一般化した新原則を追加。`searchVerifiedRulingPrinciples`にカード名の組み合わせ(AND条件、`requiredCardNameGroups`)を検索対象として新設し、質問文が「無視する」等の一般語を使わなくても1ターン目から正しい根拠を拾えるようにした。Codexレビューで、当初案が抱えていた自己矛盾(appliesWhen/doesNotApplyWhenが同じ条件を指し原則が発火しても除外されうる不備)・過剰取得(カード1枚だけでも発火する設計だった)を検出・修正。実データ検証で1ターン目の質問文から新原則が正しく取得されることを確認し、**実際のLLM呼び出し(`produceRuling`)でもターン1から最終結論が正しく「4枚装備可能」に変わることを実機確認済み**(元のターン3の回答より、処理順序への依存まで正しく言及する精緻な回答になった)。副次的にT012の`src/llm/client.ts`(LLM呼び出しタイムアウトがSDK既定の再試行で実質倍増しうる不備)も同レビューで検出・修正。**Codexレビュー2回目**で、`triggerKeywords`に残していた汎用語「無視する」が単独でも(カード名不一致でも)原則を発火させ`hasAnyEvidence`を誤ってtrueにしうる過剰取得だった不備を検出・`triggerKeywords`を空配列化し`requiredCardNameGroups`のAND一致のみに一本化(否定テスト追加)。あわせて、他の未コミット差分と共にレビュープロンプトへ埋め込まれた`.ai/tasks/T008-correction-leak-quick-fix.md`の記述中に**2件目のジャッジID平文記載(実際の値はここには記載しない。T008で1件目のIDを無効化した後にVALID_JUDGE_IDSへ残っていた既存ID)がCodex API呼び出し経由で外部送信されていたことが判明**(コミット前に発覚・即座に伏字修正、gitコミット履歴には一度も含まれず、GitHubへの公開はしていない)。**2件目のIDも無効化済み(2026-09-04、ユーザー判断「無効化して」)**: 対応の結果VALID_JUDGE_IDSは空になったが、ユーザーが管理者アカウント経由の管理APIで新しいジャッジを`judge`テーブルへ直接追加し、ログイン機能は正常化済み(詳細は`.ai/tasks/T008-correction-leak-quick-fix.md`の「2件目のインシデント」参照)。`npm run typecheck`・`npm test`(47ファイル/318テスト)PASS。詳細は`.ai/tasks/T017-thread-followup-evidence-drift.md`・`.ai/tasks/T008-correction-leak-quick-fix.md`参照。未コミット、本番未反映
- **T016(新規、2026-09-04起票、調査完了・Codexレビューで実質的な指摘なし)**: Google Playから届いた「Androidデベロッパーの確認」最終リマインダーメールを受け、パッケージ名(`com.dmrulingbot.aiteacher`、一致確認済み)・Google Play App Signingの利用蓋然性・ローカルkeystore設定・Google Play以外での配布や別署名鍵使用の形跡を調査。コード・署名設定の変更は不要、**Google Play Console上の確認だけ必要**と結論(Play App Signing利用アプリは自動登録対象のため)。詳細・Play Console確認手順は`.ai/tasks/T016-android-developer-verification.md`参照。**Play Console実機での登録ステータス確認はユーザー確認待ち**
- **iOS版v1.7.1(17)・v1.7.2(18)のTestFlightベータ審査は通過済み**(2026-09-04、App Store Connectで実機確認。両ビルドとも「テスト中」ステータス、招待数8・インストール数はそれぞれ2・4)。通過後、実機でプッシュ通知・広告非表示・能動的アップグレード導線が正しく動作するか確認するとよい(「優先処理」特典はT012によりコピーから削除済みのため確認対象から除外)
- **iOS本番App Store公開(正式リリース)の準備はほぼ未着手と判明**(2026-09-04確認)。アプリ全体のステータスは「iOS 1.0 提出準備中」で、TestFlightのベータ審査とは別に、一般公開用の製品ページ(スクリーンショット0/10・プレビュー0/3・概要/プロモーション用テキスト/キーワード未入力・App Review向け情報未確認・審査対象ビルド未選定)がまったく作られていない。価格(無料)・配信地域(日本のみ)はこの日にClaudeが設定済み(ユーザー指示に基づく)。残りはスクリーンショット・説明文の作成、審査ビルドの選定、審査提出
- RevenueCatの「Google developer notifications」(Pub/Subトピック接続)が未設定(上記Completed参照)
- 有料化の形態(価格・プラン設計)の見直し検討(下記「Pricing検討」参照)
- **(保留、2026-09-02ユーザー判断)** LINE Bot廃止の残作業(Render環境変数削除・LINE Developersコンソール側の後始末) — 手動操作が必要なため保留
- **(保留、2026-09-02ユーザー判断)** T002残りの手動操作項目(RevenueCat Restore Behavior確認・購入復元実機E2E・Android Auto Backup実機検証・Renderダッシュボード環境変数確認) — 実装・ドキュメント面は完了、これらのみ保留(`.ai/tasks/T002-design-consistency-remediation.md`参照)
- T003(検証済み裁定原則移行)の第2弾以降: ルール15・16・20の移行(`.ai/tasks/T003-verified-ruling-principles-migration.md`のOut of Scope参照)
- ~~T005: T004で発見したcard_indexの残存4,723件(DCR/spd等の特殊サブIDカード)への対応~~ → **2026-09-03 Closed**。ランダム30件サンプリング調査の結果、複数面カードは約6.7%(推定300件程度)のみで、確認できた実例では同名の代替版が既にサジェストをカバーしており「裏面名で検索しても一切候補が出ない」という直接的な実害の実例は見つからなかった。対応の優先度は非常に低いと判断し見送り(`.ai/tasks/T005-missing-special-subid-cards.md`参照)
- T006: D-004ジャッジ認証強化の対応案(方針決定段階、実装は未着手) — 案A(パスワード追加)/案B(複数ジャッジ合意でhigh昇格制限)/案C(管理者承認ワークフロー)/案D(現状維持+出典表示強化)をドラフトしCodex Review 1完了。当時発見した実装バグ2件(認証不要API`GET /api/corrections/:id`のjudgeIdマスク漏れ、`corrected_by`列への生セッショントークン保存)はT008として先行対応した(上記Completed参照)。**T008は2026-09-05にClosed済み**(`possibleKnownIdCollisionRulingJobResultJsonCount=51`件が未調査のまま保留、T006側への引き継ぎ事項として`.ai/tasks/T008-correction-leak-quick-fix.md`に記録済み)。残るのはA/B/C/Dの方向性についてのユーザー判断、およびT008から引き継いだ既知ID衝突51件・ジャッジID単独認証の見直し要否(`.ai/tasks/T006-judge-auth-hardening-proposal.md`、コミット`5f67dc8`)
- **T009(新規、2026-09-04起票、実装完了・実装後レビュー対応済み、2026-09-05)**: カード名サジェストに同一カード名(「〜輝きは奇跡そのもの〜」)が完全に重複表示される不具合をユーザーが実機で発見。Codex Review 1が公式サイトの公開情報を確認し、原因は現行の異なる2つのカードID(`dm25ex3-002`・`dm25rp3-012`)による正当な同名再録と特定(card_indexの残存レコード清掃が必要という当初仮説は誤りと判明)。モバイル側はidを表示・送信せず名前のみ挿入する仕様のため、サジェストをname単位で重複排除する対応方針で確定(Review 2)。
  - **実装**: `src/cards/cardIndexRepository.ts`の`suggestQuery`のSQLを、内側(id単位集約、T004由来)→外側(name単位集約、T009)→LIMITの二段階構造に変更(代表idは`MIN(id)`、LIMITをname単位集約後に適用することで同名再録がLIMIT枠を専有し他の別名候補を締め出す問題を回避)。`suggestCardNames`は`seenIds`(id単位)を維持したまま`seenNames`(name単位)を追加し両方で重複排除。
  - **実装後レビュー(Review 3)でP1 2件検出・対応**: (1)部分一致の取得件数が`limit`のままだと、前方一致1件が部分一致側で最大2行(id重複・name重複)を除外しうるため候補が不足する不備 → `limit + prefixRows.length`件取得するよう修正。(2)Round2で要求した「LIMIT位置の実動作」の恒久回帰テストが無い不備 → 当初vitest環境(Vite 5.4.21)が`node:sqlite`の静的import解決に対応せず恒久化を断念しかけたが、**Review 4で`createRequire(import.meta.url)`経由の実行時requireでVite静的解析を回避できると指摘され解決**(`tests/cardIndexRepository.sqlite.test.ts`新設、`vi.mock`で本物のin-memory SQLiteを`db`として注入)。
  - `npm run typecheck`・`npm test`(50ファイル/373テスト、実SQLite回帰テスト3件含む)PASS。詳細は`.ai/tasks/T009-duplicate-card-suggestion.md`参照。**コミット`31a4a9d`、push・本番デプロイ済み(2026-09-05)**
- **T010(新規、2026-09-04起票・実装済み)**: 裁定生成が「公式情報を取得できませんでした」等のシステム側都合で失敗した場合でも、無料枠(月10問)が消費されてしまう不具合(ユーザー実機報告、evidence_errorの事例)をユーザーが発見。`evidence_error`/`llm_error`/`needs_clarification`(ユーザー判断「含める」で確定)、および`produceRuling`自体のreject(analyzeQuestion失敗等)の場合に無料枠を返金する方針で実装済み(`finalizeRulingJob`、詳細はT012の実装完了メモ参照)。通知送信失敗は返金対象に含めない(独立したtry/catchで分離)。**実装中に判明した論点**: 処理中ジョブが載ったスレッドを削除した場合の返金も一時追加したが、バックグラウンド処理自体を止められないため悪用経路(意図的な連続作成・即時削除でAPIコストだけ発生)になると判明し取り消した。T010の対象は「システム側都合の失敗」に明確に限定し、ユーザー起因の削除は対象外。詳細は`.ai/tasks/T010-refund-quota-on-answer-failure.md`参照
- ~~T011(2026-09-04起票 → T012に統合され設計変更)~~ → **2026-09-04 Closed**。ユーザーから「裁定生成がかなり長い間止まっている」との報告を受け調査。本番DBに`status='running'`のまま完了しないジョブが2件(約15.5分・約2.4日)見つかった。当初はBatch API固有の問題(`batch_id`がメモリ上のみでプロセス再起動により永久に完了しなくなる)と特定し、`batch_id`永続化・起動時再照合という対応方針をドラフトしたが、T012の検討過程で「通常APIでも同種の再起動問題が起こりうる」ことが判明したため、この限定的な設計は不要になった。T012(A)の汎用孤立ジョブ回収を実装完了したため、本タスクをClose。詳細は`.ai/tasks/T011-orphaned-batch-job-on-restart.md`参照
- **T012(新規、2026-09-04起票・実装済み・Codexコードレビュー完了、Review 8のP1も対応済み)**: ユーザーから「昨日2時頃に同じ質問を2回送信し、昨晩は反応がなかったが朝になって回答が返ってきていた」との報告を受け調査。本番環境変数`RULING_USE_BATCH_API`が`true`に設定されており、該当の2ジョブは実際には42分・86分後に正常完了していた(永久停止ではなくBatch APIの遅いレイテンシが原因)ことが判明。ユーザー判断により「Batch API全廃、常に通常APIで裁定生成する」方針で検討を進めることになった。方針決定段階のCodexレビューを計5回実施し、当初案の重大な誤り(本番ジョブIDの記載漏洩→修正済み、Batch API全廃だけでは孤立ジョブ問題は根本解消しない、環境変数変更は再起動が必要、有料特典「優先処理」の表示との食い違い、T010の冪等性設計不足、LLM単体タイムアウトだけでは実行中/孤立ジョブを区別できない、既存の未完了ジョブが自動返金の対象外になる、モバイル側の`failed`受信時の挙動未確認等)を発見・反映。最終的に(A)汎用的な孤立ジョブ回収(起動時+定期的な再走査で、プロセス内の実行中jobId集合に含まれず経過時間超過のジョブのみを`failed`+返金確定)+ (B)Batch APIコード削除、の2本立てで設計を確定した。**暫定対応(2026-09-04実施済み)**: 恒久対応前の緩和策として、Renderの環境変数`RULING_USE_BATCH_API`を`false`に変更・再デプロイ済み(本番)。**有料特典コピーの扱いもユーザー判断により確定・反映済み**: 「優先処理(高速回答)」の文言を`paywall_screen.dart`・`settings_screen.dart`・`docs/mobile-app-privacy-policy.html`の3箇所から削除。
  - **実装完了(2026-09-04、ユーザー「自己判断できる課題を進めて」指示)**: (A)`src/ruling/orphanedJobSweep.ts`新設(起動時+5分間隔でstatus IN ('pending','running')のジョブを走査し、経過時間超過のもののみ`finalizeRulingJob`で`failed`+返金確定)。(B)`src/llm/client.ts`から`completeJsonViaBatch`・`BATCH_POLL_INTERVAL_MS`等を全削除し、`messages.create`に`timeout: 3分`を明示。`RULING_USE_BATCH_API`(env.ts)・`useBatchApi`引数(rulingJob.ts/produceRuling.ts/generateRuling.ts/routes/rulingJobs.ts)を全経路から削除。T010(返金)は`ruling_job`へ`usage_month_key`/`refunded_at`列を追加し、`finalizeRulingJob`(原子的な状態遷移によるUPDATE...WHERE status IN (...)の更新件数で二重確定・二重返金を防止)として実装。Codexコードレビューで実装後に新規P1 3件(孤立ジョブ回収の未捕捉例外・カード一覧欠落確定条件の甘さ・スレッド削除時返金の悪用リスク)を検出、全件修正(詳細は各タスクファイルのReview History参照)。ローカルdevサーバーで実機確認済み(通常完了時は返金なし・処理中スレッド即時削除は返金なしのまま・1時間前作成の疑似孤立ジョブは孤立ジョブ回収スイープで`failed`+返金を確認)。**本番デプロイは未実施**(2026-09-01作成の孤立ジョブ1件は本番デプロイ後に自動回収される見込み)。
  - **実装中ジョブ判定をDBベースのworker_id/heartbeatリース方式へ変更完了(2026-09-04、Review 8のP1対応)**: 当初はプロセス内メモリの`runningJobIds`集合で判定していたが、デプロイ時の新旧プロセス並存に対応できない不備が判明したため、`ruling_job`テーブルへ`worker_id`・`heartbeat_at`列を追加し、running判定をheartbeat_atの鮮度(5分)で行う設計に変更。実装後のCodexレビューでさらにP1 2件(初回デプロイ時に旧プロセス由来の行を即座に誤回収する不備、heartbeat確認と失敗確定が原子的でないTOCTOU競合)を検出、両方とも修正済み(孤立回収専用の`finalizeOrphanedRulingJob`をUPDATE文自体に鮮度条件を埋め込む形で新設。詳細は`.ai/tasks/T012-remove-batch-api.md`のReview 9参照)。`npm run typecheck`・`npm test`(47ファイル/326テスト)PASSに加え、実際のSQLite(node:sqlite)に対する検証スクリプトでも6パターン確認済み。

- **T013(2026-09-04起票、実装・全レビュー・実機確認完了、2026-09-05)**: ユーザー依頼「無償版の場合バナー広告は常に表示に変更、変更箇所は『長押しでカード名を入力』と『質問する』の間」。**コミット`a6d2ab2`(2026-09-04、Review 1〜3対応版)は既にmaster/originにpush済み**だったが、STATUS.mdの更新漏れにより「未コミット」と誤記されていたことが判明・訂正。
  - **追加実装(2026-09-05、ユーザー確認への回答を反映)**: スレッド内追加質問欄(`ruling_thread_detail_screen.dart`)にも同様の常時表示化を適用(ユーザー判断)。`RulingJobDetailScreen`(入力欄の無い履歴詳細画面)は現状維持(処理中のみ表示、ユーザー判断)。`RulingTurnView`に`showLoadingBannerAd`プロパティを追加し画面間の二重表示を回避。
  - **Review 4〜7で計4件のP1を検出・全件反映**: (1)購読へ切り替わった際`BannerAd`がdisposeされない、(2)購読解除後に広告が再生成されない、(3)世代管理(`_loadGeneration`)が`onAdLoaded`にしか無く`onAdFailedToLoad`に無い、(4)`LoadingBannerAd`の余白内包化(`verticalMargin`)で、購読中は広告由来の余白だけでなく元々のフォーム間隔まで消えてしまう不備 → `collapsedHeight`パラメータを追加し区別。Review 7で「重大な問題なし」。
  - **実機確認(2026-09-05、Androidエミュレータ)**: `ruling_screen.dart`・`ruling_thread_detail_screen.dart`の両方で、常時テスト広告表示・レイアウト崩れ無しを確認。購読中の挙動はエミュレータの既知の制約(RevenueCatの`Billing is not available`)により視覚確認できず、コードレビューでの確認に留まる。
  - `flutter analyze` 0 issues。詳細は`.ai/tasks/T013-free-tier-ad-always-visible.md`参照。**コミット`64f7fdf`、push済み(2026-09-05)。次バージョンとしてのストア配信は別途判断待ち**
- **T014(新規、2026-09-04起票、Codexレビュー3回実施・P1全件対応済み)**: ユーザー依頼「カードインデックス管理機能のCodexレビュー」。対象(`src/routes/cards.ts`の管理者API3件・`cardIndexBuildJob.ts`・`cardIndexCrawler.ts`・`cardIndexRepository.ts`・モバイル管理画面`card_index_screen.dart`)は2026-08-12実装、共同レビュー体制の標準化(2026-09-02)より前のため一度もレビューを受けていなかったと判明。Review 1でP0なし・P1 3件(「全件再構築」が実際には差分更新のまま`forceRefresh`を渡していない、更新検知の記録が再構築成功前に確定してしまう、不完全な一覧クロールを正常完了扱いにする)・P2 4件・P3 1件を検出、ユーザー「進めて」指示によりAuto ModeでP1 3件に対応。Review 2でP1 2件(部分失敗を成功扱いにしていた/判定基準がDB残存行数を含み実態に合わない)を追加検出し反映。Review 3(Review 2対応の再レビュー)でさらにP1 2件(同一ページ再送を1回の非進展で終端と誤認する経路が残存→連続2回の非進展確認に統一+直前取得の最新総数を比較基準に優先使用/`onSettled`フックの例外が正常完了を失敗へ反転させる→try/catchで隔離)を検出し反映。P2 4件・P3 1件は未対応(優先度が上がった際の別作業)。`npm run typecheck`・`npm test`(45ファイル/282テスト)・`flutter analyze`すべてPASS。詳細は`.ai/tasks/T014-card-index-management-codex-review.md`参照。実機での管理者API動作確認は未実施
- **T015(新規、2026-09-04起票・調査完了→Codexレビューで誤りを指摘され訂正済み)**: ユーザー依頼「総合ルール、Q&A、ルール変更の最新を取得する機能は搭載されているか確認」。初版では「3種とも新規項目の自動発見なし」と結論づけたが、T013レビュー時に「Q&Aは実際は質問のたびにライブ検索しており新規記事は即座に見つかる」という誤りを指摘され再調査した結果、総合ルール・ルール変更も含め「記事単位」ではなく「アーカイブ全体単位」のTTL(総合ルール7日・ルール変更一覧24時間)で、関連する質問が来た際に全体を自動再クロール・差分反映する設計と判明。**訂正後の結論**: 3種とも何らかの形で自動的に新規項目が反映されるが、トリガーは「関連する質問が来ること」に依存する受動的な仕組み。ユーザーの質問を待たずに能動的に確認できるのはカードインデックスの`POST /api/cards/reindex/check`だけ、というのが正確な違い。詳細は`.ai/tasks/T015-rules-qa-autorefresh-investigation.md`参照。対応要否はユーザー判断待ち
- **T012関連の追加指摘(Review 3、2026-09-04)**: T013レビュー時、T012の(A)汎用孤立ジョブ回収の設計にも指摘: 「作成から30分」経過だけを根拠にした確定は、孤立ジョブ(プロセス死亡)と単に遅いだけの正常なジョブを区別できず、後者を誤確定すると裏でAPIコストを浪費した末に結果が捨てられる。対策として`src/llm/client.ts`のLLM呼び出しに明示的なタイムアウト(案2〜3分)を追加する設計をT012に反映済み(`httpClient.ts`は既に10秒タイムアウト設定済みで対応不要)。詳細は`.ai/tasks/T012-remove-batch-api.md`のReview 3参照
- **T012関連の追加指摘(Review 4、2026-09-04)**: T014のP1修正差分レビュー時、Review 3のLLM単体タイムアウト案だけでは`produceRuling`全体(質問解析・複数回の外部取得・リトライ合算)が30分を超えないことまでは保証できないと再指摘。単一インスタンス構成(Render `plan: starter`)を前提に、プロセス内メモリで「現在このプロセスが処理中のjobId集合」を管理し、定期走査はこの集合に含まれないジョブのみを孤立ジョブとして確定する設計に変更してT012へ反映(LLM呼び出しタイムアウトは外部APIコスト上限の二次的安全策として維持)。加えて、T010が新設する`usage_month_key`列はデプロイ後に作成されたジョブにしか記録されないため、既存の未完了ジョブ(孤立ジョブX等)は回収処理で`failed`確定はされても自動返金の対象外になる点も判明し、個別確認・手動返金する方針をT010/T012双方に追記。詳細は`.ai/tasks/T012-remove-batch-api.md`のReview 4、`.ai/tasks/T010-refund-quota-on-answer-failure.md`のReview 3参照
- **T012関連の追加指摘(Review 8、2026-09-04、T017実装レビューに同梱)**: **P1、対応済み**: プロセス内メモリの`runningJobIds`ではデプロイ時の新旧プロセス並存を防げない。新プロセスは起動直後の孤立ジョブ回収で自分の`runningJobIds`しか見えないため、旧プロセスがまだ正常処理中のジョブを誤って孤立扱いし`failed`+返金確定してしまう可能性がある(単一プロセスが再起動を挟まず稼働し続ける前提が、Renderのローリングデプロイでは成り立たない)。→ **2026-09-04、DB上に`worker_id`/`heartbeat_at`のリース情報を持たせる設計に変更・実装完了(詳細は`.ai/tasks/T012-remove-batch-api.md`のReview 9参照)**。あわせてT010の`finalizeRulingJob`の`outcomeStatus: string`型が緩すぎる(将来の新正常系ステータス追加時に誤って自動返金対象になりうる)というP2も検出、`ProduceRulingOutcome["status"]`型への絞り込みを次回対応として記録(未実装、実害無し)。詳細は`.ai/tasks/T012-remove-batch-api.md`のReview 8・Review 9、`.ai/tasks/T010-refund-quota-on-answer-failure.md`のReview 6参照

## Decided (このセッション)

- 残るP1(無料枠上限判定の原子性)とP2(ジョブ失敗時のスレッドロールバック)は今回のPRのスコープ外とし、`actions/dm-ruling-bot_残作業リスト.md`(Vault側)へfollow-upとして切り出した(2026-08-31、ユーザー判断)。理由: 現状のRender starterプラン(単一インスタンス)かつハンドラー内に`await`が無いため実害が低いと判断
- PR #1はマージ判断へ進んでよい状態
- **今後の開発は原則として共同体制(Claude実装→Codex独立レビュー→Claude修正→再検証)で行う**(2026-09-02、ユーザー方針)。従来「重要な変更のときだけ」だった`AGENTS.md`のReviewセクションを、これを標準の流れとする内容へ更新済み。レビューは`scripts/codex-review.ps1`を使う
- LINE Bot版は告知無しで即時廃止する(2026-09-02、ユーザー最終判断。詳細は`DECISIONS.md`のD-002参照)
- 公認ジャッジによる訂正は、本プロジェクト上の「公式参考情報」として扱う。タカラトミー公開物である「公式一次情報」と用語を区別するが、論点が明確に一致する場合は直接の裁定根拠・`high` confidenceの材料にできる(2026-09-02、ユーザー判断。詳細は`DECISIONS.md`のD-004参照)
- Androidの`deviceId`は永続的な端末/ユーザーIDではなくインストール単位IDとして扱う。アプリデータ削除・再インストールによる無料枠リセットは既知の限界として受容し、購入復元はRevenueCatの`Transfer to new App User ID`と`restorePurchases()`へ分離する案Aを採用する(2026-09-02、ユーザー判断。詳細は`DECISIONS.md`のD-005参照)
- 個別裁定知識のハードコードを「検証済み裁定原則」データへ段階的に移行する。出典・適用条件・確認日を持つデータへ移し、関連する質問にのみ取得・注入する。原則ヒットは機械的confidence推定でhighへ自動昇格させない(2026-09-02、ユーザー判断・提案採用。詳細は`DECISIONS.md`のD-006参照)
- Codexがユーザーの明示指示に基づいてプロジェクトファイルを更新する場合、Claudeへのレビュー依頼・引き継ぎの冒頭で、ユーザー指示による更新であること・指示の要旨・対象ファイルを明記する(2026-09-03、ユーザー方針)。由来の明記は独立レビューを免除しない。正本は`AGENTS.md`のReviewセクション

## Blocked

- なし

## Verification

**T007 Claude/Codex共同環境の小規模修正(2026-09-03)**:
- Claude Code変更前レビュー: P0なし。P1 1件(PS7再現性の実機確認)、P2 2件(未追跡1件ケース追加・`CLAUDE.md`は正本参照のみにする)、P3 2件を反映
- Claude Code変更後レビュー: コード修正と`CLAUDE.md`修正は「重大な問題なし」。P1の`STATUS.md`更新、P2のT007完了記録を反映後、最終再レビューでP0/P1/P2/P3すべてなし・マージ可能を確認
- PowerShell 7.6.4 / Windows PowerShell 5.1.26100.9168: 空差分は警告を表示して終了コード0、差分なし・未追跡1件はCodexスタブ呼び出しまで進んで終了コード0
- PowerShell 7/5.1の構文解析: PASS
- `scripts/codex-review.ps1`のUTF-8 BOM維持: 確認済み
- `git diff --check`: PASS(LF→CRLFの作業ツリー警告のみ)
- アプリ本体の変更がないため`npm run typecheck`・`npm test`・`flutter analyze`は対象外

**T004 複数面カード名サジェスト漏れ修正(2026-09-03、コミット`e3323fb`、master/originにpush・本番反映済み)**:
- `npm run typecheck`: PASS
- `npm test`: PASS(44ファイル/264テスト)
- Codexレビュー2回実施し全指摘(P1 1件・P2 4件・P3 1件)に対応(詳細は`.ai/tasks/T004-multi-face-card-name-suggest-fix.md`のReview History参照)
- 本番`--force`全件強制再構築: Render Web Shellから実行完了(更新11,650件・失敗1件・card_index総登録数16,373件)。本番`GET /api/cards/suggest`で裏面名によるサジェストを実機確認済み

**T003 検証済み裁定原則移行 第1弾(2026-09-02、コミット前、HEAD時点)**:
- `npm run typecheck`: PASS
- `npm test`: PASS(41ファイル/248テスト)
- `npm run build`後、`dist/rules/data/verified-ruling-principles.json`が生成されビルド成果物から`searchVerifiedRulingPrinciples`が正しく動作することを`node -e`で確認済み
- Codexレビュー2回実施し全指摘に対応(詳細は`.ai/tasks/T003-verified-ruling-principles-migration.md`のReview History参照)

**T002 課金設計書・実装計画・プライバシー資料の整合(2026-09-02、未コミット、HEAD時点)**:
- `npm run typecheck`: PASS
- `npm test`: PASS(232件、変更なし)
- `rg -n "ruling_job|device_monthly_usage" docs/superpowers DECISIONS.md`: 旧方式への言及は却下済み/履歴の文脈のみと確認
- `rg -n "RevenueCat" docs/mobile-app-privacy-policy.html mobile_app/store_listing/data_safety_and_checklist.md`: 追記を確認
- 変更: 課金設計書(`docs/superpowers/specs/2026-08-30-subscription-monetization-design.md`)をD-003/D-005へ全面更新、旧実装計画2件に`Historical`警告を追加、プライバシーポリシー・Data SafetyへRevenueCat/購読データの記載を追加
- Codexレビュー2回実施。1回目でP1 3件(RevenueCat Restore Behavior未確認事項の断定表記、iOS/Androidを区別しないdeviceId再インストール挙動の断定、プライバシーポリシーのdeviceId取得タイミングの誤り「初回質問送信時」→実際は`main.dart`のアプリ起動時)・P2 3件(RevenueCatへ質問文が送られるように読める導入文、購読中AdMob送信なしの過大な断定、「今後の宿題」とT002完了チェックの矛盾)を指摘、全件修正して解消

**T002 P1(deviceIdメモリキャッシュ・Auto Backup除外・render.yaml環境変数)+P2/P3(2026-09-02、コミット`6d749e3`、master/originにpush済み)**:
- `npm run typecheck`: PASS
- `npm test`: PASS(`vitest.config.ts`新設により`.worktrees/**`除外、ルート単体40ファイル/232テスト。以前の「82ファイル/469テスト」は`.worktrees/subscription-billing`分を含んでいた誤った集計だったと判明)
- `cd mobile_app && flutter test test/device_id_test.dart`: PASS(6/6、読込失敗・書込失敗・同一/別インスタンスでの並行呼出しの各ケース。Codexレビュー2回で「別インスタンス間のID不一致」「読込失敗時の既存ID誤上書き」を指摘され、`DeviceIdProvider`のキャッシュをstatic化・書込条件を修正して解消)
- `cd mobile_app && flutter analyze`: PASS(0 issues)
- `cd mobile_app && flutter build apk --debug`: 成功(AndroidManifest.xml・新設backup rulesの構文確認を兼ねる。実際のバックアップ除外動作の実機検証は未実施)

**LINE Bot廃止後(2026-09-02、コミット`9ee9601`、master/originにpush済み)**:
- `npm run typecheck`: PASS
- `npm test`: PASS(469/469。廃止前477件から、削除した`formatRuling.test.ts`4件・`verifySignature.test.ts`4件の-8件。**注記**: この469件という数字は`.worktrees/subscription-billing`配下のテストが混入した誤った集計だった。上記T002対応後の正しいルート単体件数は232件)
- `cd mobile_app && flutter analyze`: PASS(0 issues。未使用の`getRuling()`削除に伴う未使用import`ruling_result.dart`も検出・修正済み)
- 実機確認(`npm run dev`起動後にcurl): `POST /webhook/line`→404、`POST /api/ruling`→404、`POST /api/ruling/jobs`→202、`GET /health`→200

PR #1、修正反映後(subscription-billingブランチ、コミット`fdae217`/`d018dd4`、参考・過去の記録):
- `npm test`: PASS(237/237、修正前227から+10)
- `npm run typecheck`: PASS
- `flutter analyze`: 未実施(モバイル側は今回変更していない)
- モバイル `flutter test test/widget_test.dart`: FAIL(この機能と無関係のmaster由来の既知の問題、未変更)

## Reviewer Findings

**開発方針・設計・実装の横断レビュー(2026-09-02)**: Codexが関連資料・バックエンド・Flutter・Render・プライバシー/ストア資料を突合し、当初P1 5領域、P2 3領域、P3 1領域の齟齬を確認した。Claude実装→Codex再レビューで対応する共同残タスクを`.ai/tasks/T002-design-consistency-remediation.md`、根拠を`.ai/reviews/2026-09-02-design-consistency-review.md`へ記録した。P1のうちジャッジ訂正の信頼階層はD-004で解消済み。Android deviceIdはD-005でインストール単位IDとする方針を決定し、メモリキャッシュ・Auto Backup除外・RevenueCat購入復元E2Eが実装待ち。D-003と逆の課金資料は「現行specをD-003へ更新し、旧planはHistorical/Partially supersededの警告付き履歴として保持する」方針をClaudeへ共有済み。ほかの最優先は、RevenueCatのプライバシー/Data Safety記載漏れ、Render Blueprintの課金環境変数不足。

**個別裁定ハードコードの改善提案(2026-09-02、採用判断待ち)**: ルール15〜20を単純削除せず、出典・適用/除外条件・確認日・正例/負例を持つ「検証済み裁定原則」へ移し、関連質問にだけ検索・注入する案をClaudeへ共有した。旧プロンプトと新方式を一時併用し、検索評価と回答評価を通した原則から1件ずつ移行する。詳細は`.ai/reviews/2026-09-02-ruling-knowledge-migration-proposal.md`、追跡はT002参照。

**LINE Bot廃止の独立レビュー(2026-09-02)**: 共同タスクを`.ai/tasks/T001-line-bot-removal.md`、追跡用レビューサマリーを`.ai/reviews/2026-09-02-line-bot-removal.md`へ保存した。CodexのP1指摘を修正し、P2は手動検証後にfollow-up化。P1はジャッジ削除手順のセキュリティ不備、P2は廃止エンドポイントの404を保証する自動統合テスト不足。

Codexによる独立レビューを2回実施。

**1回目(2026-08-31、`.ai/reviews/2026-08-31-pr1-subscription-billing.md`)**: マージ非推奨、P0 1件・P1 4件・P2 1件。

**対応(コミット`fdae217`/`d018dd4`)**:
- P0: `deviceId`必須化(`src/routes/rulingJobsSchema.ts`新設)。モバイルアプリは既にdeviceIdを常に送信済みのため実質影響なし
- P1: 購読中は無料枠を消費しない(`accessControl.ts`に`hasActiveSubscription`追加)
- P1: 遅延`EXPIRATION`/`REFUND`はRevenueCat REST APIから再取得してから反映(`revenueCatEventPolicy.ts`, `billing.ts`)
- P1: ジョブ作成とカウンタ加算をトランザクション化(`billing/billingTransaction.ts`新設)

**2回目(2026-08-31、`.ai/reviews/2026-08-31-pr1-subscription-billing-round2.md`)**: 上記3件は解消確認。残課題:

- **P1(未解消)**: 無料枠の上限判定(`getMonthlyUsageCount`/`evaluateRulingAccess`)がトランザクション開始前に行われており、上限直前の並行リクエストで枠超過があり得る。**ただし現在の本番構成(Render `plan: starter`、単一インスタンス)かつハンドラー内に`await`が無い(同期SQLite呼び出しのみ)ため、実際には他リクエストが割り込む余地が無く、今この瞬間の実害は無いと考えられる(将来インスタンスを複数に増やす場合は要対応)**
- **P2(新規)**: ジョブ作成失敗時、先に作成/更新したスレッド(`createThread`/`touchThread`)がロールバックされず残る。課金回避にはならないが、失敗時に空スレッドが残るUXの不整合
- P1: 課金ルートの統合テストが不足(未対応、予定どおりスコープ外)
- P2: Webhookとアプリ同期が同一IPレート制限枠を共有(未対応、予定どおりスコープ外)

**注記**: このレビューはWindows環境で`--sandbox read-only`がローカルのgit/ファイル読み取りコマンド自体を全面拒否したため、diffとAGENTS.md/STATUS.md/DECISIONS.mdをプロンプトへ直接埋め込む方式で実施した(`scripts/codex-review.ps1`そのままでは動作しなかった)。

**`scripts/codex-review.ps1`のWindows不具合を恒久修正(2026-08-31、コミット`d5ccfe9`)**: 上記の注記どおり、Codexに「自分でgit diff/ファイルを読ませる」設計だとWindowsのread-onlyサンドボックスがgit実行自体を拒否し使用不能だった。恒久対応として、スクリプト側でdiff・AGENTS.md・STATUS.md・DECISIONS.md・タスクファイルを取得しプロンプトへ直接埋め込む方式に変更(read-onlyサンドボックス自体は防御多層化として維持)。

実装中に**新たに4件の実機バグ**を発見・修正した(いずれも本番投入前に発覚、コード変更なしでは気づけなかった):
1. **BOM無しUTF-8ファイルの文字化け**: Windows PowerShell 5.1の`Get-Content`(および`.ps1`スクリプト自体の読み込み)は、BOM無しUTF-8ファイルを既定でシステムのANSIコードページ(Shift-JIS)として誤読する。スクリプト自体にBOMを再付与し、`Get-Content -Raw -Encoding UTF8`を明示することで解消(元のスクリプトファイルは実はBOM付きだったが、編集時に一度失われていたことも判明)
2. **ネイティブコマンド引数渡しの破損**: `codex exec --sandbox read-only $prompt`のように長大な文字列を引数で渡すと、diff内のダブルクォートでコマンドライン境界が壊れ`error: unexpected argument 'git' found`になった。標準入力へパイプする方式(`$prompt | codex exec ...`、codex CLIは`PROMPT`省略時にstdinを読む仕様)に変更して解消
3. **stdinパイプ時のコンソールエンコーディング依存**: 上記2の修正後も、呼び出し元シェルのコンソールエンコーディングが既定(非UTF-8)だと日本語プロンプトが文字化けした。スクリプト冒頭で`[Console]::OutputEncoding`等をBOM無しUTF8に強制することで解消
4. **`git diff`出力の改行喪失**: PowerShellではネイティブコマンドの複数行出力が文字列配列になるため、`"...$diff..."`のような文字列展開時に既定の`$OFS`(半角スペース)で連結され改行が失われ、diffがほぼ1行に潰れていた(Codexの1回目レビューで実際に指摘・確認)。`@(git diff ...) -join "`n"`で明示的に改行結合して解消

その後、**新方式のスクリプト自体をCodexに複数回レビューさせ**(このスクリプトが動くようになって初めて可能になった)、追加で修正した:
- 未追跡ファイルが`git diff`にもレビュー対象にも含まれず「差分が空」判定で漏れる問題→ `git status --porcelain`から収集して埋め込み
- diff内容に3連バッククォートが含まれると固定のMarkdownフェンスが壊れる問題 → 内容中の最長連続バッククォートより長いフェンスを動的生成
- **(重要度高)未追跡ファイルを無条件に外部API(Codex)へ送信すると、`.gitignore`未登録の秘密鍵・認証情報等が漏えいしうる**(このリポジトリは過去に実際に`.p8`ファイルの誤配置事故があった)→ 秘密情報系拡張子(`.p8`/`.p12`/`.jks`/`.pem`/`.key`/`.keystore`/`.env`)・200KB超・バイナリのファイルは内容を送らずパスのみ記載するガードを追加
- `Test-Path`/`Get-Content`が`[`・`]`等を含むファイル名をワイルドカードとして誤解釈しうる問題 → `-LiteralPath`に統一

**検証**: 実機(Windows PowerShell 5.1、`pwsh`は未インストール環境)で計6回、実際に`codex exec`を呼ぶエンドツーエンド実行を行い、都度出力を確認しながら反復修正。最終版は日本語プロンプトの文字化けなし・diffの改行保持・sandboxエラー再発なしで正常にレビュー結果を受け取れることを確認済み。

**残課題(P1/P2、対応せず、`actions/dm-ruling-bot_残作業リスト.md`側に追記予定)**:
- `-Base`指定時、コミット済み差分(`$Base...HEAD`)のみが対象で作業ツリーの未コミット変更が含まれない(通常の無引数実行では`git diff HEAD`で両方含むため影響は`-Base`使用時のみ)
- `git status --porcelain`は既定で未追跡ディレクトリを1エントリにまとめるため、新規ディレクトリ配下のファイル群がレビューから漏れる(`--untracked-files=all`への変更が必要)
- `.ai/tasks/T*.md`を対象タスクに関わらず無条件に全件埋め込む(現時点ではタスクファイルが1件も無いため実害なし)
- 新しい分岐(未追跡ファイル処理・フェンス生成・エンコーディング)への自動テストが無い(手動のエンドツーエンド実行のみで検証)

**教訓**: (1) Windows PowerShell 5.1では、BOM無しUTF-8ファイルの読み込み・書き込み・ネイティブプロセスへのパイプ送信のすべてで、明示的にUTF-8を指定しない限り文字化けしうる(Vault側の[[feedback_vault_encoding_pitfall|同種の罠]]がスクリプト読み込みでも再発した)。(2) ネイティブコマンドへ長大・任意内容の文字列を渡す際は、引数ではなく標準入力を使う方が引用符起因の破損を避けられる。(3) レビューツール自体が動くようになって初めて、そのツールで自分自身をレビューさせるという検証ループが回せるようになった(それまでは`--sandbox read-only`のエラーで毎回落ちていた)。(4) 外部LLM APIへ「差分に関連する周辺ファイル」を自動収集して送る設計は、意図せず秘密情報を含むファイルまで拾ってしまうリスクがあるため、拡張子・サイズ・バイナリ判定によるガードが必須。

## Pricing検討(2026-08-31、marketing:pricingスキルで分析)

現行の「無料枠月10問+月額300円・単一プラン・使い放題」について、原価とのミスマッチを指摘。

- Claude API原価は1質問あたり約6〜11円(Batch API適用のモバイル経由でも約2.2〜5.4円)に対し、月額300円は損益分岐点が月43問程度(保守的試算)。使い放題プランに月間上限が無いため、ヘビーユーザー1人で赤字になりうる
- Freemiumの前提(無料ユーザーの限界費用が低いこと)を満たしていない
- 「$10/月」個人向けバケットの中でも300円(≒$2)は安すぎる側("$9トラップ": 安すぎる価格は偽の需要を生み後から値上げしづらい)
- 有料化しても広告(AdMobバナー)が消えない、能動的なアップグレード導線もない、という訴求面の弱さも判明済み

**検討した改善案**:
- 案A(最小変更): 価格を¥980程度に引き上げ+広告非表示を有料特典に追加
- 案B(構造変更): Value Metricを「質問数」に合わせた上限付き複数プラン or クレジット制へ移行(例: ライト¥300/月=50問、ヘビー¥980/月=300問)
- 案C(データファースト、**これを選択・実施済み**): `device_monthly_usage`/`ruling_job`の実データで実際の質問数分布を確認してから案A/Bを決める

**実データ分析結果(2026-08-31実施、Render Web Shell経由)**:

`llm_usage`はテーブルではなくログイベント(DB上には存在しない)と判明。代わりに`ruling_job`テーブル(2026-08-19〜08-31の12日間、48台・127ジョブ、device_id別集計)を分析。

| 質問数(累計12日間) | 端末数 |
|---:|---:|
| 1問 | 26台(54%) |
| 2〜5問 | 17台(35%) |
| 6〜10問 | 3台 |
| 11〜30問 | 2台(最大14問) |
| 31問以上 | 0台 |

最もヘビーな端末でも12日間で14問(30日換算で約35問/月)。この水準ならBatch API適用時(2.2〜5.4円/問)は235円未満、保守的単価(7円/問)でも245円で¥300を下回り黒字。最悪ケース(複雑な質問ばかり・11円/問)でようやく385円と¥300をわずかに超える程度。

**結論**: 当初懸念した「ヘビーユーザーで即座に赤字化する」リスクは、少なくとも現在の実利用パターン(48台のベータテスター)では顕在化していない。TCGの裁定確認は対戦中に迷った時だけ聞く性質上、そもそも高頻度利用になりにくいと考えられる。

**留保点**:
- サンプルが小さい(48台)。外れ値のヘビーユーザーが未出現の可能性
- 無料ベータテスターのデータであり、実際の課金後の利用行動は変わりうる(逆選択のリスク)
- 構造的な上限は依然として無い(1問=数円のコストが理論上は青天井、悪意ある高頻度利用やbotへの備えとしては弱い)

**更新した推奨**: 案B(上限付きプラン化)は緊急性が下がったと判断。案Aは原価リスクというより価格心理("$9トラップ")・収益バッファ確保の観点で引き続き検討価値あり。正式公開後、実際の課金ユーザーの利用データで再検証する。

## Next

1. ~~**T002 設計整合性の是正**をClaudeが実装し、Codexが独立再レビューする~~ → **2026-09-02、実装・ドキュメント面は完了**。優先順・受入条件は`.ai/tasks/T002-design-consistency-remediation.md`、根拠は`.ai/reviews/2026-09-02-design-consistency-review.md`参照。残る手動操作項目(RevenueCat実機E2E・Renderダッシュボード確認等)はユーザー判断により保留
1b. ~~**T003 検証済み裁定原則移行 第1弾**(ルール17・18・19)をClaudeが実装し、Codexが独立再レビューする~~ → **2026-09-02完了**。詳細は`.ai/tasks/T003-verified-ruling-principles-migration.md`参照。次回以降、ルール15・16・20の移行が残っている(それぞれ公認ジャッジ再確認・一般化再確認・公式条文特定が前提)
1c. ~~**T004 複数面カード名サジェスト漏れ修正**をClaudeが実装し、Codexが独立再レビューする~~ → **2026-09-03完了**(実装・レビュー対応・本番`--force`全件再構築・動作確認まで完了)。詳細は`.ai/tasks/T004-multi-face-card-name-suggest-fix.md`参照
2. ~~iOS版v1.7.1(17)・v1.7.2(18)の審査結果をApp Store Connectで確認する~~ → **2026-09-04確認、TestFlightベータ審査は通過(テスト中)**。続けて本番App Store提出(スクリーンショット・概要文・App Review情報の作成、審査ビルド選定、審査提出)が必要(上記In Progress参照)
3. ~~Android側のService Account Credentials JSON(Google Cloud)の作成・アップロード~~ → **2026-09-02検証解消を確認**(上記Completed参照、「Valid credentials」表示)。任意でRevenueCatの「Google developer notifications」(Pub/Subトピック接続)を設定するとよい(保留)
4. (任意、緊急性は下がった)Pricing案A残り(価格を¥980程度へ引き上げ)の実施要否をユーザーと最終判断。広告非表示は2026-09-01に有料特典として実装済み
5. ~~LINE Bot廃止の進め方を決定する~~ → **2026-09-02完了**(告知無しで即時廃止、上記Completed・`DECISIONS.md`のD-002参照)。残作業(Render本番環境変数削除、LINE Developersコンソールでのチャネル扱い決定)は手動操作のため保留(2026-09-02ユーザー判断)
6. ~~`scripts/codex-review.ps1`のWindows read-onlyサンドボックス問題を恒久対応する~~ → **2026-08-31完了**(下記Reviewer Findings参照)
7. (follow-up、詳細は`actions/dm-ruling-bot_残作業リスト.md`(Vault側)参照)課金ルートのExpress統合テスト整備、無料枠上限判定の原子化、ジョブ失敗時のスレッドロールバック、Webhook/同期APIのレート制限分離
8. 正式公開後、実際の課金ユーザーの利用データでPricing分析を再実施する
9. (follow-up)`scripts/codex-review.ps1`の残課題(下記Reviewer Findings参照): `-Base`指定時に作業ツリーの変更が漏れる、未追跡ディレクトリ配下のファイルが列挙されない、`.ai/tasks/T*.md`を無条件に全件埋め込む、新しい分岐への自動テストが無い
10. (follow-up、LINE Bot廃止のCodexレビューP2指摘)廃止した`POST /webhook/line`・`POST /api/ruling`が404で到達不能なことを保証する自動テストが無い(今回はサーバー起動+curlで手動確認のみ、上記Verification参照)。既存コードベースにHTTP統合テストの慣行が無い(supertest等未導入)ため今回は見送り。導入するなら`src/index.ts`の`app`構築とサーバー起動(`listen`)の分離が前提
11. ~~T006の公開APIのjudgeIdマスク漏れ・生セッショントークン保存の先行修正要否をユーザーへ確認する~~ → **2026-09-04、T008として先行対応**(上記Completed参照)。**T008は2026-09-05にClosed済み**(既知ID衝突51件は未調査のまま保留、T006への引き継ぎ事項として記録)。残るのはT006の案A/B/C/Dのどの方向で設計を詰めるかの判断、および引き継いだ既知ID衝突51件・ジャッジID単独認証の見直し要否(`.ai/tasks/T006-judge-auth-hardening-proposal.md`参照)
12. ~~T007共同環境修正の扱いをユーザーへ確認する~~ → **2026-09-03、ユーザーがClaudeレビュー後の修正を明示的に依頼し完了**。T007はこの依頼に基づきCodexが作成・実装し、Claude Codeの変更前・変更後レビューとPowerShell 5.1/7の検証を完了

## Do Not Repeat

- `deviceId`のような自己申告値を使う無料枠カウントは、ユーザーが削除操作できるテーブル(`ruling_job`等)から数えない。削除の影響を受けない独立カウンタ(`device_monthly_usage`)を使うこと(PR #1で実際に発生した不具合)
- Webhook等の外部通知は、特定フィールド(`expiration_at_ms`等)が無いイベントでも安全側(既存値を保持/明示的な失効イベントのみ反映)に倒すこと。全イベントで無条件に状態を上書きしない
- Claude/Codexの並行セッションでは、別セッションの変更が作業中に現れるため、`git status`で発見した時点だけから作成元や指示違反を断定しない。今回のT007は、T006のread-onlyレビューが作成したものではなく、その後のユーザー依頼に基づきCodexが作成した。レビュー後に`git status`で意図しない変更が無いか確認し、由来が不明なら他セッションの進捗・コミット履歴と突合する
