# T008: 訂正関連の情報漏洩バグ2件の先行修正(T006 Review 1で発覚)

Status: **再オープン継続中(2026-09-05)**。`ruling_job.result_json`に旧title(judgeId入り)が残存している問題に対し、通常移行(`migrateLegacyCorrectionTitlesInResultJson`)は「フィールド値全体が旧title形式と完全一致する場合のみ自動置換する」設計(`buildLegacyTitles`、`Set<string>`による完全一致比較)で安全側に収束済み(round14で確定、round17でSet<string>化、詳細はReview History参照)だが、**まだ本番へデプロイ・再実行していない**。

この完全一致方式では自動解消されない既知の残存1件(explanation文中への全角括弧embedded形式)について、round18〜21では自動修復までを行う専用スクリプト(部分置換→フィールド値全体の非表示化→検証トークンによるTOCTOU対策、と設計を重ねた)を構築したが、**round22(2026-09-05)でユーザー判断により撤回した**。この1件が守る実害(過去の裁定結果1行への埋め込み)に対し、自動化の安全性コストが見合わないと判断したため。**現行方針**: 診断(対象jobIdの特定、読み取り専用スクリプト`src/scripts/findUnresolvedLegacyCorrectionTitleJobIds.ts`)と修復(運用者がRender Web Shellから対象jobIdへ直接UPDATE)を分離する。詳細・手動対応手順は下記「方針の再検討・撤回(round22)」参照。

**完了条件**: 本番デプロイ後に通常移行を再実行し、上記の既知残存1件を手動対応した上で、`unresolvedRulingJobResultJsonMarkerCount`・`invalidRulingJobResultJsonCount`・`possibleKnownIdCollisionRulingJobResultJsonCount`のいずれも0件になることを確認する。`possibleKnownIdCollisionRulingJobResultJsonCount`のみ非ゼロの場合は、手動確認の上で誤検知(数字の偶然の一致)と判断できれば例外的に完了として扱ってよい。この「0件」は取得可能な既知ID一覧・既知ラベルパターンに基づく限定的な保証であり、削除済みIDが未知の言い回しへ言い換えられているケースまでは検出できない(無条件の保証ではない、下記Out of Scope参照)。

**過去のインシデント(対応済み)**: このタスクの記録中に実際のジャッジIDを誤って平文でファイルへ記載する事故が2回発生したが、いずれも伏字修正・当該ジャッジIDの無効化(DB削除+`VALID_JUDGE_IDS`からの除外)まで完了済み(下記Review History・実装サマリー参照)。ジャッジID自体の再発行見送りの判断(下記「Out of Scope」参照、この追加インシデントとは別の一般的なリスク受容の話)は既に確定済みのまま変更なし。

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
- **残作業(この回で解消済み、下記「2回目の残存発覚と設計変更」参照)**: ~~Renderのデプロイが反映された後、`node dist/scripts/migrateCorrectionCredentials.js`をRender Web Shellから再実行し(冪等なため安全に再実行可能)、`result_json LIKE '%ジャッジID:%'`が0件になることを読み取り専用クエリで再確認する。~~ → 2026-09-04、ユーザーが実際に再実行したところ、以下の通り**さらに1件の残存が発覚**した。

**2回目の残存発覚と設計変更(2026-09-04)**: ユーザーがRender Web Shellから`node dist/scripts/migrateCorrectionCredentials.js`を再実行したところ、`ruling_job.result_json`の移行件数は1件のみで、事前確認していた残存2件のうち1件しか解消しなかった。

- **原因調査の経緯**: 読み取り専用クエリで残存件数を確認しようとしたところ、Render Web Shell(ブラウザ自動化によるxterm.js端末)への`type`操作で日本語(CJK)文字が正しく送信されずドロップされる不具合があり、初回の調査クエリが実際には`LIKE '%ジャッジID:%'`ではなく緩い`LIKE '%ID:%'`で実行されてしまい、誤った残存件数(2件)を報告していた。`String.fromCharCode(コードポイント)`でJIS X 0201外の文字を構成する回避策で正しいクエリを再実行し、残存1件を正確に特定した(この調査中も実際のジャッジIDは一切画面に表示・記録していない)。
- **判明した原因**: 残存していた1件は`sources`配列のtitleではなく、**LLMが生成したexplanation文中で「過去の訂正事例」を全角括弧「（）」で言い換えていた箇所**(例: 「なお、これは過去の訂正事例（ジャッジID:xxxx）とは論点が異なる。」)だった。当初の正規表現は半角括弧`()`のみを前提としており、この第3の亜種にマッチしていなかった。
- **設計変更(Codexレビューを複数回実施、各回で検出された指摘は全件対応済み。詳細は下記1〜5)**:
  1. 正規表現へ全角括弧の対応を追加しようとしたところ、Codexレビューで「半角開き+全角閉じのような不一致な括弧を許容すると、閉じ括弧を探して別フィールドの境界まで飛び越えresult_jsonを破損させる」P1指摘を受け、開き/閉じを同じ種類同士でのみ対応させるalternationへ修正。
  2. さらに、自作した回帰テストで「同一フィールド内に閉じ括弧が無く、後続の無関係なフィールドに同種の閉じ括弧がある」場合はalternationだけでも越境しうることを実際に検出。**根本対応として、生のJSON文字列全体に正規表現を適用するのではなく、`JSON.parse`で文字列値ごとに分解してから個々の文字列にだけ正規表現を適用し、`JSON.stringify`で再構成する設計(`migrateLegacyCorrectionTitlesInValue`)へ変更した**。これにより、置換範囲が各フィールドの内部に構造的に限定され、フィールド境界を越える破損が原理的に起こらなくなった。
  3. Codexから「今回だけで表記揺れが3回発覚しており、既知の正規表現を追加する方式ではセキュリティ移行の完了を保証できない」との指摘を受け、置換を試みた後も「ジャッジID」という広い部分一致マーカーが残っている行を検出・報告する仕組みを追加。JSON解析に失敗した行も未解決として報告する。
  4. **Codexレビュー4回目で追加P1 2件**: (a) SELECT側の絞り込みはJSON内でUnicodeエスケープ(例: JSON文字列としては`ジ...`のような形でシリアライズされているが`JSON.parse`後には「ジャッジID」になるケース)を検出できないとの指摘を受け、SELECT自体の絞り込みを廃止し`result_json IS NOT NULL`の全件を対象に`JSON.parse`後判定する設計へ変更(本番のruling_job件数は1回限りの移行として許容できる規模のため)。(b) 未解決行のjobIdをログ・CLI出力へそのまま出す設計は、その行がまだジャッジIDを含んでいることを意味するため、認証不要の`GET /api/ruling/jobs/:jobId`から直接その内容を取得できる新たな開示経路になるとの指摘を受け、**jobIdを一切出力せず件数のみを扱う設計に変更**。JSON解析失敗時のログも`error.message`(元の文字列断片を含みうる)を出さないよう変更。
  5. **Codexレビュー5回目で追加P1 1件・P2 2件**: P1: 完全一致の「ジャッジID」だけでは、LLMが将来「ジャッジＩＤ」(全角英数字)・「ジャッジ ID」(空白入り)・「Judge ID」(英語表記)等へ言い換えた場合に検出漏れが起こりうるとの指摘を受け、`String.prototype.normalize("NFKC")`で全角英数字・全角スペースを半角相当へ正規化した上で、「ジャッジ」+空白0文字以上+「ID」または「Judge」+空白0文字以上+「ID」(大小文字を問わない)を検出するパターンへ変更(負例テスト「ジャッジ」と無関係な「ID」が離れて登場するだけでは誤検知しないことも追加)。P2: JSON解析失敗(内容不明)と表記揺れ残存を同じカウントで扱うと原因が区別できないとの指摘を受け、`unresolvedCount`を`unresolvedMarkerCount`(表記揺れ残存)と`invalidJsonCount`(解析失敗)へ分割。P2: CLIの終了コード契約(未解決1件以上で非ゼロ終了・jobIdを出力しない)に直接の回帰テストが無いとの指摘を受け、`migrateCorrectionCredentials.ts`のロジックを`runMigration()`関数へ分離し、`tests/migrateCorrectionCredentials.script.test.ts`で終了コード・出力内容(jobId文字列が含まれないこと)を直接検証するテストを追加。
  6. **Codexレビュー6回目で追加P1 2件・P2 1件**: P1: ラベルの表記揺れ検出をいくら追加しても、LLMが全く別の言い方(「公認ジャッジ番号」等)で言い換えた場合は原理的に検出しきれないとの指摘を受け、`judge`・`correction`テーブルから現在・過去に実在したジャッジID値そのものを集め、result_json内にその値が文字列として直接残っていないかも監査する仕組みを追加(`migrateLegacyCorrectionTitlesInResultJson`に`knownJudgeIds`引数を追加)。P1: `STATUS.md`・本ファイルがT008を依然Completed/旧状態のまま扱っており、次の担当者がデプロイ済みと誤認しうるとの指摘を受け、初回修正(完了済み)と残存データ移行(再オープン中)をSTATUS.mdのCompleted/In Progressへ明確に分離。P2: CLIの例外経路で`String(error)`をそのまま出力すると将来jobId等の機微情報を含みうるとの指摘を受け、固定の一般メッセージ(例外の種類のみ)に変更。
  7. **Codexレビュー7回目で追加P1 2件・P2 1件**: P1: 上記6.で追加した既知ID値監査が、短い数値ID(過去のインシデントで実際に4桁数値だった)をルール番号・URL・型番等と誤検知し、CLIが恒久的に終了コード非ゼロを返し続ける危険があるとの指摘を受け、**既知ID値との一致は`unresolvedMarkerCount`(CLIの終了コードを左右する)には含めず、`possibleKnownIdCollisionCount`という参考情報専用の別カウントへ分離**(誤検知が多いことを前提に、CLIは件数のみ表示し終了コードには影響させない)。負例テスト(4桁数値IDがURL末尾に偶然含まれるケース)を追加。P1: Unicodeエスケープ検出の回帰テストが、実際に渡されたSQL文の内容を検証しておらず、将来SELECT側にLIKE絞り込みが再導入される回帰を検出できないとの指摘を受け、`db.prepare`へ渡されたSQL文が`result_json IS NOT NULL`を含み`LIKE`を含まないことを直接検証するアサーションを追加。P2: タスク冒頭の完了条件が実装(`unresolvedRulingJobResultJsonMarkerCount`・`invalidRulingJobResultJsonCount`)と食い違っていたため、本ファイル冒頭を修正。
  8. **Codexレビュー8回目で追加P1 1件・P2 2件**: P1: `possibleKnownIdCollisionCount`(既知ID値との一致)を1件以上でも終了コード0(成功)にしていたが、過去のインシデントで実際に漏洩したIDが4桁数値だった実績を踏まえると、「誤検知の可能性が高い」ことを理由に無条件で成功扱いにすると本物の残存も見逃しうるとの指摘を受け、**この件数も1件以上あれば終了コード1(要確認、確定ではない旨を明示)にするよう変更**。あわせて既知ID値側・JSON文字列側の双方をNFKC正規化していなかった(全角数字等へ変形されたIDを検出できない)不備も修正。P2: `migrateLegacyCorrectionTitlesInValue`のオブジェクト再構築が`{}`へのブラケット代入(`updated[key] = ...`)だったため、JSONに`"__proto__"`というキーがあった場合に通常のプロパティ代入ではなくプロトタイプのsetterが呼ばれ、そのキーが欠落しうる不備を指摘され、`Object.fromEntries()`による再構築へ変更(回帰テスト追加)。P2: AGENTS.mdのDefinition of Doneが要求する`flutter analyze`の実行記録が無かったため実行し、0 issuesを確認(下記検証欄に記録)。
  9. **Codexレビュー9回目で追加P1 2件(修正済み)・P1 2件(意識的に見送り)**: P1(修正): 上記8.で「1件以上あれば非ゼロ終了」に変更したにもかかわらず、実装のコメント・本ファイル冒頭・STATUS.md・テストの複数箇所に「CLIの終了コードには影響させない」「自動判定には使わない」という旧仕様の記述が残っており、担当者が非ゼロ終了を無視して完了扱いにする原因になりうるとの指摘を受け、該当箇所をすべて現行仕様に統一。P1(修正): 未解決マーカーまたは解析失敗がある場合に最初の`if`で直ちに`return 1`していたため、同時に既知ID衝突があってもその件数がCLI出力から欠落する不備を指摘され、3種類の件数を独立に(いずれもログ出力してから)判定するよう修正(3種類が同時発生するケースの回帰テストを追加)。P1(**意識的に見送り、下記参照**): (a)本番ビルドの`node dist/scripts/migrateCorrectionCredentials.js`という実行経路自体(`require.main === module`のガード)を、実ビルド成果物の子プロセス起動で検証するテストが無い。(b)新設した`tests/migrateCorrectionCredentials.script.test.ts`はこの時点でgit未追跡("??" as `git status`)だった。
    - **(a)への対応方針**: このリポジトリの`src/scripts/`配下には他に6本のスクリプトがあるが、いずれも実行経路(エントリーポイント判定・ビルド成果物の起動)を検証するテストの前例が無い(既存の慣行が無い)。`require.main === module`はNode.jsの標準的なCommonJSイディオムであり、`tsconfig.json`の`"module": "commonjs"`も固定設定のため、ESM化による`require`未定義のリスクは現時点では低い。本タスク単体で新しいテスト慣行(ビルド+子プロセス起動のスモークテスト)を導入するのはスコープが大きく、実質的なロジック(`runMigration`本体)は既に`tests/migrateCorrectionCredentials.script.test.ts`で厚くカバーされているため、**このリスクは意識的に受容し、対応は見送る**(将来的にビルド成果物のスモークテストという慣行自体を導入する場合は、本タスクではなく別タスクとして扱う)。
    - **(b)への対応**: 最終コミット時に`tests/migrateCorrectionCredentials.script.test.ts`を明示的にステージングへ含める(通常のgit操作で対応、コード変更は不要)。
  10. **Codexレビュー10回目で追加P1 1件(根本的な設計変更、修正済み)**: ジャッジIDの入力検証(`judges`ルートの`z.string().min(1).max(100)`)は文字種を一切制約していないため、実際にはIDの値自体に半角/全角の閉じ括弧が含まれるケースがありうる。この場合、汎用の文字クラス(`[^)）]*`のような「最初の閉じ括弧までをIDとみなす」パターンでは、ID自体の閉じ括弧の手前で置換が止まり断片(例: `JUDGE)SECRET`というIDに対し`過去の訂正事例(ジャッジID:JUDGE)`だけを置換し`SECRET)`が残る)が生じる。しかも置換後は「ジャッジID」ラベルも既知ID値そのものも文字列中に存在しなくなるため、`unresolvedMarkerCount`・`possibleKnownIdCollisionCount`のいずれにも引っかからず、**移行が誤って完全成功扱いになってしまう**との指摘を受けた。**根本対応として、IDの範囲を汎用パターンで推測する設計を廃止し、呼び出し元(corrections/repository.ts)が集めた既知のジャッジID値そのものを使って、その値と完全一致する旧title文字列だけを厳密に置換する設計(`buildLegacyTitlePatterns`)へ全面的に変更した**。IDの値がどんな文字を含んでいても、置換対象の範囲は常にその値の実際の長さと一致するため、断片が残る余地が構造的に無くなった。回帰テスト(IDに閉じ括弧を含むケースで、断片が残らずJSONとしても有効なまま完全一致で置換されることを確認)を追加。この設計変更に伴い、既存の回帰テスト群も`knownJudgeIds`を明示的に渡す形へ更新した(本番の呼び出し元は常に`knownJudgeIds`を渡すため、テストも実際の使われ方に合わせた)。
  11. **Codexレビュー11回目で追加P1 1件(修正済み)**: 上記10.の完全一致置換設計は、既知IDのDB取得順のままパターンを適用していたため、短いID(例: `JUDGE`)が、それを前方一致で含む別の実在する長いID(例: `JUDGE)SECRET`)より先に存在する場合、短い方が先にマッチして`SECRET)`という断片を残してしまう不備を指摘された(ジャッジIDは文字種無制約のため、2人の異なるジャッジのIDが前方一致関係になることは実際にありうる)。**既知ID一覧を文字列長の降順に並べ替えてからパターンを生成するよう修正し、最長一致を優先させることで解消した**(短いIDが先に存在しても、長いIDのパターンが先に試され全体を一括で正しく置換する)。回帰テスト(短いIDと長いIDが同時に存在するケースで断片が残らないことを確認)を追加。
  12. **Codexレビュー12回目で追加P1 2件(1件修正済み・1件は意識的に残存リスクとして記録)・P2 1件(修正済み)**:
    - **P1(修正済み)**: `containsJudgeIdMarker`・`containsAnyKnownJudgeId`が値だけを検査しJSONのキー自体を検査していなかったため、仮に「ジャッジID」ラベルや既知ID値がキーとして紛れ込んだ場合に検出できない不備を指摘された。現状の`RulingResult`は`conclusion`・`explanation`・`sources`等の固定スキーマのキー名のみを使うため実際には起こらないが、将来の構造変更に備えた多層防御として、`Object.entries()`でキーも検査するよう修正(キー自体は自動置換の対象にはしない。回帰テスト追加)。
    - **P1(初版では意識的に残存リスクとして記録したが、Codexレビュー13回目の再指摘を受け根本対応、下記13.参照)**: 既知ID一覧(`knownJudgeIds`)は`judge`・`correction.judge_id`から集めるが、`correction`は`DELETE FROM correction WHERE id = ?`により削除されうる(`src/corrections/repository.ts`に実装あり。実際、本セッションでも`judge`テーブルからの削除を複数回実施した実績がある)。ある訂正とそれに紐づくジャッジが両方とも削除された場合、その削除済みジャッジIDは`knownJudgeIds`から完全に失われる。もしそのIDが、現在も実在する別の(より短い)ジャッジIDの前方一致になっており、かつそのIDが埋め込まれた旧title文字列が過去に`ruling_job.result_json`へ既に保存されていた場合、短い方の既知IDのパターンが部分的に一致し断片が残る(そしてラベル・既知ID値のいずれも消えるため未解決として検出されない)可能性が理論上残る。
    - **P2(修正済み)**: 「未解決マーカー・解析失敗・既知ID衝突が同時に存在する」回帰テストが解析失敗の件数の出力を検証していなかったため、アサーションを追加。
  13. **Codexレビュー13回目**: 上記12.のP1(削除済みIDの前方一致問題)について、「発生確率は極めて低い」という当初の判断根拠(削除APIは実在し本セッションでも実際に使用した実績があるため、単なる仮定とは言い切れない)を再指摘され、**根本対応を実施**。既知ID一覧の完全性に頼る設計そのものを見直し、置換パターンの末尾に「直後に半角英数字が続く場合はマッチさせない」負の先読み(`(?![A-Za-z0-9])`)を追加した。正規の旧title(半角/全角括弧のいずれか)の閉じ括弧の直後は、必ず日本語の助詞・句読点または文字列終端であり、IDの残り部分(実務上ほぼ英数字)が直接続くことは無いため、この先読みだけで「IDの途中で止まった誤ったマッチ」を、既知ID一覧の完全性に一切依存せず構造的に排除できる。回帰テスト(本来のID`JUDGE)SECRET`が訂正・ジャッジ双方の削除により既知一覧から失われ、現存する短いID`JUDGE`しか渡せない状況を再現し、誤った断片化置換が起きず正しく未解決として検出されることを確認)を追加。既存の正常系(半角スペース有無・全角括弧・文字列末尾での使用)が壊れていないことも実SQLiteの検証スクリプトで再確認済み。
  14. **Codexレビュー14回目でP1 2件・P2 1件(いずれも修正済み)**:
    - **P1(根本対応)**: 上記13.の負の先読み`(?![A-Za-z0-9])`は「正規の閉じ括弧の直後には半角英数字が続かない」という前提に立っていたが、この前提自体が誤りだった(ジャッジIDは文字種無制約のため、削除済みIDの残り部分が全角文字・ひらがな・漢字・記号であってもおかしくない)。具体的には、削除済みの本来のIDが`JUDGE)秘密`で現存する短いIDが`JUDGE`の場合、次の入力で先読みを素通りしてしまう: `過去の訂正事例(ジャッジID:JUDGE)秘密)` → `過去の訂正事例(公認ジャッジによる記録)秘密)`。置換後はラベル「ジャッジID」も既知ID値`JUDGE`も文字列中から消えるため、`unresolvedMarkerCount`・`possibleKnownIdCollisionCount`のいずれにも引っかからず、**移行が誤って完全成功扱いになってしまう**。文字クラスをどれだけ拡張してもIDの終端を汎用的に推測することはできないため、「終端の推測」自体をやめる設計に変更した: `buildLegacyTitlePatterns`を`^...$`で文字列全体の完全一致のみを判定するアンカー付きパターンへ変更し、`migrateLegacyCorrectionTitlesInValue`も部分置換ではなく「完全一致した場合にフィールド値全体を置き換える」方式にした。これにより、旧titleがフィールド値そのもの(`sources[].title`等)であるケースは従来通り正しく置換されるが、旧titleがLLM生成のexplanation文など**より長い文字列に埋め込まれているケースは自動置換の対象外**とし、`unresolvedMarkerCount`により未解決として検出させ手動確認に回す設計へ変更した(既知ID一覧の完全性・負の先読みのような「一致直後に何が続くか」の推測に一切依存しない)。この設計変更により、既知ID一覧の並び順に依存する最長一致ソートも不要になったため削除した。回帰テスト(削除済みIDの残り部分が漢字であるケースを含む複数パターン)を追加し、実SQLiteの検証スクリプトでも旧設計なら誤って成功扱いになっていた入力が正しく未解決として検出されることを確認した。
    - **P1(修正済み)**: 新設した`tests/migrateCorrectionCredentials.script.test.ts`がgit未追跡のまま提示されており、最終コミットに含める前提の対応(上記9.の(b))がまだ実施されていなかった → 最終コミット時に明示的にステージングへ含める(下記「残作業」参照)。
    - **P2(修正済み)**: 未解決マーカーの検出(`unresolvedMarkerCount`)と既知ID値一致の検出(`possibleKnownIdCollisionCount`)が`if`/`else if`の排他分岐になっており、同じ行に両方が存在する場合に後者が計上されず、手動調査に必要な情報が欠落する不備を指摘された → 2つの検査を独立した`if`に変更(両方成立する行では両方のカウントに計上される)。回帰テストを更新して両方が同時に1になることを確認。
  15. **Codexレビュー15回目でP1 3件(いずれも対応済み・一部は完了条件の明文化で対応)**:
    - **P1(ドキュメント上の誤り、修正済み)**: 上記14.の設計変更(完全一致アンカー化)は、本番に現在も残っている既知の残存1件(「2回目の残存発覚と設計変更」で判明した、explanation文中への全角括弧embedded形式)を**自動では解消しない**(この行はフィールド値全体ではなく説明文への埋め込みのため)。にもかかわらず、当時追加した回帰テストのコメントに「対象データは本番では既に旧設計で修正済み」という誤った記載があり、本ファイルの「残作業」も「再実行して終了コード0を確認する」とだけ書いており、この既知の非ゼロ終了が想定内であることが手順化されていなかった(実際には本番のどの過去デプロイもこのexplanation embedded形式を解消したことは一度も無い。「デプロイ完了(2026-09-04)」の項目で反映されたのはコロン直後のスペース有無のみ)。テストコメントを修正し、下記「残作業」にこの既知の非ゼロ終了と手動での個別対応手順を明記した。
    - **P1(構造的な検出限界、完了条件の明文化で対応)**: `knownJudgeIds`は現存する`judge`・`correction`テーブルからのみ収集するため、**訂正・ジャッジの両方が削除され、かつ本文中の言い回しが「ジャッジID」等の既知ラベルパターンにも一致しない形へ言い換えられているケース**は、既知ID値監査(`possibleKnownIdCollisionCount`)・ラベル検出(`unresolvedMarkerCount`)のいずれにも引っかからず、3カウントすべてが0のままIDが文字列中に残り続ける可能性が原理的に排除できない(削除済みIDを監査目的で保持する仕組み〈tombstone〉が無いため)。この解消には、ジャッジ・訂正の削除フロー自体に手を入れて削除済みIDの監査専用の履歴を残す仕組み(スキーマ追加を伴う)が必要になるが、これは「削除したはずの機微情報をどこまでの期間・形式で保持するか」というデータ最小化上のトレードオフを伴う設計判断であり、本タスク(先行漏洩の応急修正)のスコープを超え、T006(認証強化)側での方針検討に委ねるべきと判断した。**このタスクの完了条件を「取得可能な既知ID一覧・既知ラベルパターンに基づく0件」に限定して明記し(下記Acceptance Criteria・Out of Scope参照)、無条件の「ジャッジID残存ゼロの保証」ではないことを明文化した**(Codexレビュー指摘の通り、この限定を明記しないまま完了扱いにするのは過大な保証になるため)。
    - **P1(修正済み)**: 新設した`tests/migrateCorrectionCredentials.script.test.ts`が、上記14.の時点でもまだgit未追跡のままだった → 本ラウンドで`git add`により追跡対象へ含めた(コミット前に`git status`で確認する)。
  16. **Codexレビュー16回目でP2 2件・P3 1件(いずれも修正済み、重大な問題は無し)**: P2: `tests/migrateCorrectionCredentials.script.test.ts`のjobId非開示アサーションが`/job-[\w-]+/`という形式依存の否定マッチだったため、"job-"で始まらないUUID等の実際のjobId形式が将来出力に混入しても検出できない不備を指摘され、固定テンプレート文言との完全一致(`toBe`)へ変更(テンプレートに変数が新たに紛れ込む変更自体を検出できるようにした)。P2: `rulingJobRepository.ts`の`knownJudgeIds`引数のコメントが「参考情報としてのみ使用」となっていたが、実際には`buildLegacyTitlePatterns`(自動置換対象の決定)にも使われており実態と食い違っていた不備を指摘され、コメントを訂正。P3: 完了条件の表現がSTATUS.mdと本ファイルで微妙に食い違って読める余地があったため、「原則3件数すべて0。既知ID衝突のみの場合は手動で誤検知と確認できれば例外的に完了」という一文へ両ファイルとも統一。
  17. **Codexレビュー17回目でP1 1件・P2 2件(いずれも修正済み)**:
    - **P1(修正済み、実データ損失防止)**: 上記の「手動での個別対応手順」3.cの当初案が「対象フィールドの値全体(または該当する埋め込み部分)を固定文言へ置き換える」という曖昧な表現になっており、フィールド値全体(explanation本文全体)を固定文言だけに置き換えると裁定理由の本文が失われる実害があるとの指摘を受けた。本番DBへ直接UPDATEする手順であるため、この曖昧さは実データ損失に直結する。**手順を「本文を保持したまま、埋め込まれた旧title部分文字列だけを取り除く」に限定し、更新前の`result_json`を条件に含めた楽観的並行性制御(`WHERE id = ? AND result_json = ?`)、更新後のJSON解析・本文保持・マーカー消失の3点確認を明記した**。
    - **P2(実装で対応、独立検証済み)**: `buildLegacyTitlePatterns`の`^...$`アンカー付き正規表現について、「JavaScriptの`$`は文字列末尾の改行の直前にも一致しうるため、完全一致の保証が崩れる」との指摘を受けた。**この具体的な懸念は実際にはJavaScript(mフラグ無し)には当てはまらないことをNode.jsで直接検証済み**(`/^abc$/.test("abc\n")`は`false`。他に`\r\n`・uフラグでも同様に確認)。ただし、この検証自体が将来のレビュー・保守のたびに再確認を要する正規表現の意味論への依存である点は変わらないため、指摘の根拠の正確性とは独立に、より単純で疑いの余地が無い設計として`buildLegacyTitlePatterns`(正規表現)を`buildLegacyTitles`(既知ID値ごとの完全一致する旧title文字列の`Set<string>`)へ置き換え、`migrateLegacyCorrectionTitlesInValue`も`Set.has()`による直接比較へ変更した(これにより`escapeRegExp`ヘルパー自体も不要になり削除した)。回帰テスト(末尾に改行が付いた文字列が完全一致とみなされないこと)を追加。
    - **P2(修正済み)**: 「残作業」の手動対応後の確認手順が`unresolvedRulingJobResultJsonMarkerCount`のみへの言及に留まっており、正式な完了条件(3種類すべて)と食い違って見える不備を指摘され、3種類すべてを確認する手順へ統一した。
  18. **Codexレビュー18回目でP1 1件・P2 2件(いずれも修正済み)**:
    - **P1(修正済み、専用スクリプトの新設)**: 上記17.で精緻化した「手動での個別対応手順」も、依然として本番の`id`・`result_json`をRender Web Shellの画面へ表示し、実際のジャッジIDを一時スクリプトの文字列定数へ書き写すことを求めていた。このタスクでは既に転記による漏洩が2回発生しており、「書き残さない」という運用上の注意だけでは同じ経路の再発を防げない(Render Web Shellの画面表示・ブラウザ自動化のキャプチャ・シェル履歴・一時ファイルのいずれにも残りうる)との指摘を受けた。**根本対応として、raw JSON・jobId・ジャッジIDを一切出力・入力せずにDB内部で完結する専用の復旧関数・スクリプトを新設した**(`repairEmbeddedLegacyCorrectionTitles`・`replaceEmbeddedLegacyTitlesInValue`〈`rulingJobRepository.ts`〉、`getKnownJudgeIdsForLegacyTitleAudit`〈`corrections/repository.ts`、`migrateCorrectionCredentials`と共通化〉、CLIラッパー`src/scripts/repairEmbeddedLegacyCorrectionTitle.ts`)。既知のジャッジID値から構築した旧title文字列を部分文字列としてリテラル置換する設計で、前方一致するID同士への配慮(長い順に適用、round 11と同種)も反映した。既知一覧から失われた削除済みIDによる断片化リスク(round 12〜14と同種)は部分文字列置換である以上解消できないが、この関数は少数の特定済みの行だけを対象にした一回限りの人間監督下の復旧作業専用(全件に対する常時自動実行ではない)であるため、通常の移行(`migrateLegacyCorrectionTitlesInResultJson`、常にフィールド値全体との完全一致のみを自動置換対象とする設計を維持)とは異なる基準でこのリスクを許容する設計とした。dry-run(既定)で件数を確認してから`--apply`で明示的に反映する2段階の運用にし、回帰テスト(埋め込みケースの修復・楽観的並行性制御・dry-runでUPDATEを呼ばないこと・未知の表記揺れが残る場合はstillUnresolvedとして報告することなど)を追加。実SQLiteでの検証スクリプトでも、通常の移行では未解決のまま残る埋め込みケース(全角括弧・前方一致ID)がこの復旧スクリプトで正しく修復され、無関係な本文が保持されることを確認した。
    - **P2(修正済み)**: `runMigration()`が3種類の監査件数を非ゼロの場合だけ`logError`で出力しており、正常終了(すべて0件)の場合は件数が出力に一切現れず、Web Shellの操作者が「0件だったこと」と「確認自体を見落としたこと」を出力だけからは区別できない不備を指摘され、成否にかかわらず3種類の件数を常に`log`で出力するよう修正(正常系・異常系の両方の回帰テストを更新)。
    - **P2(修正済み)**: `rulingJobRepository.ts`・`migrateCorrectionCredentials.ts`に、既に廃止した`LEGACY_CORRECTION_TITLE_PATTERN`(固有名詞)・「既知の正規表現」といった、正規表現ベースの旧設計を前提にした説明が残っており、将来の修正者が現在の保証条件(`Set<string>`による完全一致比較)を誤認する原因になりうるとの指摘を受け、該当箇所を現行の設計に合わせて訂正した。あわせて、コード側のコメントに残っていた過去の設計変遷の詳しい経緯を圧縮し、詳細は本ファイルのReview History参照とする形に整理した。
- **検証**: `npm run typecheck`・`npm test`(49ファイル/367テスト)・`cd mobile_app && flutter analyze`(0 issues、今回の差分はバックエンドのみだが形式的な完了条件のため実行)すべてPASS。実際のSQLite(node:sqlite)に対する検証スクリプトで、半角スペース有無・全角括弧の2パターンが正しく移行されること、閉じ括弧を含むジャッジID(`JUDGE)SECRET`)でもフィールド値全体が完全一致していれば断片を残さず置換されること、短いIDと長いID(前方一致関係)が同時に存在しても文字列全体の完全一致比較により短い方が誤ってマッチしないこと、本来のIDが既知一覧から失われていても(完全一致比較により、残り部分が英数字であっても漢字であっても)誤った断片化置換が起きないこと、末尾に改行が付いた文字列は完全一致とみなされないこと、Unicodeエスケープ・全角ＩＤ・空白入り・英語表記の4種類の未知の表記揺れが`unresolvedMarkerCount`で正しく検出されること、既知ID値のみの一致(ラベル無し)は`possibleKnownIdCollisionCount`に分離されること、同じ行に両方が存在する場合は両方が計上されること、短い数値ID(4桁)がURL等に偶然含まれても`unresolvedMarkerCount`には計上されないこと、無関係なフィールドが破壊されないこと、全行が移行後も有効なJSONのままであることに加え、通常の移行では未解決のまま残る埋め込みケース(全角括弧・前方一致ID)が`repairEmbeddedLegacyCorrectionTitles`で正しく修復され、dry-runでは実際に更新しないこと、本文が保持されることを確認済み(検証用スクリプトは実行後に削除済み。`DATABASE_URL`は毎回シェルの環境変数として渡す方式を徹底し、実際のローカル開発用DB〈`data/cache.db`〉が汚染されていないことも都度確認済み)。
- **残作業**:
  1. この修正はまだ未コミット・未デプロイ(`tests/migrateCorrectionCredentials.script.test.ts`を含めてコミットする)。
  2. デプロイ後、ユーザーが再度`node dist/scripts/migrateCorrectionCredentials.js`をRender Web Shellから実行する。**既知の残存1件(explanation文中への全角括弧embedded形式)はこの設計変更では自動解消されないため、`unresolvedRulingJobResultJsonMarkerCount=1`(終了コード1)になることが想定内である**(0件にはならない)。これは移行スクリプトの不具合ではなく、「埋め込み文脈は自動置換しない」という今回の意図的な安全設計の結果である。
  3. **既知の残存1件への対応(Codexレビュー18回目指摘、2026-09-04で「手動でのSQL編集」手順を専用スクリプトへ置き換え)**: 旧版(round 17まで)の手順は、本番の`id`・`result_json`をRender Web Shellの画面へ表示し、実際のジャッジIDを一時スクリプトの文字列定数へ書き写すことを求めていた。このタスクでは既に転記による漏洩が2回発生しており(下記「重要な追加インシデント」参照)、「書き残さない」という運用上の注意だけでは同じ経路の再発を防げないとの指摘を受け、**raw JSON・jobId・ジャッジIDを一切出力・入力せずに完結する専用スクリプト`src/scripts/repairEmbeddedLegacyCorrectionTitle.ts`を新設した**(`repairEmbeddedLegacyCorrectionTitles()`・`replaceEmbeddedLegacyTitlesInValue()`、`rulingJobRepository.ts`)。
     - このスクリプトは、通常の移行(`migrateLegacyCorrectionTitlesInResultJson`)が意図的に自動置換しない「旧titleが説明文などへ埋め込まれたケース」を対象に、既知のジャッジID値から構築した旧title文字列(長い順、`buildLegacyTitles`)を部分文字列としてリテラル置換する(正規表現は使わない。前方一致するID同士〈round 11と同種〉への配慮として長い順に適用する)。
     - 削除済みで既知一覧から失われたIDが別の現存する短いIDの前方一致になっている場合、断片化した誤った置換が原理的に起こりうる制約(round 12〜14で発覚した問題と同種)は、部分文字列置換である以上解消されていない。ただし、この関数は`migrateLegacyCorrectionTitlesInResultJson`と異なり全件に対して常時自動実行されるものではなく、事前に`unresolvedMarkerCount`で残存が判明した少数の行だけを対象にした、人間監督下の一回限りの復旧作業専用であるため、このリスクをより限定された範囲でのみ許容する設計とした。
     - 運用手順: (a) `node dist/scripts/repairEmbeddedLegacyCorrectionTitle.js`を引数無し(dry-run)で実行し、出力される件数(`ラベル残存の対象行数`・`修復できる見込みの行数`・`既知の旧title形式では対応できず残る行数`)を確認する。想定通りの件数(この時点では1件)であることを確認する。(b) `--apply`を付けて再実行すると、楽観的並行性制御(`WHERE id = ? AND result_json = ?`)付きのUPDATEが実際に反映される。(c) 出力にはjobId・result_json・ジャッジIDのいずれも一切含まれない(件数のみ)。(d) 再度`node dist/scripts/migrateCorrectionCredentials.js`を実行し、`unresolvedRulingJobResultJsonMarkerCount`が0になったことを確認する。
     - `stillUnresolved`(既知の旧title形式では対応できない行)が1件以上残る場合、この専用スクリプトでは解消できない別の未知の表記揺れが埋め込まれていることを意味するため、その場合のみ本番DBを直接確認する(通常の運用ではここまで到達しない想定)。
  4. `possibleKnownIdCollisionRulingJobResultJsonCount`のみが非ゼロの場合、「確定した残存」ではなく「要確認」(数字の偶然の一致の可能性もある)の位置づけのため、手動確認の上で無関係と判断できた場合のみ完了として扱う。
  5. 完了条件は上記「完了条件を一文でまとめると」を参照し、`unresolvedRulingJobResultJsonMarkerCount`・`invalidRulingJobResultJsonCount`・`possibleKnownIdCollisionRulingJobResultJsonCount`の3種類すべてを再実行の都度確認する(Codexレビュー指摘、2026-09-04、round 17: 手順の一部が`unresolvedRulingJobResultJsonMarkerCount`のみへの言及に留まっていたため、3種類すべてへ統一)。上記3・4を実施してもなお3種類のいずれかが0にならない行が見つかった場合、本番DBを直接確認し、内容を踏まえて都度手動で対応方針を判断する。

## Out of Scope・残る既知のリスク(重要、ユーザーへ強く推奨)

- **この移行の「0件」は、取得可能な既知ID一覧・既知ラベルパターンに基づく限定的な保証であり、「ジャッジIDが1件も残っていないことの無条件の保証」ではない(Codexレビュー15回目指摘、2026-09-04)**。`knownJudgeIds`は現存する`judge`・`correction`テーブルからのみ収集するため、訂正・ジャッジの両方が削除され、かつ本文中の言い回しが既知のラベルパターン(「ジャッジID」等、NFKC正規化・表記揺れ込み)にも一致しない形へ言い換えられているケースは、原理的に検出できない(削除済みIDを監査目的で保持する仕組み〈tombstone〉が現状無いため)。この解消には、ジャッジ・訂正の削除フロー自体に手を入れて削除済みIDの監査専用履歴を残す仕組み(スキーマ追加を伴う)が必要になるが、「削除したはずの機微情報をどこまでの期間・形式で保持するか」というデータ最小化上のトレードオフを伴う設計判断であり、本タスク(先行漏洩の応急修正)のスコープを超えると判断した。**T006(認証強化)側での方針検討に委ねることを推奨する**(このタスクでは対応しない)。
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

### Review 19 — 2026-09-04(round18の専用復旧スクリプトに対する実装後レビュー、未反映)

- P1: `replaceEmbeddedLegacyTitlesInValue()`が既知ID由来のlegacyTitleを`replaceAll()`で部分置換しており、round11・14で一度却下したはずの「短い既知IDによる断片化置換」を再導入している。既知一覧が`["JUDGE"]`で削除済みの実IDが`JUDGE)秘密`だった場合、`過去の訂正事例(ジャッジID:JUDGE)秘密)`が固定文言+`秘密)`へ破損する。置換後はラベル・既知IDのいずれも文字列中から消えるため`containsJudgeIdMarker`が偽陰性になり、`fixed: 1 / stillUnresolved: 0`と誤って修復成功扱いになる。dry-runも同じアルゴリズムの件数を返すだけのため、人間が内容を見て監督することはできない。
- P1: `repairEmbeddedLegacyCorrectionTitles()`のUPDATE実行後、`.run(...).changes`を確認せず`fixed++`を先に行っている。楽観的並行性制御(`WHERE id = ? AND result_json = ?`)に外れて0件しか更新されなくても、CLIは「修復した行数: 1件」・終了コード0を返す。
- P1: `src/scripts/repairEmbeddedLegacyCorrectionTitle.ts`の実行関数にtry/catchが無く、下位層が投げた例外(将来jobIdや値を含みうる)がNode.jsの既定動作でスタックごと標準エラーへそのまま出る。`migrateCorrectionCredentials.ts`は同じ理由で例外本文を隠しているため設計が不統一。
- P2: `tests/repairEmbeddedLegacyCorrectionTitle.script.test.ts`の非開示テストが`/job-[\w-]+/`と`"ジャッジID:"`の否定のみで形式依存。UUID形式のjobId・空白/全角コロン・ラベル無しの実ID等は検出できない(移行CLI側で既に修正済みなのと同じテスト不足)。
- P2: `CLAUDE.md`への日本語出力ルール追加がT008の差分に混在しており、Acceptance Criteria・STATUS記録のいずれにも属さない(AGENTS.mdの「1タスクで無関係な変更を混ぜない」に反する)。
- 総評: 「現状のままのマージは推奨しない」。

**メタレビュー(2026-09-05、ユーザー指示でCodexへ別途依頼)**: round19とは独立に、「このタスクの18回のレビューラリー自体の進め方が適切だったか」というプロセス面のメタレビューをCodexへ依頼した。結論は「進め方に重大な問題なし、とは言えない」。要旨:
- round10〜14は、「文字列境界を推測して置換する」という同一の不変条件へのP1指摘が連続しており、局所パッチ(既知IDを正規表現へ組込み→長い順に並べ替え→負の先読み追加→反例発覚)を繰り返す「もぐら叩き」になっていた。round10(IDは文字種無制約と判明)、遅くともround12(削除済みIDにより既知一覧が不完全になりうると判明)の時点で、「対象範囲を推測せず、完全一致で一意に証明できる場合にだけ自動更新する」という設計原則へ引き上げる判断ができたはず。
- round18の専用復旧スクリプトは、通常移行(round14で完全一致方式に収束済み)が意図的に捨てた「部分文字列への境界推測」を再導入しており、上記Review 19のP1として実際に的中した。
- 本番投入前の「dry-run→件数種別分離→非ゼロなら完了扱いしない」という契約は後付けで整備された。
- ジャッジID平文記載インシデント2件の再発防止は、round18の専用スクリプトだけでは不十分(`stillUnresolved`非ゼロ・既知ID衝突の手動確認・未知の言い換え調査の各ケースでは、依然として本番DBを直接見る経路が残っている)。
- 良かった点: 独立レビュー自体は有効に機能しており、指摘を無視した形跡はない。当初の2経路以外(Evidence表示・統計API・過去ジョブ)まで芋づる式に発見・修正できたのは、レビューサイクルの成果。
- 提言: round19を通常の差分レビューとしてではなく、安全性の不変条件を明文化した上での再基準化として扱う。「同一不変条件に関するP1が2回続いたら局所修正を止め、方針決定段階のレビューへ戻す」という停止条件を今後のプロセスへ導入する。

### 対応方針ドラフト(round19指摘への対応、2026-09-05、実装前レビュー依頼中)

#### P1-1(最重要・設計判断が必要): 断片化置換の再導入への対応

現状の設計(`buildLegacyTitles`で構築した既知ID由来の旧title文字列を`replaceAll`で部分置換し、`containsJudgeIdMarker`でラベルが消えたことだけを成功の根拠にする)は、既知一覧の不完全性を前提にする限り、誤置換を構造的に排除できない。3案を検討した。

- **(A) 部分一致置換に境界の妥当性チェックを追加する**(置換直後の文字が句読点・閉じ括弧・助詞・文字列終端のいずれかであることを確認し、それ以外は置換をスキップして`stillUnresolved`に計上する)。長所: 既存設計を活かせる。短所: round13の負の先読みが本質的に同じ発想で、round14で「後続文字のパターン推測」自体が反例(残り部分が漢字等の非英数字)により破られている。Codexから見て「同種の穴」と判断される可能性が高い。
- **(B) この復旧スクリプトの自動apply機能を撤回し、診断専用にする。** embeddedケースは境界推測に頼らない限り安全に自動修復できないという前提に立ち、`containsJudgeIdMarker`でラベルを含むと判定された文字列値については、部分置換ではなく**フィールド値全体を固定の定型文へ丸ごと置き換える**方式に変更する(通常移行の「完全一致でのみ置換」という設計原則と整合させる)。境界推測が一切不要になる代わりに、embedded文字列を含むフィールド(explanation等)の本文がまるごと失われる。データ損失を伴う運用判断のため、対象行を`candidatesFound`として提示した上でユーザーの明示的な承認を得てから`--apply`する運用にする。
- **(C) 伏字化した安全な差分をoperatorへ提示し、人間確認後にapplyする2段階検証を追加する**(文字種カテゴリ〈ひらがな/カタカナ/漢字/英数字/記号〉のみを匿名化して表示し、実際の文字は一切出さない)。長所: 誤置換を人間が確認できる可能性が上がる。短所: 実装がこのタスクのスコープを大きく超え、文字種カテゴリだけでは判断できないケースも残る。

**ドラフトの暫定選択: (B)**。理由: Codexのメタレビュー・round19のいずれも「証明できない自動化はしない」という設計原則を推奨しており、(A)は同じ原則に反する。(C)は投資対効果が見合わない。(B)はデータ損失(explanation本文の欠落)というコストを払うが、安全性を構造的に保証できる。実装前にCodexの意見を確認したい。

#### P1-2: 楽観的並行性制御の`.changes`確認漏れ

UPDATE実行後に`.run(...).changes`を確認し、`changes === 1`の場合のみ`fixed`へ計上する。0件だった場合は新設する`conflicted`カウントへ分離し、1件以上あれば非ゼロ終了にする。回帰テスト(`changes: 0`のケース)を追加する。

#### P1-3: 例外経路のtry/catch欠如

`repairEmbeddedLegacyCorrectionTitle.ts`の実行関数に、`migrateCorrectionCredentials.ts`と同様のtry/catchを追加し、固定の一般メッセージのみを出力して終了コード1にする。機微な例外文字列が出力されないことのテストを追加する。

#### P2-1: 非開示テストの形式依存

`tests/repairEmbeddedLegacyCorrectionTitle.script.test.ts`のjobId非開示アサーションを、round16と同様に固定テンプレート文言との完全一致(`toBe`)へ変更する。

#### P2-2: CLAUDE.mdの無関係な変更混在

T008の差分から`CLAUDE.md`の日本語出力ルール追加を分離し、由来(ユーザー指示による別件の更新であること)を明記した別コミットにする。

### 方針決定(round20、2026-09-05、Codexレビューを受け(B)案を撤回・(D)案へ変更)

上記(B)案についてCodexへ実装前レビューを依頼した結果、P1指摘4件を受けた。要旨: (B)は「診断専用化」と言いながら`--apply`(破壊的更新)を残しており矛盾する。操作者に見えるのは件数だけのため、どのフィールドの本文がどれだけ失われるか分からないまま承認することになり、**round17で一度却下した「explanation本文が丸ごと失われる」問題を、承認手順だけ付けて再導入している**。加えて`containsJudgeIdMarker`(「ジャッジID」ラベル検出)は監査の検出条件としては妥当だが、無害な文(例:「ジャッジIDは回答に含めないでください」)まで誤って巻き込みうるため、破壊的更新の十分条件にはできない。dry-runとapply実行の間に候補行が増減するTOCTOUも未対策だった。

Codexが提示した、検討から漏れていた選択肢: **「文字列を修復する」のではなく「影響を受けた裁定結果(`ruling_job`)自体を無効化・非公開化する」**。1件限りのセキュリティ事故対応では、本文を部分的に壊して正常な結果として残すより、結果全体を明示的に利用不能にする方が監査可能で安全、との指摘。ユーザー判断により、この(D)案(該当`ruling_job`を安全な固定の"非表示"結果へ置換する)を採用する。

**確定した設計**(Codexのround20指摘をすべて反映):

1. `repairEmbeddedLegacyCorrectionTitle.ts`の役割を「部分文字列の修復」から「候補行の`result_json`全体を、`RulingResult`型(`src/ruling/types.ts`)に適合する固定の"非表示"オブジェクトへ置換する」に変更する。
   ```typescript
   {
     conclusion: "この回答はセキュリティ上の理由により非表示になりました",
     explanation: "この回答はセキュリティ上の理由により非表示になりました",
     steps: [],
     confidence: "low",
     cards: [],
     sources: [],
   }
   ```
   `cards`・`sources`も空にする(sourcesのtitleに別の訂正のジャッジID関連情報が混入するリスクを避けるため、部分的な保持はしない)。
2. **誤爆防止(`containsJudgeIdMarker`の過検出対策)**: `--expected-candidates <N>`を必須の引数にする。同一トランザクション内でSELECT→`containsJudgeIdMarker`による候補抽出を行い、候補件数が`N`と一致しない場合は**一切UPDATEを実行せず**、非ゼロ終了で候補件数のみを報告する(想定外の行が新たに見つかった、または想定した行が既に解消済み、のいずれの場合も安全側に倒す)。これにより、無害な文を含む未知の行を誤って巻き込むリスクを、少なくとも「件数の想定と一致しない限り何もしない」という形で緩和する。
3. **TOCTOU対策**: dry-runと`--apply`を同一プロセス内の1回の実行に統合する(別プロセスでの2段階運用をやめる)。`--apply`を付けない場合は候補件数の報告のみ、付けた場合はSELECT〜UPDATEを単一のSQLiteトランザクション(BEGIN/COMMIT/ROLLBACK)内で実行し、SELECTで取得した行のみを対象にする。
4. **`.changes`契約**: 各UPDATEを`WHERE id = ? AND result_json = ?`のCASにし、`changes === 1`のみ`fixed`へ計上する。`changes === 0`は`conflicted`(他プロセスが並行更新した)として分離する。`id`は主キーのため`changes > 1`は本来あり得ないが、不変条件違反として検出した場合はトランザクション全体をROLLBACKし固定の一般メッセージで異常終了する。`conflicted`が1件でもあれば、トランザクション全体をROLLBACKし非ゼロ終了する(部分適用を許さない)。
5. **例外処理**: CLIエントリーポイント(`src/scripts/repairEmbeddedLegacyCorrectionTitle.ts`)の最外層で確実にcatchし、`Error.message`・`String(error)`・stackのいずれも出力しない固定の一般メッセージのみを出し、終了コード1にする。
6. **非開示テスト**: dry-run・apply成功・件数不一致・`conflicted`発生・例外、の各分岐について、stdout/stderrの出力全体を固定テンプレートとの完全一致(`toBe`)で検証する。ロガーへ機微値を含むダミー入力を渡しても固定出力以外が出ないことも確認する。

この設計変更により、`stillUnresolved`という概念(部分置換を試みても解消できない行)は不要になる(候補と判定された行は無条件に安全な固定結果へ置換するため)。`possibleKnownIdCollisionCount`等、通常移行(`migrateLegacyCorrectionTitlesInResultJson`)側の既存の設計・カウント体系には変更を加えない(この方針変更は`repairEmbeddedLegacyCorrectionTitle`専用スクリプトのみが対象)。

P1-2〜P2-2(楽観的並行性制御・try/catch・非開示テスト・CLAUDE.md分離)は上記の確定設計に統合済み。次のステップ: この確定設計で実装し、`npm run typecheck && npm test`・実SQLite検証を経て、通常の差分レビュー(`scripts/codex-review.ps1`)で実装後レビューを受ける(round21)。

### 実装完了(round20、2026-09-05)

上記の確定設計で実装した。

- `src/ruling/rulingJobRepository.ts`: `repairEmbeddedLegacyCorrectionTitles`を全面書き換え。`replaceEmbeddedLegacyTitlesInValue`(部分文字列置換)を削除し、SELECT〜UPDATEを単一トランザクション(`db.exec("BEGIN"/"COMMIT"/"ROLLBACK")`)内で実行する設計に変更。候補件数が`options.expectedCandidates`と一致しない場合、またはdry-runの場合は一切UPDATEせずROLLBACKする。apply時は各行を`WHERE id = ? AND result_json = ?`のCASで更新し、`changes === 1`のみ`fixed`へ計上、`changes === 0`は`conflicted`へ分離、`changes > 1`は不変条件違反として例外を投げる。`conflicted`が1件でもあればトランザクション全体をROLLBACKし部分適用を避ける。置換先は`RulingResult`型に適合する固定オブジェクト`HIDDEN_RULING_RESULT`(conclusion/explanation共に固定文言、steps/cards/sourcesは空配列、confidence: "low")。戻り値の型を`{ candidatesFound, fixed, conflicted }`に変更(`stillUnresolved`は不要になったため削除)。
- `src/scripts/repairEmbeddedLegacyCorrectionTitle.ts`: `--expected-candidates <N>`を必須の引数として追加(未指定・非整数・負数はエラー終了)。`runRepair`にtry/catchを追加し、下位層の例外の詳細(`Error.message`等)を一切出力せず固定の一般メッセージのみ返す設計に変更(migrateCorrectionCredentials.tsと統一)。候補件数が想定と不一致の場合・`conflicted`が発生した場合はいずれも終了コード1。`getKnownJudgeIdsForLegacyTitleAudit`への依存を削除(部分置換をやめたため既知ID一覧が不要になった)。
- `tests/rulingJobRepository.test.ts`: `repairEmbeddedLegacyCorrectionTitles`のテストを全面書き換え。想定件数一致時の正常系、想定件数不一致(多い/少ない)時に無関係な行を巻き込まないこと、楽観的並行性制御(`changes: 0`→`conflicted`→全体ロールバック)、`changes > 1`時の異常終了、複数候補の同時処理、BEGIN/COMMIT/ROLLBACKの呼び出し確認を追加。
- `tests/repairEmbeddedLegacyCorrectionTitle.script.test.ts`: 非開示アサーションを、round19 P2指摘の通り固定テンプレートとの完全一致(`toEqual`で出力配列全体を比較)へ変更。想定件数不一致・`conflicted`・例外の各分岐のテストを追加。
- `CLAUDE.md`の日本語出力ルール追加(T008と無関係、ユーザー指示による別件更新)はコミット時に分離する(下記参照)。

**検証**: `npm run typecheck`・`npm test`(49ファイル/372テスト)・`cd mobile_app && flutter analyze`(0 issues)すべてPASS。実SQLite(node:sqlite)による検証スクリプトで、(1)候補1件・想定件数一致時にresult_json全体が固定の非表示結果へ正しく置換されJ001が残らないこと、(2)想定件数と一致しない場合(無害な文「ジャッジIDは回答に含めないでください」を含む行が紛れ込んだケース)は一切更新されず両方の行が元のまま保持されること(誤爆防止の実地確認)、(3)UPDATE実行中に他プロセスが対象行を書き換えて競合させた場合、`conflicted`として検出されトランザクション全体がロールバックされ、同時に処理中だった無関係な行も元のまま保持されること、を確認した(検証用スクリプトは実行後に削除済み、`DATABASE_URL`は毎回シェル環境変数として渡す方式を徹底)。

### Review 21 — 2026-09-05(round20実装への実装後レビュー、Codex)

- P1: `repairEmbeddedLegacyCorrectionTitles`を静的importしているため、import自体(依存モジュールのDB初期化等)が例外を投げた場合、`runRepair()`のtry/catchへ到達せずNode.jsが例外メッセージ・スタックをそのまま出力する。round18・round19・round20で維持してきた「下位層の例外詳細を一切出力しない」契約を完全には満たしていない → 型のみ静的import・実装は`require()`で最外層のtry/catch内に移す設計へ変更
- P1: dry-run実行と`--apply`実行が別プロセスである以上、その間に候補行が入れ替わっても件数だけでは検出できないTOCTOUが残っている(dry-runで見た候補が解消され、別の無害な誤検知行が新たに1件増えても、件数だけでは区別できない) → 候補行のjobId集合から計算したSHA-256ハッシュ(`candidateSetToken`、jobIdそのものは含まない一方向ダイジェスト)をdry-run時に出力し、`--apply`実行時に`--candidate-set-token`として渡すことを必須にし、実際に集めた候補集合のハッシュと一致する場合のみ更新する設計へ変更
- P2: 非開示テストが全分岐で「出力全体の完全一致」になっていない → 各分岐でstdout/stderrの出力配列全体を`toEqual`で完全比較するよう修正
- P2: 新設したCLI引数契約(`--expected-candidates`・`--candidate-set-token`・`--apply`)に直接のテストが無い → 引数解析を副作用のない`parseArgs()`関数へ分離し、正常値・各不正値(未指定・値欠落・負数・小数・非数値・`--apply`指定時の`--candidate-set-token`欠落)を直接テストするよう追加
- P2: `buildLegacyTitles()`直前のコメントがround20以前の設計(埋め込みケースも部分文字列置換で対応する前提)を説明したまま → round20の現行設計(結果全体を非表示化する)に合わせて訂正

### 実装完了(round21、2026-09-05)

- `src/ruling/rulingJobRepository.ts`: `computeCandidateSetToken()`を新設(`node:crypto`の`createHash("sha256")`、候補jobIdをソートして結合しハッシュ化)。`RepairEmbeddedLegacyCorrectionTitlesResult`に`candidateSetToken: string`・`tokenMismatch: boolean`を追加。`repairEmbeddedLegacyCorrectionTitles`は`options.expectedCandidateSetToken`を受け取り、`expectedCandidates`との件数一致に加えてトークンの一致も確認し、いずれかが不一致なら一切更新せずROLLBACKする。dry-run時・件数不一致時も`candidateSetToken`は常に返す(operatorが次の`--apply`実行時に使う)。`buildLegacyTitles()`直前のコメントを現行設計に合わせて訂正。
- `src/scripts/repairEmbeddedLegacyCorrectionTitle.ts`: `repairEmbeddedLegacyCorrectionTitles`の静的importを型のみに変更し、実装は`require.main === module`ブロック内で`require()`する設計に変更(最外層のtry/catchで、importに伴う例外も含めて詳細を出力しない)。引数解析を`parseArgs()`として分離(`--expected-candidates`・`--candidate-set-token`・`--apply`を解析し、`--apply`指定時は`--candidate-set-token`を必須にする)。`runRepair()`に`candidateSetToken`引数を追加し、`tokenMismatch`時のエラーメッセージを追加。
- `tests/rulingJobRepository.test.ts`: 全テストケースで`expectedCandidateSetToken`を渡すよう更新。新規テスト「候補件数は一致するが検証トークンが一致しない場合(TOCTOU再現)、更新しない」を追加。
- `tests/repairEmbeddedLegacyCorrectionTitle.script.test.ts`: `parseArgs()`の単体テスト(正常系・各不正値)を追加。`runRepair()`の各分岐(dry-run正常系・apply成功・件数不一致・トークン不一致・conflicted・例外)で、stdout/stderrの出力配列全体を`toEqual`で完全一致検証するよう変更。

**検証**: `npm run typecheck`・`npm test`(49ファイル/382テスト)PASS。実SQLite検証で、(1)正しいトークンでの適用成功、(2)dry-run後に候補が入れ替わった場合(TOCTOU再現: 元の候補が解消され無害な別行が新たに候補になったケース)、件数が一致してもトークン不一致により一切更新されないこと、を確認した(検証用スクリプトは実行後に削除済み)。ビルド済みCLIスクリプトの実機実行でも、引数不足・`--apply`単独指定(トークン欠落)がいずれも使い方メッセージとともに終了コード1になることを確認した。import時例外の非開示(P1修正)はユニットテストでカバーしており、実機での例外再現は本番コードを壊すリスクがあるため見送った。

**次のステップ**: この実装をCodexへ実装後レビュー(round22)に出す。問題なければ、`CLAUDE.md`の分離コミット→本体のコミット→ユーザー承認を得てpush→Renderデプロイ→本番で`node dist/scripts/repairEmbeddedLegacyCorrectionTitle.js --expected-candidates 1`(dry-run、件数・トークンを確認)→`--candidate-set-token <トークン> --apply`で再実行、の順に進める。

### 方針の再検討・撤回(round22、2026-09-05、ユーザー判断)

Codexへのround22実装後レビューを依頼する前に、ユーザーから「この1件の残存データにここまでコストをかける必要があるのか」という再確認があった。改めて実害の大きさを整理した。

- この対応で守ろうとしているのは、`ruling_job`テーブルの過去の裁定結果1行に、旧形式の「過去の訂正事例(ジャッジID:XXX)」という文字列がLLM生成のexplanation本文中に埋め込まれたまま残っている、という単一データの後始末であり、T008の本質的なセキュリティ対応(公開APIのjudgeIdマスク漏れ、生セッショントークンの平文保存、Evidence表示・統計API経由の新規漏洩の遮断)はround1〜2の時点で既に完了・本番反映済みである。
- このジャッジID自体は、T008で既に「バグ稼働期間中に漏洩した可能性のあるIDの再発行は見送り、リスクを受容する」というユーザー判断が下されている対象と同種であり(上記Out of Scope参照)、仮にこの1件が漏洩していたとしても既存の受容方針の範囲内である。
- この行が実際に晒される経路は、認証不要API`GET /api/ruling/jobs/:jobId`にアクセスする第三者が、この特定のjobId(ランダムな内部ID)を偶然知っている場合に限られる。

round18〜21で構築した専用復旧スクリプト(部分置換→フィールド値全体の非表示化→検証トークンによるTOCTOU対策、と設計を重ねた)は、この限定的なリスクに対して不釣り合いなコストであるとユーザー判断により**撤回した**。

**新方針**: 診断(対象jobIdの特定)と修復(実際のUPDATE)を分離し、修復は自動化しない。

- `repairEmbeddedLegacyCorrectionTitles`(自動apply・検証トークン照合を含む復旧関数)と`src/scripts/repairEmbeddedLegacyCorrectionTitle.ts`(専用CLI)を削除した。
- 代わりに、読み取り専用の診断関数`findUnresolvedLegacyCorrectionTitleJobIds()`(`src/ruling/rulingJobRepository.ts`)と、それを呼び出すだけの単純なCLI`src/scripts/findUnresolvedLegacyCorrectionTitleJobIds.ts`を新設した。このスクリプトは対象行のjobIdの一覧を出力するだけで、DBへの書き込みは一切行わない。

**この方針転換により、以下は撤回・削除した**: `RepairEmbeddedLegacyCorrectionTitlesResult`型、`computeCandidateSetToken()`、`HIDDEN_RULING_RESULT`定数、`--expected-candidates`/`--candidate-set-token`/`--apply`の引数契約、`parseArgs()`、関連するすべてのテスト(TOCTOU再現テスト・楽観的並行性制御テスト・トランザクションテスト等)。通常移行(`migrateLegacyCorrectionTitlesInResultJson`、フィールド値全体の完全一致方式)は変更していない(この設計は既に安全側へ収束していると複数回のCodexレビューで確認済みのため維持する)。

### Review 22 — 2026-09-05(シンプル化後の実装後レビュー、Codex)

- P1: 「jobId自体は機微情報の開示にはあたらない」という上記の判断は不適切。認証不要`GET /api/ruling/jobs/:jobId`がジャッジIDを含む対象結果へのアクセスキーとして機能する以上、jobIdは対象データへの実質的なcapability URLの構成要素であり、非機微とは扱えない → jobIdは`randomUUID()`(`src/routes/rulingJobs.ts`)で生成される推測困難な値であることを確認した上で、「非機微」という表現を撤回し、「Render Web Shellの画面上に運用者本人が一時的に表示するだけの用途に限りリスクを受容する(タスク文書・レビュープロンプト等の恒久的に残る場所へは書き写さない)」という限定表現へ修正した
- P1: 診断条件が`containsJudgeIdMarker`(「ジャッジID」ラベルの表記揺れ検出)単体であり、「ジャッジIDは回答に含めないでください」のような無害な文章まで候補にしてしまう。手動UPDATEはresult_json全体を非表示結果へ置き換えるため、誤検知した無害な行を壊しうる → 「過去の訂正事例」という固定フレーズとジャッジIDマーカーが同一の文字列値内に共存することを要求する専用の判定関数`containsEmbeddedLegacyCorrectionTitleMarker`を新設し、診断専用に使うよう変更(通常移行側の`containsJudgeIdMarker`はunresolvedMarkerCount算出用として変更していない)。誤検知回避・別フィールド分散ケースの回帰テストを追加
- P1: 診断ロジック(NFKC正規化・表記揺れ対応)と手動UPDATEのSQL WHERE条件(単純な`LIKE '%ジャッジID%'`)が一致しておらず、診断で見つかった行でもUPDATEが0件になりうる。またRender Web ShellへのCJK入力欠落の実績(round4で発覚)を踏まえると、日本語リテラルを含むSQLを画面へ直接入力する手順はその制約と整合しない → 運用手順を「`BEGIN IMMEDIATE`→対象行を`LIKE '%過去の訂正事例%'`で再確認(1行であること)→UPDATE→`SELECT changes()`で1件であることを確認→COMMIT(いずれかが想定外ならROLLBACK)」という1つのトランザクション内で完結する手順に変更した(下記「残作業」参照)
- P1: コードコメント・タスクファイル冒頭に、削除済みの`repairEmbeddedLegacyCorrectionTitles`・専用CLIへの言及が残っていた → `buildLegacyTitles()`直前のコメント、タスクファイル冒頭のStatus行をround22の現行方針に統一した
- P2: `findUnresolvedLegacyCorrectionTitleJobIds.ts`のCLIエントリーポイントに例外処理が無く、import時例外を含め詳細がそのまま出力されうる(round21で修正した契約の再発) → 型のみ静的import・実装は`require.main === module`内でrequireし、最外層のtry/catchで固定メッセージのみ出力する設計へ変更(round21と同じパターン)
- P2: 診断関数が読み取り専用(SELECTのみ)であることをテストで明示的に固定していない → `prepareMock`へ渡される全SQLが`SELECT`で始まり`UPDATE`/`DELETE`/`INSERT`を含まないことを検証するテストを追加
- 確認: 通常移行(`migrateLegacyCorrectionTitlesInResultJson`)には変更がなく、完全一致方式が維持されていることを確認済み(Codexも同じ結論)

### 実装完了(round22.1、2026-09-05、Review 22反映)

- `src/ruling/rulingJobRepository.ts`: `containsEmbeddedLegacyCorrectionTitleMarker()`を新設(`LEGACY_CORRECTION_TITLE_PHRASE`定数「過去の訂正事例」との共存を要求)。`findUnresolvedLegacyCorrectionTitleJobIds()`はこの関数を使うよう変更。jobIdの扱い・診断条件についてのコメントを上記Review 22の指摘を反映して訂正。`buildLegacyTitles()`直前のコメントを現行方針(round22)に合わせて更新。
- `src/scripts/findUnresolvedLegacyCorrectionTitleJobIds.ts`: 型のみ静的import・実装は`require.main === module`内でrequireし、`runFindUnresolvedJobIds()`に`logError`引数を追加してtry/catchで例外詳細を非開示にした。運用手順のコメントを、BEGIN IMMEDIATE〜COMMITの安全なトランザクション手順に更新。jobIdの扱いに関するコメントを訂正。
- `tests/rulingJobRepository.test.ts`: 誤検知回避テスト(無害な文・別フィールド分散ケース)、読み取り専用検証テストを追加。
- `tests/findUnresolvedLegacyCorrectionTitleJobIds.script.test.ts`: `logError`引数を追加したテストへ更新し、例外時の非開示テストを追加。
- タスクファイル冒頭のStatus行を、round22の現行方針(通常移行は完全一致方式で収束済み・既知残存1件は診断+手動UPDATEで対応)に統一した。

**検証**: `npm run typecheck`・`npm test`(49ファイル/365テスト)PASS。実SQLite検証で、embedded形式(「過去の訂正事例」+ジャッジIDマーカーが同一文字列値内に共存)のみが検出され、無害な文(「ジャッジIDは回答に含めないでください」)・別フィールド分散ケース(「過去の訂正事例」と「ジャッジID」が別々のフィールドにある)はいずれも誤検知されないことを確認した(検証用スクリプトは実行後に削除済み)。

### Review 23 — 2026-09-05(round22.1対応後の再レビュー、Codex)

- P1: 手動対応後の確認手順が`unresolvedRulingJobResultJsonMarkerCount`のみへの言及に退行しており、正式な完了条件(3種類すべて)と食い違っていた(round17で一度修正した不整合の再発)→ タスクファイル・CLIスクリプト双方のコメントを3種類すべて確認する手順へ修正した(反映済み)。
- P1: 手動UPDATE手順が、(a)Render Web ShellでのCJK入力欠落の実績を踏まえても引き続き日本語リテラルの直接入力を要求している、(b)診断条件(「過去の訂正事例」+ジャッジIDマーカーの同一値内共存)とUPDATE時のSQL条件(`LIKE '%過去の訂正事例%'`のみ)が完全には一致していない、という指摘。Codexの修正案(hexリテラルでのCJK回避、`json_tree`等によるSELECT/UPDATE条件の完全一致化)は実装可能だが、**ユーザー判断によりコード化は見送り、手動SQLである以上のリスクとして受容し、注意事項として手順に明記するに留めた**(下記「残作業」参照。round18〜21で「自動化の複雑化」を撤回した経緯を踏まえ、これ以上の精緻化は行わない)。
- P2: `containsEmbeddedLegacyCorrectionTitleMarker`は「過去の訂正事例」とジャッジIDマーカーの同一文字列値内での共存のみを要求し、隣接性(旧titleの構造上の位置関係)までは確認していないため、理論上「過去の訂正事例を参考にした。なお、ジャッジIDは回答に含めないでください」のような無害な文も候補になりうる → 診断専用(自動更新は行わない)であり、対象は運用者が手順2の`SELECT`で目視確認してからUPDATEする設計のため、この誤検知は目視確認の段階で気づける。ユーザー判断によりコード変更は見送り、下記の注意事項で対応する。
- P2: import時例外(`require("../ruling/rulingJobRepository")`自体の失敗)を隠す最外層catchの回帰テストが無い → 優先度が低いためユーザー判断により見送り(手動確認の運用が前提のスクリプトであり、実害は限定的)。

### 残作業(round23、手動SQLのリスクを明記した最終版)

**注意事項(手動SQLである以上のリスクとして受容する、round23確定)**: 以下の手順は本番DBへ直接SQLを入力する手動操作であり、(1)Render Web Shellで過去に日本語(CJK)入力が欠落した実績があること、(2)UPDATE時の`LIKE`条件は診断条件(NFKC正規化・表記揺れ対応込み)と完全には一致しないこと、という2点のリスクが残る。このリスクを自動化コードで排除する案(hexリテラル入力、`json_tree`による厳密な条件一致等)も検討したが、round18〜21で一度撤回した「自動化の複雑化」と同じ方向に戻ってしまうため、**ユーザー判断によりコード化せず、以下の手順2でSELECTの結果を必ず目視確認してからUPDATEを実行することでリスクを緩和する運用とする**。

1. `node dist/scripts/findUnresolvedLegacyCorrectionTitleJobIds.js`を実行し、対象jobIdの一覧を確認する(事前調査で把握している件数〈通常1件〉と一致することを確認する)。
2. 対象jobIdごとに、Render Web Shellから以下を1つのトランザクションとして実行する。**SELECTの結果セット(id・result_jsonの内容)を必ず目視確認し、意図した行であることを確認してからUPDATEへ進むこと**(日本語入力が正しく送信されたか、対象が本当に旧titleの埋め込みケースかをこの時点で確認する)。
   ```sql
   BEGIN IMMEDIATE;
   SELECT id, result_json FROM ruling_job WHERE id = '<対象jobId>' AND result_json LIKE '%過去の訂正事例%';
   -- 上記が1行返し、result_jsonの内容が想定通り(旧titleの埋め込みケース)であることを目視確認する。
   -- 0行、または内容が想定と異なる場合はROLLBACKし、診断結果が古くなっていないか本番DBを再調査する。
   UPDATE ruling_job
   SET result_json = '{"conclusion":"この回答はセキュリティ上の理由により非表示になりました","explanation":"この回答はセキュリティ上の理由により非表示になりました","steps":[],"confidence":"low","cards":[],"sources":[]}'
   WHERE id = '<対象jobId>' AND result_json LIKE '%過去の訂正事例%';
   SELECT changes();
   -- 上記が1であることを確認してからCOMMITする(1以外ならROLLBACKする)。
   COMMIT;
   ```
3. `node dist/scripts/migrateCorrectionCredentials.js`を再実行し、`unresolvedRulingJobResultJsonMarkerCount`・`invalidRulingJobResultJsonCount`・`possibleKnownIdCollisionRulingJobResultJsonCount`の3種類すべてが0になったことを確認する(完了条件は上記Status・Out of Scope参照。`possibleKnownIdCollisionRulingJobResultJsonCount`のみ非ゼロの場合に限り、手動確認の上で誤検知と判断できれば例外的に完了として扱ってよい)。

このシンプル化された実装を、次のCodexレビュー(round22)へ出す。
