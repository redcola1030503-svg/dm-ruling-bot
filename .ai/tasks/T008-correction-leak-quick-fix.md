# T008: 訂正関連の情報漏洩バグ2件の先行修正(T006 Review 1で発覚)

Status: **再オープン(2026-09-04)**。一度Closedにしたが、本番DBの読み取り専用クエリで`ruling_job.result_json`に旧title(judgeId入り)の残存2件を実際に確認した(移行スクリプトの正規表現の不備が原因、下記参照)。**修正コードはT010/T012の未レビュー実装から切り出し、単独でコミット(`e48137b`)・pushしてRenderへデプロイ済み**(2026-09-04、ユーザー判断)。**残作業は本番Web Shellでの再マイグレーション実行のみ**(下記参照)。**追加インシデント**: 上記の記録中に実際のジャッジIDを誤って平文でファイルへ記載しGitHubへpushしてしまう事故が発生したが、伏字修正・push、および当該ジャッジIDのDB削除+`VALID_JUDGE_IDS`からの除外による無効化まで完了済み(下記参照)。ジャッジID自体の再発行見送りの判断(下記「Out of Scope」参照、この追加インシデントとは別の一般的なリスク受容の話)は既に確定済みのまま変更なし

## Goal

T006(D-004ジャッジ認証強化の対応案検討)のCodex Review 1で、認証強化の方針(案A〜D)とは独立に、**現状の実装に既に存在する情報漏洩バグ2件**が見つかった。ユーザーから「現状と対応方針をcodexにレビューさせてから先行修正を実装」との指示を受け、A/B/C/Dの方針決定を待たずにこの2件を先に修正する。このタスクは方針決定段階であり、実装はCodexレビュー後に行う(AGENTS.md「Review」セクションの運用に従う)。

## 前提(コード確認済み、T006からの引き継ぎ)

1. **バグ1**: 認証不要の公開API`GET /api/corrections/:id`(`src/routes/corrections.ts:59-73`)が、訂正オブジェクトの`correctedBy`のみを空文字にマスクし、`judgeId`はマスクせずそのまま返している。訂正が1件でも公開されていれば、誰でもそのジャッジIDを取得でき、`POST /api/login`へそのまま使える(ジャッジIDは唯一の認証情報のため、これだけでログインが成立する)
2. **バグ2**: `POST /api/corrections`(`src/routes/corrections.ts:40`)が`correctedBy: session.userId`を保存している。`session.userId`は`src/routes/auth.ts`のログイン時に発行する生のセッショントークン(`crypto.randomBytes(32).toString("hex")`)そのもの。この値が`correction`テーブルの`corrected_by`列に平文保存され、`GET /api/corrections`(管理者ロール、`getAllCorrections()`、マスク無し)経由で、管理者は他ジャッジの生セッショントークンをそのまま閲覧できる。取得したトークンをそのまま`Authorization`ヘッダーに使えば、対象ジャッジになりすましてセッションを乗っ取れる
3. `src/corrections/types.ts:7`の`correctedBy: string; // LINEユーザーID`というコメントはLINE Bot時代の残骸で、現在の実装(セッショントークン)と一致していない
4. `correctedBy`と`judgeId`は現状の呼び出し箇所(`corrections.ts:34-42`)を確認する限り、常に同一セッションの`session.userId`/`session.judgeId`から設定されており、**用途上の区別が実質存在しない**(コード全体を`grep`した結果、他の設定経路は無い)

## 対応方針(ドラフト)

### 修正1: `corrected_by`列に生のセッショントークンを保存しない

`src/routes/corrections.ts:40`の`correctedBy: session.userId`を`correctedBy: session.judgeId`に変更する。

- `correctedBy`と`judgeId`が同値になり事実上冗長化するが、既存のDBスキーマ・型(`Correction.correctedBy`/`judgeId`)・モバイルアプリの`correction.dart`モデルを変更せずに済む最小差分
- `src/corrections/types.ts:7`の古いコメント(`// LINEユーザーID`)を実態に合わせて修正する
- 将来的に`correctedBy`列自体を廃止し`judgeId`に一本化するかは、このタスクのスコープ外とする(最小差分での先行修正を優先)

### 修正2: 公開APIで`judgeId`もマスクする

`src/routes/corrections.ts:72`の`res.json({ correction: { ...correction, correctedBy: "" } })`を`res.json({ correction: { ...correction, correctedBy: "", judgeId: "" } })`に変更する(修正1適用後は`correctedBy`と`judgeId`が同値になるため、両方を明示的にマスクする)。

### 修正3: 既存DBデータの移行(本番)

修正1はコード変更後に**新規作成される**訂正にのみ適用される。既存の`correction`テーブルには、過去に保存された生のセッショントークンがそのまま残っている。本番DBに対して以下のマイグレーションを実行する必要がある。

```sql
UPDATE correction SET corrected_by = judge_id;
```

- 実行方法(要検討・Codexレビューで相談): (a) 起動時マイグレーション(`src/config/db.ts`の既存スキーマ初期化処理に追加)、(b) 一回限りのスクリプト(`src/scripts/`配下に追加しRender Web Shellから手動実行)。バックエンドは単一プロセス・低頻度書き込みのため、起動時マイグレーションでも実害は小さいと考えられるが、Codexの意見を聞く
- **未確定事項**: 修正1適用より前に発行され、既に管理者の目に触れた可能性のある生セッショントークン(過去の`GET /api/corrections`呼び出し履歴)自体を無効化(全ジャッジの強制再ログイン)するかどうかは、このタスクのスコープ外とし別途ユーザー判断を仰ぐ(現状セッションに有効期限が無く、`judge_session`テーブルを見ればログイン中のトークンを直接削除できるが、実施要否は影響範囲・実際の閲覧履歴が不明なため即断しない)

## 対応方針(Review 1反映版)

Review 1で、当初の2件修正だけでは不十分と判明した。**根本原因は`retrieveEvidence.ts:196`が訂正Evidenceの`title`文字列へ`judgeId`を直接埋め込んでいること**で、ここから3つの経路で一般ユーザー・第三者へ露出していた。

- `generateRuling.ts`経由で、裁定結果の`sources`(認証不要、質問した本人へ返る)にそのまま含まれる
- `produceRuling.ts`の`recordSourceReferences`が`title`をそのまま`source_reference_stat`テーブルへ保存し、認証不要の`GET /api/stats/sources?type=correction`で**誰でも**閲覧できる
- 加えて元々のバグ1(`GET /api/corrections/:id`の`judgeId`マスク漏れ)

### 修正4(追加、P0): Evidenceタイトルから`judgeId`を除去する

`src/ruling/retrieveEvidence.ts:196`の`title`を、個別のジャッジIDを含まない固定文言に変更する。

```typescript
title: "過去の訂正事例(公認ジャッジによる記録)",
```

- D-004の「訂正の出典表示では、公認ジャッジの訂正記録であることを明示し、タカラトミー公開物であるかのようには表示しない」という要件は、個々のジャッジIDを出さなくても満たせる(「公認ジャッジによる記録」という表示で要件を満たす)
- `itemKey`(`String(correction.id)`)は元々ジャッジIDと無関係の内部連番のため変更不要
- **影響確認・既知の限界(実装不可、受容する)**: `title`は`produceRuling.ts`の`byEmptyUrlTitle`(url=""の項目をtitleで照合するMap)のキーにも使われている。同一質問内で複数の訂正がヒットした場合、タイトルを固定文言化すると`byEmptyUrlTitle`のキーが衝突し、統計(`source_reference_stat`)上どの訂正が実際に参照されたかの記録精度が下がる(後勝ちで別の訂正のitemKeyが記録されうる)。**この照合はLLMが出力する`RulingSourceRef`(`title`/`urlのみ`、`itemKey`を持たない)を`title`文字列で突き合わせる設計のため、単純に照合キーを`itemKey`へ差し替えることはできない**(LLMへ`itemKey`を出力させるプロンプト変更が別途必要になり、このタスクのスコープを超える)。この衝突は元々「同一ジャッジが複数の訂正を持つ場合」に既に発生しうる既存の設計限界であり、本修正はその発生頻度を広げるに留まる(セキュリティ上のID漏洩を止める方が優先度が高いと判断)。stats上の参照回数の帰属精度が下がる点は許容し、`itemKey`ベースの照合への再設計は別タスクのfollow-upとする

### 修正5(追加、P0のデータ移行分): `source_reference_stat`の既存レコード移行

`source_reference_stat`テーブルのうち`source_type = 'correction'`の既存行は、旧タイトル(ジャッジID入り)のまま残る。本番マイグレーションで一括更新する。

```sql
UPDATE source_reference_stat
SET title = '過去の訂正事例(公認ジャッジによる記録)'
WHERE source_type = 'correction';
```

### 修正6(追加、P1): 修正1適用時に該当ジャッジの現行セッションを失効させる

`corrected_by`列を`session.userId`(生トークン)から`judgeId`へ書き換えるだけでは、**既に管理者へ露出した可能性のある生トークン自体はそのまま有効**(`judge_session`テーブルに存在する限り`authMiddleware.ts`が受理し続け、セッションに有効期限が無い)。本番マイグレーション実行時、以下を同一のメンテナンス作業として実施する。

```sql
-- 既存のcorrected_by値(生トークン)と一致するjudge_sessionを削除し、
-- 露出した可能性のあるトークンを一括失効させる。
DELETE FROM judge_session WHERE user_id IN (SELECT corrected_by FROM correction WHERE corrected_by != judge_id);
-- ↑ 上記DELETEを、corrected_byをjudge_idへ上書きするUPDATEより前に実行する(順序が重要)
UPDATE correction SET corrected_by = judge_id WHERE corrected_by != judge_id;
```

- 影響: このメンテナンス実行後、全ジャッジが強制ログアウトされ再ログインが必要になる(ジャッジID自体は変更されないため、再ログイン自体は即座に可能)
- **Out of Scopeとして残す判断(P1後半、要ユーザー判断)**: ジャッジID自体は、公開API経由で既に第三者に知られてしまっている可能性がある(バグ1が本番稼働していた期間中)。ジャッジID自体の失効・再発行(新しいIDへの切り替え)は、運用上の連絡・周知が必要な手動作業であり、T006(認証強化本体)の範囲と重なるため、このタスクでは実施しない。**ユーザーへ推奨事項として報告する**(下記「未確定事項」参照)

## 実装サマリー(2026-09-03、Review 2反映版)

Review 1(P0: Evidenceタイトル経由の漏洩、P1: 漏洩済みトークンの失効)・Review 2(P1: ruling_job.result_json内の旧title残存、P2: title固定文言化によるstats誤帰属・回帰テスト不足)の両方を反映して実装した。

- `src/routes/corrections.ts`: `correctedBy: session.userId` → `correctedBy: session.judgeId`(修正1)。`GET /api/corrections/:id`のレスポンスを`{ ...correction, correctedBy: "", judgeId: "" }`に変更(修正2)
- `src/corrections/types.ts`: `correctedBy`の古いコメント(LINEユーザーID)を実態に合わせて修正
- `src/ruling/retrieveEvidence.ts`: pastCorrectionsの`title`を`` `過去の訂正事例 #${correction.id}(公認ジャッジによる記録)` ``に変更(修正4)。judgeIdを含めず、かつcorrection.id(秘密ではない内部連番)を含めることで、Review 2で指摘されたtitle衝突(複数訂正が同一質問でヒットした際のstats誤帰属)も解消
- `src/corrections/repository.ts`: `migrateCorrectionCredentials()`を新設。`judge_session`の該当セッション失効(修正6)→`corrected_by`のjudgeIdへの置換(修正1のデータ移行分)→`source_reference_stat`の訂正事例分タイトル移行(修正5、`#<item_key>`形式に統一)→`ruling_job.result_json`内の旧title移行(Review 2で追加発覚、`rulingJobRepository.ts`の新関数を呼び出す)を単一トランザクションで実行し、件数を返す
- `src/ruling/rulingJobRepository.ts`: `migrateLegacyCorrectionTitlesInResultJson()`を新設。旧title形式(`過去の訂正事例(ジャッジID: xxx)`)を含む`result_json`を正規表現で置換する(スレッド付きジョブは無期限保持されるため必要)
- `src/scripts/migrateCorrectionCredentials.ts`: 上記を呼び出す一回限りの実行スクリプト(本番ではRender Web Shellから`node dist/scripts/migrateCorrectionCredentials.js`で実行する想定、未実行)
- `mobile_app/lib/screens/usage_stats_screen.dart`: 訂正詳細ダイアログの表示を`'訂正したジャッジ: ${correction.judgeId}'`(修正2適用後は常に空文字になり不自然)から固定文言`'訂正したジャッジ: 公認ジャッジによる記録'`に変更
- テスト: `tests/migrateCorrectionCredentials.test.ts`・`tests/rulingJobRepository.test.ts`(新規、移行ロジック・トランザクション順序・ロールバックを検証)、`tests/retrieveEvidence.test.ts`(新規、titleにjudgeIdを含まないこと・複数訂正でtitleが衝突しないことを検証)、`tests/produceRuling.test.ts`・`tests/confidence.test.ts`(既存の固定文字列フィクスチャを更新)
- **route-levelの回帰テスト不足(Review 2 P2指摘)への対応**: このリポジトリはHTTP統合テストの慣行が無い(supertest等未導入、既知の制約)ため、自動テストではなく`npm run dev`相当のローカルサーバーを一時DBで起動し、実際に(1)ログイン→訂正作成→`GET /api/corrections`(自分の一覧)で`correctedBy === judgeId`(生トークンでない)、(2)`GET /api/corrections/:id`(公開)で`correctedBy`・`judgeId`ともに空文字、の2点をcurlで実機確認した(下記Verification参照)

## Acceptance Criteria(このタスクの現段階)

- [x] 対応方針(本ドラフト)についてCodexの独立レビューを受ける(Review 1)
- [x] レビュー指摘を反映する(Review 1のP0・P1すべて反映、修正4〜6を追加)
- [x] レビュー後、実装に進む(修正1・2・4はコード変更、修正5・6は`migrateCorrectionCredentials()`としてコード化)
- [x] 実装後、Codexの独立再レビューを受ける(Review 2)
- [x] Review 2の指摘を反映する(ruling_job.result_json移行・title衝突解消・route実機確認)
- [x] `npm run typecheck && npm test`がPASSすることを確認する(45ファイル/270テストPASS)
- [x] `cd mobile_app && flutter analyze`がPASSすることを確認する(0 issues)
- [x] route-levelの実機確認(curl、上記実装サマリー参照)
- [x] 本番で`node dist/scripts/migrateCorrectionCredentials.js`を実行し、`SELECT corrected_by, judge_id FROM correction WHERE corrected_by != judge_id`が0件であることをRender Web Shellで確認する → **2026-09-04完了**。実行はユーザー本人がRender Web Shellで実施(Claude Code側では自動実行の安全装置により本番DB書き込みコマンドの代行入力がブロックされたため)。出力: 失効させたセッション数3、corrected_byを移行した訂正数3、source_reference_statのタイトルを移行した件数1、ruling_job.result_jsonのタイトルを移行した件数3。実行前後の検証(Claude Codeが読み取り専用クエリで確認): mismatch 3→0、judge_session総数17→14(3件失効)、source_reference_statの旧title残存 0件。

**残存確認・追加の不具合発見と修正(2026-09-04、ユーザー指示によりCodexレビュー指摘を受けて本番DBを読み取り専用で確認)**: `ruling_job.result_json`に旧title形式(`過去の訂正事例(ジャッジID:...)`)が本当に0件か、Render Web Shell経由の読み取り専用クエリ(`result_json LIKE '%ジャッジID:%'`で件数確認)で確認したところ、**全139件中2件で残存を確認した(実害あり)**。原因を調査した結果、移行スクリプトの正規表現`LEGACY_CORRECTION_TITLE_PATTERN`が`ジャッジID: `(コロンの直後に半角スペースあり)を前提にしていたが、この2件は実際には`ジャッジID:<REDACTED>`のようにスペース無しの形式で保存されており、正規表現がマッチせず移行から漏れていたと判明した(実際のジャッジIDはこのファイルには記載しない)。

**重要な追加インシデント(2026-09-04、Codexレビューで発覚)**: 上記の初版では「実際のジャッジIDはこのファイルには記載しない」と書きながら、直前の文中に実際のジャッジID(4桁の数値)を平文でそのまま記載してしまっていた。この版は既に単独コミット(`e48137b`)としてpublicリポジトリへpush済みだったため、**新たな公開漏洩が発生した**。**2件とも作成日時は2026-08-19(バグ修正・移行の実施日である2026-09-03/09-04より前)であり、修正後に新たに発生した漏洩ではなく、既存データの移行漏れである**ことも確認済み。

**インシデント対応(2026-09-04、ユーザー判断「今すぐ無効化してほしい」)**:
1. このファイルの該当箇所を`<REDACTED>`へ即時修正し、単独コミット(`45e5516`)としてpush・デプロイ済み(Renderダッシュボードで"Deploy live for 45e5516"確認済み)。ただし**git履歴上のコミット`e48137b`には実IDが平文のまま残っている**(履歴書き換え〈`git filter-repo`等+force push〉は破壊的操作のため今回は実施せず、下記2の無効化により実害を無くす方針とした)。
2. 漏洩した当該ジャッジIDを本番環境から完全に無効化した。Render Web Shellから読み取り専用クエリで対象を特定(role: judge、created_by: env:VALID_JUDGE_IDS、アクティブセッション0件)した上で、`DELETE FROM judge_session WHERE judge_id = ?`(該当0件)・`DELETE FROM judge WHERE id = ?`(1件削除)を実行して`judge`テーブルから削除。あわせてRender環境変数`VALID_JUDGE_IDS`からも当該IDを除外し(残りは別の既存ID1件のみ。実際の値はこのファイルには記載しない)、「Save, rebuild, and deploy」で再デプロイ・"Deploy succeeded | Live"を確認済み(環境変数からも除外したことで、次回起動時の`INSERT OR IGNORE`による再シードも防止済み)。これにより、このIDでの新規ログインはできなくなった。この漏洩は「バグ稼働期間中の間接的な漏洩リスクは受容し再発行見送り」という過去の判断(下記Out of Scope参照)とは別件の、GitHub上への新規の直接的漏洩として個別に対処したもの。

**2件目のインシデント・対応済み(2026-09-04、T017実装レビューに同梱のCodexレビュー2回目で発覚)**: 上記1件目の対応記録を書く際、このファイル自身の記述中に「残りは別の既存ID1件のみ」と書くべきところを誤り、上記2で除外した後にVALID_JUDGE_IDSへ残っていたもう一方の実在するジャッジID(実際の値はここには記載しない)を平文で記載してしまっていた。**コミット前に発覚し即座に伏字修正したため、gitコミット履歴・GitHubへの公開は一度も無い**(1件目より露出範囲は狭く、Codexレビューのプロンプトに一度埋め込まれ外部API呼び出し経由で送信されたのみ)。ユーザーへ無効化要否を確認し「無効化して」の判断を得て対応した: Render Web Shellの読み取り専用クエリで`judge`テーブルに当該IDが実在し(`judge_session`はアクティブ0件)と確認した上で、`DELETE FROM judge WHERE id = ?`を実行し1件削除。あわせてRender環境変数`VALID_JUDGE_IDS`から当該IDを除外(除外後は空文字列。これが1件目のID除外後に残っていた最後の1件だったため、**VALID_JUDGE_IDSは空になり、ジャッジログイン機能は新しいIDを発行するまで本番で使用不可**になる。この結果はユーザーへ明示した上で「空のまま保存・デプロイする」の判断を得て実施)、「Save, rebuild, and deploy」で再デプロイ・"Deploy succeeded"とサーバー起動ログを確認済み。**解消済み(2026-09-04)**: ユーザーが管理者アカウント(`ADMIN_JUDGE_IDS`環境変数でシードされた既存の管理者。この環境変数はVALID_JUDGE_IDSとは別物で今回変更していないため無事)経由の管理API(`POST /api/judges`、`addJudge()`)で新しいジャッジを`judge`テーブルへ直接追加した。ログイン処理(`GET /api/login`)は`VALID_JUDGE_IDS`ではなく`judge`テーブルを直接参照するため、VALID_JUDGE_IDSが空のままでもこの経路で追加したジャッジは問題なくログインできる。本番DBの読み取り専用クエリで`judge`件数2件(admin 1件・judge 1件)を確認済み。VALID_JUDGE_IDSへの追加は不要(起動時の`INSERT OR IGNORE`再シード用の別経路であり、管理API経由の追加とは独立)。
- **対応**: `src/ruling/rulingJobRepository.ts`の`LEGACY_CORRECTION_TITLE_PATTERN`を、コロン直後のスペース有無どちらにもマッチするよう修正(`ジャッジID: ?[^)]*`)。回帰テストを追加(`tests/rulingJobRepository.test.ts`)。`migrateCorrectionCredentials()`は全ステップが「まだ移行が必要な行だけ」を対象にした条件付きUPDATE/DELETEで構成されており冪等(再実行しても既に正しい行には影響しない)なため、この修正を反映した`dist/scripts/migrateCorrectionCredentials.js`を本番へデプロイし再実行すれば、残る2件も含めて安全に解消できる見込み。
- **デプロイ完了(2026-09-04)**: ユーザー判断により、この修正だけをT010/T012の未レビュー実装から切り出して先に反映することにした。`git stash`でT010/T012等の未コミット変更を退避 → `src/ruling/rulingJobRepository.ts`の正規表現修正と対応テストのみをクリーンな作業ツリーへ再適用 → 単独で動作確認(`npm run typecheck`・当該テストファイル・`npm test`全体、いずれもPASS)→ コミット`e48137b`としてmasterへpush → `git stash pop`でT010/T012等を復元、の手順で実施。Render側は`master`へのpushで自動デプロイされる設定になっており、**Renderダッシュボードで"Deploy live for e48137b"を確認済み(2026-09-04 14:31)**。本番へ反映済み。
- **残作業**: Renderのデプロイが反映された後、`node dist/scripts/migrateCorrectionCredentials.js`をRender Web Shellから再実行し(冪等なため安全に再実行可能)、`result_json LIKE '%ジャッジID:%'`が0件になることを読み取り専用クエリで再確認する。この本番DBへの書き込み実行自体は、過去の実績と同様にユーザー本人がRender Web Shellから行う想定(Claude Code側の自動実行安全装置により書き込みコマンドの代行入力がブロックされるため)。

## Out of Scope・残る既知のリスク(重要、ユーザーへ強く推奨)

- **ジャッジID自体は、修正後も引き続き有効なログイン資格情報のままである(Review 2で改めて指摘)**。バグ1(公開APIでのjudgeIdマスク漏れ)が本番稼働していた期間、ジャッジIDを知った第三者は、このT008適用後も`POST /api/login`へそのIDを送るだけでログインできてしまう(`auth.ts`はjudgeId単独で新規トークンを発行する仕様のため)。T008は「新たな漏洩を止める」「既に漏洩したセッショントークンを失効させる」ところまでで、「既に漏洩したジャッジID自体を無効化する」ことはできていない。**ユーザー判断(2026-09-04)**: 再発行は不要と判断し対応見送り。このリスクは受容する(追加認証の導入を行う場合はT006本筋で改めて対応)
- T006本筋のA/B/C/D(認証強化の方向性)そのもの
- `correctedBy`列自体の廃止・スキーマ簡素化

## Implementation Owner

Claude Code

## Reviewer

Codex

## Review History

### Review 1 — 2026-09-03(方針決定段階、修正1〜3のみのドラフト)

- P0: 修正1・2(バグ2件のマスク)だけでは認証突破経路が残る。`retrieveEvidence.ts:196`が訂正Evidenceのtitleへ`judgeId`を埋め込み、裁定結果の`sources`(質問した本人へ返る)・`GET /api/stats/sources`(認証不要)経由でも露出していた → 修正4(title固定文言化)・修正5(`source_reference_stat`の移行)を追加して反映
- P1: judgeIdは既に公開APIから取得可能だった唯一の認証情報のため、漏洩箇所を塞ぐだけでは過去に取得されたIDを無効化できない。認証強化(T006本体)完了までの間の対応が必要 → 修正4で新規漏洩は停止。ジャッジID自体の再発行は運用判断としてOut of Scopeに明記しユーザーへ報告する対応とした
- P1: 漏洩済みBearerトークン(生セッショントークン)の失効が対象外になっていた。セッションに有効期限が無いため、`corrected_by`を上書きするだけでは漏洩トークンが無期限に有効なまま → 修正6(該当`judge_session`の削除)を追加。`corrected_by`上書きより先にDELETEを実行する順序を明記・実装・テストで担保
- P2: 無条件UPDATEは旧LINE時代のレコード(`judge_id=''`)の`corrected_by`を不可逆に消しうる → `WHERE corrected_by != judge_id`で対象を限定(`judge_id=''`のレコードは`corrected_by`も通常`judge_id`と異なる値のはずだが、影響範囲を本番マイグレーション実行前にRender Web Shellで事前確認することを推奨。実装のUPDATE文自体は無条件対象を避ける条件を追加済み)
- P2: 公開レスポンスを`judgeId: ""`にするとモバイルの`usage_stats_screen.dart`が空表示になる。回帰テストも不足 → 表示側を固定文言に変更、`retrieveEvidence.test.ts`・`migrateCorrectionCredentials.test.ts`を新規追加

### Review 2 — 2026-09-03(実装後)

- P0: なし
- P1: 既に漏洩したjudgeId自体が引き続き有効なログイン資格情報のまま(`auth.ts`がjudgeId単独で新規トークンを発行する仕様のため)。訂正履歴のある全ジャッジID・特に管理者IDを再発行するか追加認証を導入するまでセキュリティ対応完了とは扱えない → コードでは解決不可(認証方式自体の変更が必要、T006本筋の範囲)。「Out of Scope・残る既知のリスク」として明記し、ユーザーへ強く推奨する形で反映
- P1: 過去の裁定結果(`ruling_job.result_json.sources`)に残る旧title(judgeId入り)が移行対象外だった。ジョブ/スレッドAPI経由でそのまま返り、スレッド付きジョブは無期限保持される → `rulingJobRepository.ts`に`migrateLegacyCorrectionTitlesInResultJson()`を追加し、`migrateCorrectionCredentials()`の同一トランザクションに組み込んで反映
- P2: 全訂正へ同一の固定titleを設定したため、`produceRuling.ts`のtitleベース照合で複数訂正が衝突し別訂正へ誤帰属しうる → titleに`#${correction.id}`(秘密ではない内部連番)を含めて一意化し反映。当初の「既知の限界として受容」という判断を撤回し、実際に解消した
- P2: corrections.tsのPOST/GETの主要なセキュリティ変更にroute-levelの回帰テストが無い(supertest等未導入のため自動化できず) → 一時DB・ローカルサーバーでのcurl実機確認で代替し、Verificationへ記録

対応後の再検証: `npm run typecheck`・`npm test`(45ファイル/270テスト)PASS、`cd mobile_app && flutter analyze`(0 issues)PASS、route実機確認(curl)で`correctedBy`/`judgeId`のマスクを確認。
