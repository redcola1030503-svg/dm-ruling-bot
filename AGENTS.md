# Project Agent Rules

このファイルはClaude Code / Codex双方が守る共通ルールの正本(唯一の情報源)。
ツール固有の設定は書かない(Claude固有は`CLAUDE.md`、Codex固有はCodex側の設定へ)。

## Goal

デュエル・マスターズの裁定(ルール判定)を、公式情報を根拠にAIが回答するアプリ。
バックエンド(Node.js/TypeScript/Express、`src/`)+ モバイルアプリ(Flutter、`mobile_app/`)の2構成。

## Definition of Done

- 要件を満たす
- 既存テストを壊さない
- 新しい挙動にはテストを追加する(バックエンド: vitest。モバイルは既存の起動スモークテスト1本のみで、追加のテスト慣行は無い)
- 以下を通す:
  - バックエンド: `npm run typecheck && npm test`
  - モバイル: `cd mobile_app && flutter analyze`
- `STATUS.md`を更新する

## Development Rules

- 既存アーキテクチャ・既存の命名/コメント規約を優先する(日本語コメントで「なぜ」を書く、自明な「何を」は書かない)
- 不要な依存ライブラリを追加しない
- 大規模変更は実装前に計画を書く(`.ai/tasks/`参照)
- 1タスクで無関係なリファクタを混ぜない
- 失敗したアプローチを同じ形で繰り返さない(`DECISIONS.md`の「却下した代替案」を確認する)
- YAGNI: 依頼されていない機能・過剰な抽象化を追加しない

## Verification

変更後は可能な範囲で以下を実行する。

1. バックエンド: `npm run typecheck`
2. バックエンド: `npm test`
3. モバイル: `flutter analyze`
4. `git diff`で意図しない変更が無いか確認

## Review

**今後の開発は、重大な問題だけを対象とする最小限の独立レビューで行う**(ユーザー方針、2026-09-10)。Claude/Codexの役割は固定せず、タスクごとに一方をImplementation Owner、もう一方をReviewerとする。

ユーザーによる担当指定を最優先する。指定がない場合は、着手するエージェントが以下の順で担当を選び、選定理由とともに対象タスクファイルへImplementation OwnerとReviewerを記録する。両者が同等なら、依頼を受けた側をImplementation Ownerとする。Reviewerは実装前レビューで分担の妥当性も確認する。

1. 対象ファイルを更新でき、必要な検証を実行できるか
2. 直近の関連作業・コードのコンテキストを持つか
3. 実装者と異なる独立Reviewerを確保できるか

**調査タスク・改修タスクでは、どちらがImplementation Ownerでも作業実施前に方針レビューを1回行う。** 「〜という問題がある」という調査結論や「〜という設計で対応する」という改修方針を、実装に着手する前にReviewerへread-onlyレビューとして渡す。タスクファイルを新規作成・更新する場合は、その編集前にユーザー指示、目的、対象ファイル、変更案をClaude Codeへ提示してレビューを受ける。1つの事前レビューで明記した対象文書は、文書ごとの追加レビューを不要とする。

方針変更またはドキュメント修正を含む作業の事前ReviewerはClaude Codeとする(ユーザー方針、2026-09-10)。独立性を保つため、ユーザーが実装担当を明示指定していない場合はCodexをImplementation Ownerとする。ClaudeがImplementation Ownerに明示指定された場合は、着手前にユーザーへReviewerの扱いを確認する。

コード変更は作業実施後に同じReviewerが成果物をread-onlyで1回レビューする。ドキュメントのみの変更は、事前レビューで対象とした方針どおりに編集されていれば実装後レビューを省略できる。Reviewerはファイルを修正せず指摘のみ返し、Implementation Ownerがコード・資料・検証結果を確認して指摘の採否を判断する。Reviewerを確保できない場合は、自己レビューで代替せず、方針レビュー前または完了判定前で停止する。

標準レビューの指摘対象はP0(即修正必須)とP1(完了前に修正が必要)だけとし、次に限定する。

- 要件を満たさない具体的な経路
- 現実的に発生するロジック不具合、回帰、競合、セキュリティ問題、データ損失
- 上記を防ぐために必要なテストの欠落

命名、コメント、書式、好み、任意の改善、過剰な防御、根拠の薄い将来仮定、今回のスコープ外は指摘も改修も行わない。P2/P3はユーザーが詳細レビューを明示した場合だけ扱い、P2/P3を理由に完了を止めない。指摘には再現経路または具体的な影響と最小の修正案を必須とする。

P0/P1がなければレビューを終了する。P0/P1対応で挙動またはリスクが変わった場合だけ再レビューを1回行い、それ以上は反復しない。再レビューで新しい指摘を扱うのは、直前の修正に直接起因し、要件違反または現実的な障害を具体的に示すP0/P1に限る。レビュー本文の欠落や実行失敗による再実行は、この回数に含めない。

ClaudeがImplementation Ownerの場合は`.ai/prompts/codex-review.md`と`scripts/codex-review.ps1`を使ってCodexへ依頼する。CodexがImplementation Ownerの場合は、利用可能なClaude CLIをread-only設定で直接実行してClaudeへ依頼する。どちらも上記の最小レビュー基準を使う。具体的な実行例は`.ai/tasks/T018-role-flexible-collaboration-policy.md`と`STATUS.md`を参照する。

Implementation OwnerとReviewerの記録は、T018以降の新規タスク、StatusがProposed/In Progressの既存タスク、完了後に新たな実装作業のため再オープンする既存タスクへ適用する。完了済みタスクへの遡及追記と、完了済み成果物の参照・read-only確認だけを行う場合の追記は不要とする。

**ユーザーが特定のエージェントへプロジェクト内ファイルの更新を明示的に依頼した場合**、どちらがImplementation Ownerでも、Reviewerへの依頼・引き継ぎの冒頭で「ユーザー指示による更新」であること、指示の要旨、Implementation Ownerが更新した対象ファイルを必ず明記する(ユーザー方針、2026-09-03・2026-09-06)。この明記は変更の由来を区別するためのものであり、独立レビュー原則を免除しない。

## Shared State

作業開始時に以下を読む。

- `STATUS.md`(現在地・担当・検証結果・次の作業)
- `DECISIONS.md`(長期的な設計判断)
- 対象の `.ai/tasks/<task>.md`(あれば)

作業終了時に`STATUS.md`を更新する。チャット履歴ではなくこれらの共有ファイルを正とする。

## Security

以下をリポジトリへ保存しない(既存の`.gitignore`にも一部反映済み)。

- API key(`LLM_API_KEY`、`VOYAGE_API_KEY`、`REVENUECAT_API_KEY`等)
- LINE / RevenueCat / Firebase等の認証情報
- Apple秘密鍵(`*.p8`/`*.p12`/`*.jks`)
- OAuth token / browser session / cookie / password

## Git

- 大きな変更を一括コミットしない
- 意図の違う変更を分離する
- force pushは禁止
- Claude/Codexに同じファイルを同時編集させない(片方が実装、片方はread-onlyレビュー。並列実装が必要ならgit worktreeで分離する)
