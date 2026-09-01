# 個別裁定ハードコードの「検証済み裁定原則」移行案

Date: 2026-09-02
Author: Codex
Status: Proposal / Awaiting decision
Implementation Owner (if accepted): Claude Code
Reviewer: Codex

## Background

`src/ruling/generateRuling.ts`のシステムプロンプトには、過去の誤答を再発させないため、ルール15〜20として個別裁定の解釈が常時ハードコードされている。ルール15と20は実際の誤答改善が契機であり、回答安定化には効果があった。一方、質問と無関係でも毎回注入される、出典・確認日・適用除外条件を管理できない、公式ルール変更に追随しにくい、検索評価と回答正当性のテストが分離されていないという問題がある。

個別裁定を単純に削除して従来RAGへ戻すと誤答が再発し得るため、誤答防止効果を維持したまま、必要な質問にだけ取得される「検証済み裁定原則」へ移行する。

## Proposed Architecture

```text
質問
  ↓
カード名・ルール概念解析
  ├─ 公式カード／Q&A／総合ルール検索
  └─ 検証済み裁定原則を検索
          ↓
      適用条件・除外条件を確認
          ↓
汎用システムプロンプト＋今回必要な根拠だけで裁定生成
          ↓
出典・confidence・使用原則を機械検証
```

システムプロンプトには、公式情報の優先、論点一致、推論時の注意、JSON形式等の汎用ルールだけを残す。個別裁定の結論は常時注入しない。

## Versioned Knowledge Model

少数の原則から開始するため、Git管理された`data/verified-ruling-principles.json`等を正本候補とする。必要なら起動時またはビルド時にSQLiteの検索用テーブルへ同期する。

各原則は最低限、次を持つ。

```json
{
  "id": "effect-resolution-no-interruption",
  "title": "一つの効果が完了するまで別の誘発型能力を処理しない",
  "ruling": "複数カードを実行する一連の効果は、全処理完了まで別の誘発型能力を処理しない",
  "appliesWhen": [
    "一つの能力が複数カードを実行する",
    "処理途中で別の誘発型能力が待機した"
  ],
  "doesNotApplyWhen": [
    "S・トリガー自体の宣言・実行",
    "別々の効果が同時に待機しているだけ"
  ],
  "officialRuleIds": ["101.4", "101.4g", "112.3a", "409.1e"],
  "officialQaUrls": [],
  "verification": "accredited_judge",
  "verifiedAt": "2026-09-02",
  "status": "active"
}
```

必須管理項目:

- 適用条件と適用しない条件
- 公式総合ルールID・公式Q&A URL
- D-004に基づく公認ジャッジ確認の有無
- 確認日、状態（active/deprecated等）
- 正例・負例となる評価ケース

## Retrieval

既存の`ruleConcepts`・キーワード検索・Embedding検索を流用するが、検索漏れが元の問題だったためEmbeddingだけには依存しない。

- ルール概念から原則IDへの明示的マッピング
- 別名・関連語のキーワード検索
- Embedding類似検索
- `doesNotApplyWhen`による除外
- 最終的な論点一致判定

明示的マッピングは裁定内容をシステムプロンプトへ固定するものではなく、出典・版・適用条件を持つ知識へ確実に到達するためのルーティングとして扱う。

## Migration Order

一括削除せず、旧プロンプトと新方式を一時併用して1件ずつ移行する。

1. ルール17・18・19: 比較的直接的な条文参照があり移行しやすい
2. ルール15: キリコ³の実例と複数条文の解釈を公認ジャッジが再確認して移行
3. ルール16: 「句点で区切られれば別イベント」という一般化が常に成立するか再確認して移行
4. ルール20: 公式条文・公式Q&Aを特定するか、D-004の公式参考情報として公認ジャッジの検証記録を作成してから移行

各原則について、新方式で旧方式と同等以上の結果を確認してから、対応するシステムプロンプト記述を削除する。

## Evaluation

現在の`tests/retrieval/cases.json`は必要条文の検索可否だけを評価しているため、次の2段階へ分ける。

### Retrieval evaluation

- 必要な総合ルールIDを取得したか
- 必要な裁定原則IDを取得したか
- 無関係な裁定原則を取得していないか
- 各原則に正例と、似ているが適用されない負例を持つ

### Answer evaluation

- 必須となる結論・処理順を含むか
- 既知の誤答表現を含まないか
- 使用した根拠が今回取得したEvidence内に存在するか
- confidenceが適切か
- 同一質問を複数回実行しても結論が安定するか

## Runtime Validation

- `sources`が取得済みEvidenceに存在する
- 使用した裁定原則IDを結果またはログで追跡できる
- 原則に公式条文、公式Q&A、またはD-004の公認ジャッジ確認がある
- `deprecated`・未検証原則を使わない
- 新しい公式ルール変更と競合する場合は最新の公式一次情報を優先する

将来的にはClaude APIのCitations機能を利用し、提供した文書内の記述だけを引用する方式も検討できる。

## Acceptance Criteria if Adopted

- [ ] ルール15〜20を出典・適用/除外条件・確認日付きデータへ移す
- [ ] 各原則に公認ジャッジまたは公式情報による検証記録を持たせる
- [ ] 関連質問だけに裁定原則が取得・注入される
- [ ] 各原則に正例と負例の検索テストを追加する
- [ ] 実際の過去誤答ケースを使った回答評価を追加する
- [ ] 新方式で正答安定性を確認してから、対応するハードコードを1件ずつ削除する
- [ ] 使用原則と出典をログまたは結果から追跡できる
- [ ] Codexの独立レビューを実施する

## Non-Goals

- 根拠確認前にルール15〜20を一括削除すること
- ファインチューニングへ裁定知識を埋め込むこと
- Embedding検索だけに依存すること
- 一般ユーザーの未認証情報を検証済み裁定原則として採用すること

## References

- `src/ruling/generateRuling.ts` ルール15〜20
- `tests/retrieval/cases.json`
- Git commit `5cc0235`（キリコ³で決め手条文が検索から漏れた問題）
- Git commit `c5f4918`（ルール15〜19と検索評価基盤）
- Git commit `1eea261`（ドギラゴン逆・ブルーインパルスの誤答をルール20で修正）
- `DECISIONS.md` D-004（公認ジャッジ訂正を公式参考情報として扱う）
- Anthropic Evaluation Tool: `https://docs.anthropic.com/ko/docs/test-and-evaluate/eval-tool`
- Anthropic Citations: `https://docs.anthropic.com/pt/docs/build-with-claude/citations`
