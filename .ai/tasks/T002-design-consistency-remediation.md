# T002: 設計整合性の是正

Status: In Progress

## Goal

2026-09-02のCodex横断レビューで見つかった、開発方針・設計書・実装・運用設定の齟齬を解消する。特に「公式情報を根拠にする裁定品質」と「deviceIdを基準にした無料枠・購読管理」を優先し、正本が複数の異なる状態を説明しないようにする。

詳細な根拠と該当箇所は`../reviews/2026-09-02-design-consistency-review.md`を参照する。

## Acceptance Criteria

### P1（優先対応）

- [x] ジャッジ訂正の信頼階層をD-004として決定し、READMEを現行実装へ揃える。「公式一次情報」と「公認ジャッジによる公式参考情報」を区別し、論点が明確に一致する訂正は直接の裁定根拠・`high` confidenceの材料にできる
- [ ] **(新規、2026-09-02 Codexレビュー指摘、ユーザー判断待ちのため保留)** D-004はジャッジ訂正の信頼度を引き上げたが、`POST /api/login`は登録済みジャッジIDのみのパスワード無し認証のまま。ジャッジIDを知る第三者がセッションを取得すると強い誤情報を注入できてしまう懸念がある。対応案: (a)ジャッジごとの秘密情報・ワンタイム登録・外部IdP等で本人認証を強化する、(b)強い認証が入るまでは訂正単独での`high`判定・直接の断定根拠化を禁止し管理者承認済み訂正のみを対象にする。ユーザーは「今は現状のまま進める」と判断(2026-09-02)、対応時期は未定
- [x] AndroidのdeviceIdについて、少なくとも保存失敗時も同一プロセス内でIDが変わらないメモリキャッシュを実装・テストする → **2026-09-02完了**。初回実装はインスタンス単位のキャッシュで、呼び出し元が`DeviceIdProvider()`を都度newする実際の呼び出し方(`main.dart`/`paywall_screen.dart`/`settings_screen.dart`/`ruling_jobs_provider.dart`)では別インスタンス間でIDがずれる欠陥をCodexレビューで指摘され、キャッシュ・進行中Futureをstatic(クラス共有)に変更して解消。あわせて「読込失敗時に書込して既存IDを誤って上書きする」懸念も指摘され、読込失敗時は書込をスキップしメモリのみで使う実装に修正(Codexレビュー第2回)。`test/device_id_test.dart`(6テスト、別インスタンス間の一致・読込失敗時に書込0回であることを含む)・`flutter analyze`ともにPASS
- [x] D-005として、deviceIdをインストール単位IDとし、アプリデータ削除・再インストールによる無料枠リセットを既知の限界として受容する案Aを決定する
- [x] `flutter_secure_storage`をAndroid Auto Backupから除外するManifest/backup rulesを実装する → **2026-09-02完了(設定実装のみ、実機検証は別項目)**。`res/xml/data_extraction_rules.xml`(Android 12+)・`res/xml/backup_rules.xml`(Android 11以前)を新設し、SharedPreferences`FlutterSecureStorage.xml`をcloud-backup/device-transfer/fullBackupContentから除外。`AndroidManifest.xml`へ`android:dataExtractionRules`・`android:fullBackupContent`を追加。`flutter build apk --debug`でManifest/XML構文とビルド成功を確認したのみで、実際にバックアップ・端末移行時にこのファイルが除外されるかは未検証(Codexレビュー指摘、下記Verification参照)
- [ ] 上記のAuto Backup除外を仕様書(サブスクリプション設計書)へ反映する(下記の課金設計書更新タスクと合わせて対応予定、Codexレビュー指摘によりAuto Backup項目から分離)
- [ ] RevenueCatのRestore Behaviorが`Transfer to new App User ID`であることを確認し、再インストール後の新しいdeviceIdで`restorePurchases()`→バックエンド同期→購読復元が成立することを実機確認する
- [ ] サブスクリプション設計書をD-003の`device_monthly_usage`方式へ更新する。設計書には`Status: Current`と参照Decision（D-001/D-003/D-005）を明記し、無料ユーザーのジョブ作成時だけ加算、購読中は非消費、スレッド/`ruling_job`削除とは非連動、上限判定の既知の並行性課題を記載する
- [ ] 当初の`ruling_job`集計方式を含むバックエンド実装計画は内容を過去に遡って書き換えず、冒頭へ`Status: Historical implementation plan / Partially superseded`とD-003による却下警告を追加し、現行実装の指示書として使えないことを明示する
- [ ] 文書の優先順位を`DECISIONS.md`（採用判断）→`docs/superpowers/specs/`（現行仕様）→実装/テスト（現在の挙動）→`docs/superpowers/plans/`（履歴）の順で共有資料へ明記する
- [ ] 同じ課金設計書に残る`llm_usage`分析前提を`device_monthly_usage`/`ruling_job`へ、deviceId永続化前提をD-005のインストール単位ID・RevenueCat購入復元へ更新する
- [ ] プライバシーポリシーとGoogle Play Data SafetyドラフトにRevenueCat、購読状態、購入処理で扱うデータと利用目的を追記する
- [x] `render.yaml`にRevenueCat等の本番必須/任意環境変数を宣言し、既存Renderサービスの実値はダッシュボードで別途確認する。秘密値はリポジトリへ記録しない → **2026-09-02完了**。`REVENUECAT_WEBHOOK_SECRET`(必須)・`REVENUECAT_API_KEY`(必須)・`REVENUECAT_ENTITLEMENT_ID`(任意)を`sync: false`で宣言(値はRenderダッシュボード側)。既存Renderサービスに実値が設定済みかは未確認、リポジトリの記述だけでは判断できない

### P2/P3（保守性・共有状態）

- [ ] システムプロンプトにハードコードされた個別裁定ルールの位置付けを決める。Codex推奨は、誤答防止効果を維持したまま、出典・適用/除外条件・確認日・評価ケースを持つ「検証済み裁定原則」へ移し、関係する質問にだけ取得・注入する方式。詳細は`../reviews/2026-09-02-ruling-knowledge-migration-proposal.md`参照（Proposal、採用判断待ち）
- [x] Vitestが`.worktrees/**`を探索しないよう除外設定を追加し、ルートリポジトリ単体のテスト件数を確認する → **2026-09-02完了**(`vitest.config.ts`新設、ルート単体40ファイル/232テストと確認)
- [x] `src/config/env.ts`と`.env.example`のジャッジIDシード説明を、起動ごとの差分追加という実装に揃える → **2026-09-02完了**
- [x] `STATUS.md`の「未コミット」「コミット待ち」を実際のGit履歴に合わせ、`package.json`のLINE Bot表記を削除する → **2026-09-02完了**

## Out of Scope

- 既存のPricing方針（月額価格・上限付きプラン）の再決定
- LINE DevelopersコンソールやRenderダッシュボードでの削除操作そのもの
- App Attest / Play Integrityの即時導入（deviceId要件を再決定した結果、別タスクとして採用する可能性はある）
- 既存の課金ルート統合テスト、無料枠上限判定の原子化等、`STATUS.md`に既に記録済みの別follow-up

## Constraints

- D-003を維持し、無料枠判定を`ruling_job`件数へ戻さない
- D-005を維持し、Android Auto BackupやApp Set IDだけで永続deviceIdを保証できるという仕様へ戻さない
- API key、RevenueCat/Firebase認証情報、実在ジャッジIDをコミットしない
- 方針判断が必要な項目は、コードだけ先に変更せずユーザー判断または`DECISIONS.md`への記録を先に行う
- 影響範囲が広いため、P1を小さなコミットに分割し、各まとまりをCodexに独立レビューさせる

## Verification

- [x] `npm run typecheck` → PASS(2026-09-02)
- [x] `npm test`（`.worktrees/**`が含まれないことも出力で確認） → PASS、40ファイル/232テスト(2026-09-02)
- [x] `cd mobile_app && flutter analyze` → PASS、0 issues(2026-09-02)
- [x] deviceId保存成功・読込失敗・書込失敗の各ケースをテスト → `test/device_id_test.dart`で実施、PASS(2026-09-02)。読込失敗時に書込が0回であること(既存ID誤上書き防止)も検証
- [x] deviceIdの並行呼出しが常に同じIDを返すことをテスト → 同一インスタンス内・別インスタンス間の両方をPASS(2026-09-02、Codexレビューで別インスタンス間のケースが漏れていた点を指摘され追加)
- [x] Androidで`flutter build apk --debug`が成功すること(新設backup rules/Manifest変更の構文確認) → 成功(2026-09-02)
- [ ] Androidの実機/エミュレータでバックアップ・復元(またはAndroid Studioの「Backup and Restore」等)を行い、`FlutterSecureStorage.xml`(=deviceId)が実際に除外されていることを確認する(未実施、Codexレビュー指摘。`flutter build`の成功はManifest/XML構文の確認に留まる)
- [ ] Androidでアプリデータ削除後に新規IDとなり、購入復元操作後は購読状態が新規IDへ同期されることを実機確認(未実施、実機操作が必要)
- [ ] `rg -n "ruling_job|device_monthly_usage" docs/superpowers DECISIONS.md`で、旧方式への言及が履歴計画または「却下済み」の説明だけであり、現行仕様に逆行する記述がないことを確認(未実施、課金設計書更新後に行う)
- [ ] スレッド/ジョブ削除で`device_monthly_usage`が減らないこと、購読中は無料枠を消費しないこと、非購読ジョブ作成失敗時はカウンタ加算もロールバックされることを既存テストまたは追加テストで確認(未実施)
- [ ] `rg -n "RevenueCat" docs/mobile-app-privacy-policy.html mobile_app/store_listing/data_safety_and_checklist.md`で追記を確認(未実施、プライバシーポリシー更新後に行う)
- [ ] Renderダッシュボードの環境変数は値を出力せず、キーの存在だけを手動確認(未実施)

## Implementation Owner

Claude Code

## Reviewer

Codex

## Review History

### Review 1 — 2026-09-02（横断レビュー、実装前）

- P0: なし
- P1: 5領域（訂正の信頼階層はD-004で解消。deviceIdはD-005で方針決定済み・実装待ち。ほかに旧課金設計書、RevenueCatプライバシー記載、Render環境変数）
- P2: 3領域（裁定知識のハードコード、worktreeテスト混入、ジャッジIDシード説明）
- P3: 1領域（STATUS/package metadataの陳腐化）
- 詳細: `../reviews/2026-09-02-design-consistency-review.md`
