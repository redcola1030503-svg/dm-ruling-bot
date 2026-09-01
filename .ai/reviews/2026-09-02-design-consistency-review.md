# 開発方針・設計・実装の整合性レビュー

Date: 2026-09-02
Reviewer: Codex
Scope: `AGENTS.md`、`README.md`、`DECISIONS.md`、`STATUS.md`、課金仕様/計画、バックエンド、Flutter、Render、プライバシー/ストア資料
Result: 要対応（P0なし、P1 5領域、P2 3領域、P3 1領域）

## Summary

全体方針は概ね一貫しているが、裁定根拠の信頼階層とdeviceIdの永続化前提に、プロダクトの中心方針・無料枠制御へ影響する矛盾がある。また、採用済みD-003と逆の課金設計書、RevenueCat導入後に未更新のプライバシー資料、Blueprintに現れない課金環境変数が残っている。

## Findings

### P1-1 ジャッジ訂正の信頼階層がREADMEと実装で逆（D-004で解消）

- `README.md:26`: 訂正は非公式であり、公式情報の根拠には使わない
- `src/ruling/generateRuling.ts:76-82,184,218-223`: 公式情報と同等の一次資料、直接の断定根拠、訂正だけでもevidenceありと判定
- `src/ruling/confidence.ts:14-19`: 強い訂正一致だけで`high`になり得る
- 影響: 公式情報を一次根拠とする`AGENTS.md:8`・`README.md:3-5`のプロダクト方針を満たさない
- 対応: ユーザー判断により、公認ジャッジ訂正を「公式参考情報」として扱う現行実装を採用。`DECISIONS.md` D-004で「公式一次情報」との区別を定義し、`README.md`を更新した

### P1-2 AndroidのdeviceId永続化とフォールバックが仕様を満たさない（D-005で方針決定、実装待ち）

- 課金仕様書: 再インストール後も維持し、単純なアプリデータ削除による無料枠リセットを防ぐ前提
- `mobile_app/lib/push/device_id.dart`: 標準`FlutterSecureStorage`へ保存するだけで、メモリキャッシュがない
- `mobile_app/android/app/src/main/AndroidManifest.xml`: Auto Backup/backup rulesの明示なし
- 保存失敗時のコメントは「同一セッションでは生成IDを使う」だが、次回呼出しでは再生成される
- 影響: 無料枠、RevenueCat appUserId、履歴、Push通知の識別が変わり得る
- 外部根拠: `https://github.com/juliansteenbakker/flutter_secure_storage`、`https://developer.android.com/identity/data/autobackup`
- 対応方針: ユーザー判断により、deviceIdをインストール単位IDとして扱い、再インストール等による無料枠リセットを既知の限界として受容する案Aを採用。購入復元はRevenueCatへ分離し、メモリキャッシュ・バックアップ除外・復元E2Eを実装する（`DECISIONS.md` D-005）

### P1-3 課金設計書がAcceptedなD-003と逆

- `docs/superpowers/specs/2026-08-30-subscription-monetization-design.md:35-43`: `ruling_job`件数を数え、新規カウンタを作らない
- `DECISIONS.md` D-003: スレッド削除で無料枠が戻るため上記方式を却下し、`device_monthly_usage`を採用
- 実装はD-003どおり
- 影響: 設計書を参照した後続変更で既知の課金回避問題を再導入し得る
- 推奨対応（Claude共有済み）: 現行の課金設計書はD-003準拠へ更新する。当初の実装計画は履歴を改変せず、冒頭に`Historical / Partially superseded`と却下警告を付ける。文書の優先順位は`DECISIONS`→`specs`→実装/テスト→`plans`とし、同じ設計書に残る`llm_usage`・deviceIdの古い前提もD-005等へ揃える。詳細な受入条件はT002参照

### P1-4 RevenueCat導入後もプライバシー/ストア資料が未更新

- 課金仕様書7章とモバイル実装計画はRevenueCat経由の購入データ追記を宿題として明記
- `docs/mobile-app-privacy-policy.html`: RevenueCat、購入、購読状態の記載なし
- `mobile_app/store_listing/data_safety_and_checklist.md`: RevenueCatを第三者共有先に含めず、財務情報を収集しない案のまま
- 影響: 実装、プライバシーポリシー、ストア申告が一致しない

### P1-5 Render Blueprintに課金必須環境変数がない

- `render.yaml`: `REVENUECAT_WEBHOOK_SECRET`、`REVENUECAT_API_KEY`等の宣言なし
- `README.md:289-292`: 本番環境変数チェックリストには存在
- `src/index.ts:48-56`: 未設定でも警告のみでサーバーは起動継続
- 影響: 新規Blueprint構築時にヘルスチェックは通るが、Webhook/購入直後同期が動かない状態になり得る
- 注記: 現在のRenderサービスへ手動設定済みかは、リポジトリだけでは判断しない

### P2-1 取得型RAG方針と裁定知識のハードコードが競合

- `README.md:5`: AIの記憶だけで回答せず、必ず公式情報を取得
- `src/ruling/generateRuling.ts:84-136`: 個別裁定知識をシステムプロンプトへ固定記述
- 影響: 公式ルール変更後も自動更新されず、取得evidenceに存在しない判断を回答へ反映し得る
- 推奨対応（Claude共有済み）: 個別裁定を単純削除せず、出典・適用/除外条件・確認日・正例/負例を持つ「検証済み裁定原則」としてGit管理し、既存のルール概念・キーワード・Embedding検索で関連質問にだけ注入する。検索評価と回答評価を分け、1件ずつ移行する。詳細は`2026-09-02-ruling-knowledge-migration-proposal.md`参照（採用判断待ち）

### P2-2 ルートのVitestへ`.worktrees`内テストが混入

- ルート`tests`: 40ファイル
- `.worktrees/subscription-billing/tests`: 42ファイル
- 実行結果: 82ファイル、469テスト。fresh cloneとローカルworktreeあり環境でDoDの対象が変わる
- `.gitignore`は`.worktrees`を除外するが、Vitestの探索対象からは除外していない

### P2-3 ジャッジIDシードのコメントが実装と逆

- `src/config/env.ts:9-11`、`.env.example:3-7`: 初回起動時のみ
- `src/config/db.ts:265-280`: 起動ごとの差分追加
- `README.md`と`docs/ジャッジID追加手順.md`は実装どおり
- 影響: 削除したジャッジIDが再デプロイで復活する条件を誤認し得る

### P3-1 STATUSとpackage metadataが陳腐化

- `STATUS.md:86`: LINE Bot廃止を未コミットと記載するが、`9ee9601`でmaster/originへコミット済み
- `STATUS.md:121`: review scriptをコミット待ちと記載するが、`d5ccfe9`でコミット済み
- `package.json:5`: LINE Botを含む説明のまま

## Verification During Review

- `npm run typecheck`: PASS
- テストのアサーション: 469件PASS。ただし`.worktrees/subscription-billing`のテストが混入しているため、master単体の件数としては扱わない
- コード・ドキュメントの変更: なし（本レビュー記録とT002/STATUS共有のみ）

## Follow-up

実装タスク: `../tasks/T002-design-consistency-remediation.md`
