# T004: サイキック/ドラグハート等の複数面カードの名前がサジェストから漏れる不具合の修正

Status: Completed(2026-09-03、本番反映・--force全件再構築・動作確認まで完了)

## Goal

ユーザー報告「サイキッククリーチャー、ドラグハートクリーチャーが検索サジェストから漏れている」を調査し、根本原因と修正方針を実装する。

## 調査結果

- サイキック全138件・ドラグハート全66件を公式サイトから取得し、本番`GET /api/cards/suggest`で実在確認したところ、体系的な欠落はなかった(初回チェックで多数MISSINGに見えたのは`publicReadRateLimiter`(1分60リクエスト)への連続アクセスによる429の偽陽性で、間隔を空けて再確認すると204件全て発見できた)
- ただし、実際の根本原因はユーザー指摘の通り別にあった: サイキック・ドラグハート・ツインパクトは1枚のカードが`.cardDetail`ブロックを複数(表/裏の面)持つが、`src/cards/cardParser.ts`の`parseCardDetailPage`は名前(`name`)を`$(".cardDetail .card-name").first()`で**最初の面のみ**取得していた。カードテキスト(`cardText`)は既に全面ぶん連結する対応済みだったが、名前はされていなかった。そのため、もう一方の面の名前(裏面名等)は`card_index`に登録されず、その名前で入力するとサジェストされない

## Scope

- `CardInfo`に`alternateNames: string[]`(nameに採用されなかった面の名前)を追加
- `cardParser.ts`: 全`.cardDetail`ブロックから名前を収集し、最初を`name`、残り(nameと重複するものは除く)を`alternateNames`にする
- `card_cache`テーブルに`alternate_names`列(JSON文字列)を追加、保存・復元に対応
- `card_index_alt_name`テーブル新設(id, name複合PK)。`suggestCardNames`は`card_index`と`card_index_alt_name`のUNIONで検索する
- `cardIndexCrawler.ts`: カード更新時に`alternateNames`を`card_index_alt_name`へ反映
- `cardNameMatcher.ts`(裁定生成時のカード名解決): `name`・`alternateNames`のうち最もスコアが高いもので判定する(同じ根本原因が裁定生成側にも影響するため、あわせて修正)
- `runCardIndexBuild`/`getOfficialCard`/`buildCardIndex.ts`に`--force`オプションを追加。既存のcard_cache(24hTTL)・card_index(30日TTL)は今回のスキーマ変更前のデータを保持しているため、通常の差分更新では反映されない。本番反映後、Renderのシェルから`node dist/scripts/buildCardIndex.js --force`を1回実行して全件を再取得する必要がある

## Out of Scope

- レート制限(`publicReadRateLimiter`)自体の緩和(調査の過程で発見した副次的な論点。今回の根本原因とは別。対応するかは別途判断)
- モバイル側の429エラーハンドリング改善(同上)

## Acceptance Criteria

- [x] `parseCardDetailPage`が複数面カードの全ての名前を収集し、`name`/`alternateNames`に正しく分離する(単面・ツインパクト(同名2面)・サイキック(異名2面)の3パターンをテストでカバー)
- [x] `suggestCardNames`が`card_index`・`card_index_alt_name`どちらの名前でもヒットする
- [x] `findCardCandidates`(裁定生成)が`alternateNames`のいずれかとの一致でもマッチし、一致した面(`matchedFace`)を結果に含める
- [x] `retrieveEvidence.ts`が`matchedFace`の名前・属性をEvidenceに使う(裏面名で質問された場合に表面の文明・パワー等を誤って渡さない)
- [x] `card_cache`の`faces`(面ごとの名前+属性)往復(保存・復元)が正しく動作する
- [x] `card_index`(主要名)と`card_index_alt_name`(別名)の更新を1トランザクションにまとめる
- [x] `--force`オプションで既存キャッシュを無視した全件強制再取得ができる
- [x] `npm run typecheck` / `npm test`がPASSする
- [x] Codexの独立レビューを実施する(2回)
- [x] 本番反映後、Renderのシェルから`node dist/scripts/buildCardIndex.js --force`を実行し、既存カードにもalternateNames/facesが反映されることを確認する(手動操作) → **2026-09-03完了**

## Verification

- `npm run typecheck`: PASS
- `npm test`: PASS(44ファイル/264テスト)
- **本番`--force`全件再構築(2026-09-03)**: `nohup node dist/scripts/buildCardIndex.js --force > /app/data/force_reindex_20260903.log 2>&1 &`をRender Web Shellから実行。別セッションで再接続してもプロセス(PID 41)が継続していることを確認(`nohup`でシェル切断後も生存)。結果: 更新11,650件・スキップ0件・失敗1件(一時的な504/タイムアウト、次回差分更新で自動再試行される)、`card_index`総登録数16,373件。本番`GET /api/cards/suggest`に裏面名「変幻の覚醒者アンタッチャブル・パワード」(id: dm37-021)で問い合わせ、正しくサジェストされることを実機確認済み

## Review History

### Review 1 — 2026-09-02(初回実装、alternateNames追加・UNION検索・--force)

- P1: 1件(裏面名で完全一致しても、Evidenceには常に表面(主要面)の名前・属性が渡っており、裏面についての質問が表面カードとして提示され誤裁定につながる懸念) → `CardInfo`を`faces: CardFace[]`(面ごとの名前+属性)を持つ構造に拡張し、`CardNameMatch`に`matchedFace`(実際に一致した面)を追加。`retrieveEvidence.ts`が`matchedFace`の名前・属性を使うよう修正。能力テキスト(cardText)は既存仕様どおり全面連結のまま、複数面カードでは各面の属性を明示して両方の情報がLLMから見えるようにした
- P2: 1件(`card_index`の主要名upsertと`card_index_alt_name`の別名置換が別トランザクションで、別名側の失敗時に主要名だけ更新済み扱いになり30日間再取得されない不整合が起きうる) → `upsertCardIndexEntryWithAltNames`でBEGIN/COMMIT/ROLLBACKにまとめて解消(billingTransaction.tsと同じパターン)
- P2: 1件(`suggestCardNames`のテストがdb.prepareの戻り値をモックするだけでUNION節自体の有無を検証できていない、`--force`のTTL迂回テストも無い) → SQL文字列に`card_index`/`card_index_alt_name`/`UNION`が含まれることを検証するテスト、`upsertCardIndexEntryWithAltNames`のBEGIN/COMMIT/ROLLBACK順序テスト、`runCardIndexBuild`のforceRefresh有無での`getOfficialCard`呼び出し差分テストを追加。node:sqliteインメモリDBでの統合テストも試みたが、Vite/Vitestのトランスフォームが`node:sqlite`を解決できない既知の制約(`Failed to load url sqlite`)に阻まれ断念、モックベースのSQL文字列検証に切り替えた
- 全指摘に対応後、`npm run typecheck`・`npm test`(44ファイル/263テスト)PASS

### Review 2 — 2026-09-02(Review 1対応後の再レビュー)

- P0/P1: なし
- P2: 1件(`suggestCardNames`の前方一致クエリがカードIDで重複排除されておらず、表/裏で同じ接頭辞を持つカードだと同じIDが複数件返り、LIMIT枠を重複が消費して件数不足になりうる) → `suggestQuery`関数でSQL自体に`GROUP BY id`(`MIN(name)`でLIKE条件を満たした名前の中から1件選択)を導入し、1id1行を保証するよう修正
- P2: 1件(`--force`実行中にカード単位の取得が部分失敗しても`runCardIndexBuild()`自体は正常終了扱いになり、CLIが常に終了コード0を返す。失敗したカードは`card_index`が未登録のままだが気づかれにくい) → `buildCardIndex.ts`で`forceRefresh && summary.failed > 0`の場合に非ゼロ終了するよう修正
- P3: 1件(`cardParser.ts`は主要名との重複除去済みの`alternateNames`を返すが、`cardRepository.ts`のキャッシュ復元(`rowToCard`)は`faces.slice(1).map(...)`のみで重複除去しておらず、ツインパクト等でパース直後とキャッシュ復元後で`alternateNames`の中身が食い違う不変条件崩れがあった) → `deriveAlternateNames`共通関数(`cardFaceUtils.ts`新設)に導出ロジックを一本化し、両経路で同じ結果になるよう修正。ツインパクトパターンのキャッシュ往復テストを追加
- P3: 1件(STATUS.mdにT004の進行状況が未反映) → 実装側でCompleted/In Progress/Verification/Nextの各セクションを更新
- 全指摘に対応後、`npm run typecheck`・`npm test`(44ファイル/264テスト)PASS

### 本番反映(2026-09-03)

- コミット`e3323fb`をpush、Render自動デプロイ完了(`/health`が200)を確認
- Renderのシェルから`node dist/scripts/buildCardIndex.js --force`をバックグラウンド実行(`nohup ... &`)。シェルセッションを切断・再接続してもプロセスが継続していることを確認
- 完了後のログ: 更新11,650件・スキップ0件・失敗1件(一時的な504/タイムアウトによるもの、`card_index_entry_failed`の例外ログではなく`card === null`側のカウント。次回の通常差分更新(30日stale判定)で自動的に再試行対象になる想定)、`card_index`総登録数16,373件
- **副次的な発見(未対応、記録のみ)**: `card_index`総登録数16,373件は今回クロールした実カード数11,650件より多い。差分約4,723件は、削除・統合・ID変更等で公式サイトの現行一覧に含まれなくなった過去のクロール結果が`card_index`に残存している可能性がある(`upsertCardIndexEntry`はON CONFLICTでの更新のみで、現行一覧に無くなった行を削除するロジックが無いため)。サジェストに古いカード候補が混ざりうるが、実害は軽微(誤った候補を選んでも公式サイト検索で改めて確認されるため)。対応するなら別タスクとして「今回収集したIDに含まれない既存card_index行の削除(または非アクティブ化)」を検討する
- 本番`GET /api/cards/suggest`に裏面名「変幻の覚醒者アンタッチャブル・パワード」で問い合わせ、正しく`{"id":"dm37-021","name":"変幻の覚醒者アンタッチャブル・パワード"}`が返ることを実機確認

## Implementation Owner

Claude Code

## Reviewer

Codex
