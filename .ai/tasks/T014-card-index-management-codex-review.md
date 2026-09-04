# T014: カードインデックス管理機能のCodex独立レビュー

Status: Review 4完了・P1全件対応済み(2026-09-04)。P2/P3の一部は未対応(下記参照)

## Goal

ユーザー依頼: 「カードインデックス管理機能」についてCodexの独立レビューを実施する。

## 対象範囲の特定(コード確認済み)

コミット`c4203cd`(「card_index再構築を管理者API経由でトリガー可能にする」)で追加された機能一式。**このコミットは2026-08-12時点のもので、共同体制(Claude実装→Codex独立レビュー)が標準ルール化されたのは2026-09-02(AGENTS.md参照)より後**のため、この機能はこれまで一度もCodexレビューを受けていないと推定される(`git log`・過去のSTATUS.md記載を確認した限り、当該コミットに対するレビュー記録は見当たらない)。

対象ファイル:

- `src/routes/cards.ts`: 管理者限定(`requireAdminSession`)の3エンドポイント
  - `POST /api/cards/reindex`: card_index全件再構築をバックグラウンドで開始
  - `GET /api/cards/reindex/status`: 進捗確認
  - `POST /api/cards/reindex/check`: 公式サイトの総カード数を1回だけ取得し前回値と比較、差分があれば自動的に`reindex`を開始
- `src/cards/cardIndexBuildJob.ts`: 上記の実行状態管理(プロセスメモリ上、`currentStatus`変数)・`checkForCardListUpdateAndMaybeReindex`
- `src/cards/cardIndexCrawler.ts`: 実際のクロール処理(`runCardIndexBuild`、既存11,650件超をフル/差分更新)
- `src/cards/cardIndexRepository.ts`: `card_index`・`card_index_alt_name`テーブルへの読み書き、`suggestCardNames`
- `mobile_app/lib/screens/card_index_screen.dart`: 上記APIを呼び出す管理者向けモバイル画面
- `mobile_app/lib/api/api_client.dart`: 対応するAPIクライアントメソッド

## 参考: 関連する既存レビュー

`cardIndexRepository.ts`・`cardIndexCrawler.ts`自体は、T004(複数面カード名サジェスト漏れ修正、2026-09-03)でCodexレビューを2回受けているが、**T004のレビュー対象はカード名解決ロジック(`faces`・`matchedFace`・`card_index_alt_name`まわり)であり、`src/routes/cards.ts`の管理者API(認証・並行実行制御・外部サイトへのリクエスト頻度等)自体は明示的なレビュー対象になっていない**。今回のT014は、この管理者API・実行制御まわりを主眼としたレビューと位置づける。

## 対応方針(ドラフト)

このタスクは方針決定を伴わない「既存コードの独立レビュー依頼」のため、AGENTS.mdの運用に従い`scripts/codex-review.ps1`でレビューを実施する。レビュー観点の例(Codexへの依頼時に明記):

- 認証・認可: `requireAdminSession`の適用漏れがないか、管理者以外がトリガーできる経路がないか
- 並行実行制御: `startCardIndexBuildInBackground`の多重起動防止(`currentStatus.status === "running"`チェック)がプロセス再起動時にどうなるか(T011/T012で発見した「プロセスメモリ上の状態はデプロイで失われる」という既知のパターンとの類似性)
- 外部サイトへの負荷: フル再構築(過去の実績で約11,650件・1.6時間程度)を管理者が誤って多重にトリガーした場合の挙動、レート制限の有無
- `checkForCardListUpdateAndMaybeReindex`のtotal_count比較ロジックの妥当性(件数が同じでも中身が変わるケース(カード差し替え等)を検知できない等の限界)
- `card_index`テーブルの整合性(T004・T005で判明した「残存レコード」問題との関係)

## Acceptance Criteria(現段階)

- [x] 上記対象範囲・観点でレビューを実施する → **2026-09-04完了**(`scripts/codex-review.ps1`はdiff前提のためそのまま使えず、対象ファイルを直接embedする専用スクリプトで実施。下記Review History参照)
- [x] 検出された指摘をこのファイルのReview Historyへ記録する → 完了
- [x] Review 1のP1 3件に対応する → **2026-09-04完了**(下記Review 2参照)
- [x] Review 2(対応後の差分レビュー)を実施し、新規P1 6件のうち本タスク範囲内の2件に対応する → **2026-09-04完了**(下記参照)
- [ ] 残るP2(4件)・P3(1件)は対応せず、優先度が上がった際の別作業とする(ユーザー判断待ち)

## Implementation Owner

Claude Code(2026-09-04、ユーザー「進めて」指示によりAuto Modeで対応方針を判断し実装)

## Reviewer

Codex

## Review History

### Review 1 — 2026-09-04(既存コード一式のレビュー、diffなし)

結論: P0なし。ただし「管理・復旧機能として信頼する前に直すべきP1が3件」との評価。認証の直接的な迂回は見つからなかった。

**P1**

1. **「全件再構築」ボタンが実際には全件を再取得しない**: `cardIndexBuildJob.ts:30`が`forceRefresh`を渡さず、`cardIndexCrawler.ts:78`は30日以内の既存カードをスキップする。画面上の「全件再構築」という説明に反し、最近登録された壊れた行・名前修正・パーサー変更は修復されない(T004で実際にAPIではなくCLIの`--force`が必要だった実績と一致)。`forceRefresh: true`にするか、現行操作を「差分更新」に改名し強制再構築を別操作にすべき。
2. **更新検知の記録が、再構築の成功を待たずに更新されてしまう**: `cardIndexBuildJob.ts:68`(`checkForCardListUpdateAndMaybeReindex`)は再構築の開始より先に`last_known_total_count`を更新しており、(a)別の再構築が実行中で開始できない (b)開始後にプロセスが再起動する (c)一覧取得等でジョブ全体が失敗する (d)個別カード取得の失敗(crawlerが例外を握り`completed`扱いになる)、のいずれの場合でも新しい件数が保存され、次回チェックで再試行されなくなる。観測値と「正常に反映済みの件数」を分離し、十分に成功した完了時だけ後者を更新すべき。
3. **不完全な一覧クロールを正常完了として扱う**: `cardIndexCrawler.ts:31`は空ページ2回、または新規IDがゼロのページで終了する設計だが、HTTP 200のエラーページ・HTML変更・同一ページの一時的な再送でも、途中までの一覧を正常な全件結果として`completed`扱いにしてしまう。収集件数ゼロや前回からの異常な減少を検出する対策が必要。

**P2**

4. 実行状態(`currentStatus`)と多重起動防止がプロセスメモリ上のみ(`cardIndexBuildJob.ts:15`)。デプロイ・クラッシュで`idle`に戻ってしまい、T011/T012で発見したのと同種のパターン。またRender ShellからのCLI実行(`buildCardIndex.ts --force`)は別プロセスのためAPI側のロック対象外(排他されない)。
5. `total_count`比較だけでは、件数が変わらない名前・テキスト修正、削除と追加の相殺、特殊サブIDカードの追加(一覧検索に出ない)を検知できない(T005参照)。定期的な強制更新期限、一覧のフィンガープリント、手動強制再構築のいずれかの併用が必要。
6. `card_index`の残存行(crawlerはupsertのみで削除しない、実績「収集11,650件・DB16,373件」と一致)を識別・整理する手段が無い。ただしT005で判明した通り、一覧に出ないという理由だけで削除するのは危険(有効な特殊カードを消しかねない)。DB総数・今回収集数・一覧外既存数を分けて表示し、削除は複数回確認済みの404/410等の安全な条件に限定すべき。
7. モバイル画面(`card_index_screen.dart`)が失敗状態を正しく表示しない: サーバー側は`failed`・`error`を返すが、`reindex_status.dart`モデルがエラー内容を保持せず、画面は`failed`を「未実行」として表示してしまう。更新チェックも`hasUpdate == true`だけで「再構築を開始しました」と表示し、`reindexStarted == false`(多重起動で開始できなかった場合)を無視している。

**P3**

8. `card_index_screen.dart:48`は非同期処理後に`mounted`確認せず`setState`しており画面離脱時に例外化しうる。5秒周期のポーリングに実行中ガードが無く遅延時にリクエストが重複しうる。3ルートへの401/403/202/409/502のテスト、クロール途中で空ページになるケースのテスト、失敗表示のFlutterテストが無い。

**認証・負荷について**: 3エンドポイントすべてに`requireAdminSession`が適用され、roleもDBから都度取得されるため、T014固有の認証迂回経路は見つからなかった。ただし「judgeIdだけでログイン可能・セッション期限なし」というT006既知リスクは引き続き継承している。公式サイトへの通信は`httpClient.ts`で同一プロセス内500ms間隔に制限されているが、CLIや複数プロセス間では共有されない(上記4と関連)。

**検証**: `npm run typecheck`はPASS。対象Vitestは読み取り専用サンドボックスのディレクトリアクセス制限により設定読込前に停止(テスト失敗ではない)。ファイル変更なし(read-only依頼のため)。

### Review 1のP1 3件への対応(2026-09-04実装)

1. **「全件再構築」が実際には差分更新のまま**: `routes/cards.ts`の`POST /api/cards/reindex`ハンドラで`startCardIndexBuildInBackground({ forceRefresh: true })`を渡すよう修正。`checkForCardListUpdateAndMaybeReindex`側(公式サイトのtotal_count変化を検知した際の自動トリガー)は従来通り差分更新のまま(新規カードは`getCardIndexUpdatedAt`が`null`のため forceRefresh 無しでも必ず取得される)。
2. **更新検知の記録が再構築の成功を待たずに確定してしまう**: `startCardIndexBuildInBackground`に`onSettled`コールバックを追加し、`checkForCardListUpdateAndMaybeReindex`は再構築が実際に開始・完了した場合のみ`setLastKnownTotalCount`を呼ぶよう変更(件数に変化が無い場合は従来通り即座に確定)。
3. **不完全な一覧クロールを正常完了として扱う**: `cardIndexCrawler.ts`の`runCardIndexBuild`に、収集件数が0件、または既知の総数から50%(`MIN_ACCEPTABLE_HIT_RATIO`)を下回った場合に例外を投げるガードを追加。

### Review 2 — 2026-09-04(上記1〜3の実装差分に対する独立レビュー、`scripts/codex-review.ps1`で実施。このリポジトリの他の未コミット差分も同時に埋め込まれ、まとめてレビューされている)

結論: P0なし、P1 6件(本タスク直接分は2件、他は関連タスクの設計ドキュメント・T013・STATUS.mdに対する指摘)。P2 4件、詳細は`.ai/reviews/`ではなく各タスクファイルへ分散して記録(このプロジェクトの`codex-review.ps1`は複数の未コミット変更をまとめて1回のレビューにする設計のため)。

**本タスク(T014)に直接対応した指摘**

1. **部分失敗した再構築でも更新検知を成功扱いにしていた**: `runCardIndexBuild()`がresolveすれば`summary.failed > 0`でも`onSettled({ ok: true })`になり、個別カード取得の失敗があっても観測値(`last_known_total_count`)が確定してしまい、次回チェックで再試行されない不備。**対応**: `checkForCardListUpdateAndMaybeReindex`の`onSettled`で`result.summary.failed === 0`を追加条件にし、1件でも失敗があれば確定させないよう修正。テスト2件追加(全件成功時のみ確定/1件失敗時は確定しない)。
2. **不完全クロール検知の基準(`getCardIndexCount`)が実態に合わない**: `card_index`のDB行数(16,373件、副次的な発見済みの残存行を含む)を基準にすると、実際の掲載数(11,650件程度)から大幅に減っても閾値を超えず検知できない。**対応**: `getLastKnownTotalCount()`(前回チェック時点で公式サイトから確認できた総数)を優先し、未記録の初回起動時のみ`getCardIndexCount()`にフォールバックするよう変更。加えて、ページネーション上限(2000ページ)に達した場合(終端検出の失敗を疑うべきケース、Review 2で追加指摘)も例外を投げるガードを追加。テスト2件追加。

**本タスク範囲外(T012/T010/T013/STATUS.mdの指摘、各タスクファイル側で対応・記録)**

3. 既存の孤立ジョブ(`usage_month_key`列がNULL)が新しい返金確定処理の対象から漏れる → T010参照
4. 作成時刻とLLM単体タイムアウトだけでは実行中ジョブと孤立ジョブを区別できない → T012参照
5. 購読状態の確認失敗時、無償ユーザーへの広告が永続的に止まる → `subscription_provider.dart`の`checkEntitlement()`にtry/catchを追加し、問い合わせ失敗時も`isStatusKnown`をtrueにして未購読(広告表示)側へフォールバックするよう修正(2026-09-04)
6. STATUS.md/T013/T014の記述とAcceptance Criteriaの不整合 → 本ファイルおよびSTATUS.mdを本レビューの内容で更新して解消

**検証(Review 2対応後)**: `npm run typecheck` PASS、`npm test` PASS(45ファイル/280テスト、cardIndexBuildJob 16件・cardIndexCrawler +3件を含む)、`flutter analyze` 0 issues。実機/エミュレータでの管理者API呼び出し確認は未実施(コード変更+静的検証+ユニットテストのみ)。

### Review 3 — 2026-09-04(Review 2対応差分の再レビュー。本タスクのcardIndexCrawler/cardIndexBuildJob関連の新規指摘のみ記載、他タスク分は各タスクファイル参照)

Review 2の対応後、再度`scripts/codex-review.ps1`でレビューした結果、本タスクのファイルにも新規のP1 2件を検出・反映済み。

1. **不完全クロールを成功扱いにする経路がまだ残っていた**: `collectAllCardHits()`は「新規IDが0件のページ」を1回検出した時点で即座に終端と判断していたため、同一ページの一時的な再送(HTTPの一時異常等)が起きた場合、それが全体の50%以上を取得した後であればReview 2で追加した比率ガードをすり抜け、残りのカードが欠落したまま正常完了扱いになりうる。**対応**: 空ページ・新規IDゼロのページのいずれであっても、連続してMAX_CONSECUTIVE_EMPTY_PAGES(2)回「進展が無い」ことを確認してから終端とみなすよう統一(1回の非進展では即終端としない)。加えて、`checkForCardListUpdateAndMaybeReindex`が直前に取得した最新の`total_count`(`expectedTotal`)を`runCardIndexBuild`へ渡し、比較基準の優先順位を「直前に取得した最新値 > 前回チェック時点の記録値 > DB行数」の順にして精度を上げた。
2. **`onSettled`フックの例外が正常な再構築を失敗へ反転させていた**: `.then()`内で`onSettled({ok:true})`を呼んだ直後に同じPromiseチェーンの`.catch()`があり、フック内(`setLastKnownTotalCount`等)が例外を投げると、ビルド自体は成功していたのに`currentStatus`が`failed`へ上書きされ、`onSettled({ok:false})`が二重に呼ばれてしまう不具合があった。**対応**: `onSettled`呼び出しをtry/catchで囲み、フック自体の例外はログに記録するだけに留め、ビルドの成否判定(`currentStatus`)には影響させないよう修正。

**検証(Review 3対応後)**: `npm run typecheck` PASS、`npm test` PASS(45ファイル/282テスト)、`flutter analyze` 0 issues。実機/エミュレータでの管理者API呼び出し確認は今回も未実施。

### Review 4 — 2026-09-04(T010/T012実装完了後の差分レビューに同梱)

- P1: 管理画面の「全件再構築」(`POST /api/cards/reindex`)が`expectedTotal`を渡していなかったため、判定基準が緩い方(`getLastKnownTotalCount`または`getCardIndexCount`)のままだった。特に`getCardIndexCount`(残存行を含み実際より多い16,373件相当)にフォールバックすると、50%の閾値が実質かなり緩くなり大幅な欠落を見逃しうる → `POST /api/cards/reindex`ハンドラを非同期化し、実行前に`fetchTotalCardCount()`で公式サイトの最新総数を取得して`expectedTotal`として渡すよう修正(`src/routes/cards.ts`)。取得自体が失敗しても全件再構築の実行は妨げない(その場合は従来通りの緩い基準にフォールバック)

**未対応のまま残す(Review 1のP2 4件・P3 1件、優先度が上がった際の別作業)**: 実行状態管理がプロセスメモリ上のみ、`total_count`比較の限界、`card_index`残存行の識別手段、モバイル画面の失敗状態表示(`failed`と`completed_with_errors`の区別を含む)、ポーリングのmounted未確認・テスト不足。

**検証(Review 4対応後)**: `npm run typecheck` PASS、`npm test` PASS(47ファイル/309テスト)。
