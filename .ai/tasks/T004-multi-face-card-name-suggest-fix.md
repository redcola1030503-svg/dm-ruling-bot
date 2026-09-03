# T004: サイキック/ドラグハート等の複数面カードの名前がサジェストから漏れる不具合の修正

Status: In Progress

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
- [ ] 本番反映後、Renderのシェルから`node dist/scripts/buildCardIndex.js --force`を実行し、既存カードにもalternateNames/facesが反映されることを確認する(手動操作)

## Verification

- `npm run typecheck`: PASS
- `npm test`: PASS(44ファイル/263テスト)

## Review History

### Review 1 — 2026-09-02(初回実装、alternateNames追加・UNION検索・--force)

- P1: 1件(裏面名で完全一致しても、Evidenceには常に表面(主要面)の名前・属性が渡っており、裏面についての質問が表面カードとして提示され誤裁定につながる懸念) → `CardInfo`を`faces: CardFace[]`(面ごとの名前+属性)を持つ構造に拡張し、`CardNameMatch`に`matchedFace`(実際に一致した面)を追加。`retrieveEvidence.ts`が`matchedFace`の名前・属性を使うよう修正。能力テキスト(cardText)は既存仕様どおり全面連結のまま、複数面カードでは各面の属性を明示して両方の情報がLLMから見えるようにした
- P2: 1件(`card_index`の主要名upsertと`card_index_alt_name`の別名置換が別トランザクションで、別名側の失敗時に主要名だけ更新済み扱いになり30日間再取得されない不整合が起きうる) → `upsertCardIndexEntryWithAltNames`でBEGIN/COMMIT/ROLLBACKにまとめて解消(billingTransaction.tsと同じパターン)
- P2: 1件(`suggestCardNames`のテストがdb.prepareの戻り値をモックするだけでUNION節自体の有無を検証できていない、`--force`のTTL迂回テストも無い) → SQL文字列に`card_index`/`card_index_alt_name`/`UNION`が含まれることを検証するテスト、`upsertCardIndexEntryWithAltNames`のBEGIN/COMMIT/ROLLBACK順序テスト、`runCardIndexBuild`のforceRefresh有無での`getOfficialCard`呼び出し差分テストを追加。node:sqliteインメモリDBでの統合テストも試みたが、Vite/Vitestのトランスフォームが`node:sqlite`を解決できない既知の制約(`Failed to load url sqlite`)に阻まれ断念、モックベースのSQL文字列検証に切り替えた
- 全指摘に対応後、`npm run typecheck`・`npm test`(44ファイル/263テスト)PASS

## Implementation Owner

Claude Code

## Reviewer

Codex
