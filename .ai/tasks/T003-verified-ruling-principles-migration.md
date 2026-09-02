# T003: 検証済み裁定原則への移行(第1弾: ルール17・18・19)

Status: In Progress

## Goal

D-006に基づき、`generateRuling.ts`のシステムプロンプトに常時ハードコードされている個別裁定(ルール15〜20)のうち、比較的直接的な公式総合ルール条文参照があり移行しやすいルール17(置換効果の決定順)・18(複数ブレイカー能力の宣言)・19(攻撃/ブロック指定の持続)を、出典・適用条件・確認日を持つ「検証済み裁定原則」データへ移行し、関連する質問にだけ取得・注入する方式に切り替える。

詳細な設計は`../reviews/2026-09-02-ruling-knowledge-migration-proposal.md`、決定は`../../DECISIONS.md` D-006を参照。

## Scope (今回)

- `src/rules/data/verified-ruling-principles.json`(新規、正本データ)にルール17・18・19相当の3原則を追加
- `src/rules/verifiedRulingPrinciples.ts`(新規)でJSON読み込み・zod検証・関連原則の検索を実装
- `RulingEvidence`/`EvidenceSource`型に`verifiedRulingPrinciples`セクションを追加
- `retrieveEvidence.ts`で検索・取得を統合
- `generateRuling.ts`のシステムプロンプトに検証済み裁定原則の汎用的な扱い方ルールを追加し、ルール17・18・19のハードコード記述を削除、`sources`のURL空文字許可リストに検証済み裁定原則のタイトルを追加
- 正例・負例を含む検索テスト・回答テストを追加

## Out of Scope (今回)

- ルール15(キリコ³系、公認ジャッジ再確認が必要)・ルール16(句点区切りの一般化再確認が必要)・ルール20(公式条文/Q&A特定が必要)の移行は次回以降
- Embedding検索の導入(今回は明示的マッピング+キーワード一致のみ)
- 裁定知識データのCMS化・管理画面

## Acceptance Criteria

- [x] `src/rules/data/verified-ruling-principles.json`に3原則を追加し、zodスキーマで検証される
- [x] 質問文のルール概念・キーワードに応じて関連原則だけが`RulingEvidence`に含まれる(無関係な質問には注入されない)
- [x] システムプロンプトからルール17・18・19の個別裁定記述を削除し、汎用的な「検証済み裁定原則」の扱い方ルールに置き換える
- [x] 生成された`sources`に検証済み裁定原則のタイトルを含める場合の捏造防止チェック(既存の`allowedCorrectionTitles`と同様のURL空文字許可リスト)を拡張する
- [x] 各原則について正例(適用される質問)・負例(似ているが適用されない質問、`doesNotApplyWhen`)の検索テストを追加する
- [x] `npm run typecheck` / `npm test`がPASSする
- [x] Codexの独立レビューを実施する

## Known Limitations(今回のスコープでは未対応)

- トリガーキーワードの単純一致検索のため、`doesNotApplyWhen`に該当する質問にも原則が過剰に注入されうる(例: 「置換効果は1イベントに何回適用できるか」にルール17原則が注入されるが、textの`適用しない条件`に該当が明記されておりLLMの判断に委ねる設計)。将来的にスコアリング機構を導入する余地がある
- 実際のLLM応答を用いた回答評価(過去誤答ケースの再現テスト)は自動テストに組み込んでいない。本番相当の動作確認は今後の実運用でのモニタリング(`llm_usage`ログ等)に委ねる
- 攻撃/ブロック指定持続の原則は「参加できな」「攻撃できな」「ブロックできな」という語幹一致のみをトリガーとする(Review 2でカード効果由来の過剰マッチ防止のため`cardDerivedConcepts`を検索対象から除外し、triggerKeywordsも絞り込んだトレードオフ)。これらの語を含まない別の言い回し(例: 想定外の口語表現)は検索漏れになりうる

## Implementation Owner

Claude Code

## Reviewer

Codex

## Review History

### Review 1 — 2026-09-02(D-006実装、ルール17・18・19移行後)

- P0: 1件(正本データを`data/`(Renderの永続ディスクマウント先)に置いており本番でENOENTになる) → `src/rules/data/`(ビルド対象、JSON import)へ移動し解消。ビルド成果物(`dist/rules/data/`)への複製・ビルド後JSからの動作を確認済み
- P1: 1件(検索の過剰一致・検索漏れ、テストが質問解析経路を通していない) → ルール19対象の言い回し(「攻撃できなくなる」等)の検索漏れをtriggerKeywords/ruleConceptDictionary拡充で解消。過剰一致(置換効果)は設計上の既知の限界としてDECISIONS.md・タスクファイルに明記し、テストでtextにdoesNotApplyWhenが含まれることを確認。`extractRuleConcepts`経由の実際の言い回しでの検索テストを追加
- P2: 2件((a) D-006の文言とconfidence.tsの実装が矛盾していた→DECISIONS.mdの文言を実装(highへ自動昇格しない安全設計)に整合させて解消。(b) officialQaUrls/verification/verifiedAtがEvidence変換時に失われる→textに追記し、officialQaUrlsはurlフィールドに反映してsources検証にも統合)
- P3: 1件(DECISIONS.mdでD-006がD-005のRejected Alternatives/Consequencesより前に挿入されセクション構造が破損) → D-006をD-005の完全な末尾に移動し修正
- 全指摘に対応後、`npm run typecheck`・`npm test`(41ファイル/246テスト)・ビルド成果物からの動作確認まで再実施しPASS

### Review 2 — 2026-09-02(Review 1対応後の再レビュー)

- P1: 1件(攻撃/ブロック指定持続の原則で、`appliesWhen`に「攻撃クリーチャー自体が取り除かれた」という本来は例外・別結論のケースが混在しており、通常ケースでも不適用と誤判定されうる) → 例外ケースを`doesNotApplyWhen`側へ移し、`appliesWhen`を「参加できない制限が発生したが取り除かれてはいない」場合のみに限定して解消
- P1: 1件(トリガーキーワードの過剰一致が`hasAnyEvidence`判定・confidenceにも影響する。特に`cardDerivedConcepts`(カードテキスト由来の概念)まで検索条件に含めていたため、質問の論点と無関係でも「関連カードがその能力を持つ」だけで原則が注入されていた) → `searchVerifiedRulingPrinciples`の呼び出しを`parsed.ruleConcepts`(質問文由来のみ、`cardDerivedConcepts`を含まない)に限定。あわせて過剰マッチの実例だった`triggerKeywords`の汎用語("攻撃する時"/"ブロックする時"/単独の"ブレイク")を削除し語幹一致([参加/攻撃/ブロック]できな、W・ブレイカー、T・ブレイカー)に絞り込み
- P2: 1件(`src/routes/stats.ts`の`sourceTypeSchema`に`verifiedRulingPrinciple`が無く、統計APIが常に400を返す) → enumに追加して解消
- 対応後、カード由来概念のみでは注入されないことを確認するテスト・例外ケースが`doesNotApplyWhen`に含まれることを確認するテストを追加。`npm run typecheck`・`npm test`(41ファイル/248テスト)PASS
