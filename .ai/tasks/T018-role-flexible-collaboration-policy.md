# T018: Claude/Codexの役割可変型共同体制

Status: Complete

## Goal

Claudeを設計・実装、Codexをレビューに固定している現在の共同体制を、タスクごとに適任な方を実装担当として選び、もう一方が独立レビューする役割可変型へ変更する。どちらが実装担当でも、作業前の方針レビューと作業後の成果物レビューを同じ基準で実施する。

## Findings

1. `AGENTS.md`のReviewセクションは標準フローを「Claude実装 → Codex独立レビュー → Claude修正」と固定している。一方で、Codexが更新した場合のClaudeレビュー依頼方法も規定しており、記述内で役割固定と役割反転の扱いが混在している。
2. `CLAUDE.md`のClaude Roleは要件整理・設計・実装・統合をClaudeの主担当として列挙しており、タスクごとに実装担当を選ぶ方針と両立しない。
3. 作業前レビューの説明はレビュー先をCodexに固定し、レビュー実行方法も`scripts/codex-review.ps1`だけを指定しているため、Codex実装・Claudeレビューの標準手順が共通規約から読み取れない。

## Proposed Changes

- `AGENTS.md`:
  - 標準フローを「実装担当 → もう一方の独立レビュー → 実装担当による修正・再検証」に一般化する。
  - ユーザーによる担当指定を優先する。指定がない場合は、着手するエージェントが、(1)対象ファイルを更新でき必要な検証を実行できるか、(2)直近の関連作業・コードのコンテキストを持つか、(3)実装者と異なる独立レビュアーを確保できるか、の順で実装担当とレビュアーを選ぶ。両者が同等なら依頼を受けた側を実装担当とし、理由とともに対象タスクファイルへImplementation OwnerとReviewerを記録する。レビュアーは実装前レビューで分担の妥当性も確認する。
  - どちらが実装担当でも、実装前に調査結論・変更方針をタスクファイルへまとめ、実装していない側がread-onlyレビューする。
  - 実装後も同じレビュアーが成果物をread-onlyレビューし、実装担当が指摘の採否を判断して修正・再検証する。
  - レビュアーを確保できない場合は自己レビューで代替せず、実装前方針レビューまたは完了判定の前で停止する。
  - Claude実装時は既存の`scripts/codex-review.ps1`、Codex実装時はCodexからClaude CLIをread-only設定で直接実行する。逆方向専用のラッパースクリプトは本タスクでは追加しない。T018のReview 1・2は、Codexが`claude -p --permission-mode plan --tools "" --no-session-persistence`を直接起動し、ユーザーのコピー操作を介さず終了コード0でレビュー本文を取得できたため、この方法を利用可能と確認済み。
  - 「ユーザー指示による更新」の明記義務は、ユーザーが特定のエージェントへプロジェクト内ファイルの更新を明示的に依頼した場合に適用し、どちらが実装担当でも同じ情報をレビュー依頼冒頭に記載する共通ルールへ一般化する。
  - Implementation OwnerとReviewerの記録は、T018以降に新規作成するタスクと、StatusがProposed/In Progressの既存タスク、または完了後に新たな実装作業のため再オープンする既存タスクへ適用する。完了済みタスクへの遡及追記と、完了済み成果物の参照・read-only確認だけを行うタスクへの追記は行わない。
- `CLAUDE.md`:
  - Claudeの役割を固定せず、タスクごとに実装担当または独立レビュアーを担う記述へ変更する。
  - Claudeがレビュアーの場合はファイルを変更せず指摘のみ返すこと、Claudeが実装担当の場合は従来どおりCodexレビュー結果を評価・反映することを明記する。
  - Collaborationセクションのレビュー依頼手段を「Claudeが実装担当の場合」に限定し、Claudeがレビュアーの場合のread-only責務を追記する。
- `STATUS.md`: T018の変更内容、Claudeによる実装前・実装後レビュー、検証結果を記録する。2026-09-02の役割固定方針は当時の決定履歴として残し、2026-09-06に役割可変型へ変更したことを新しい決定として追記する。

## Acceptance Criteria

- [x] `AGENTS.md`からClaude/Codexの恒常的な実装・レビュー役割固定がなくなっている
- [x] タスクごとにImplementation OwnerとReviewerを指定するルールが明記されている
- [x] ユーザー指定がない場合の担当選定主体・基準・記録方法が明記されている
- [x] Claude実装・Codexレビューと、Codex実装・Claudeレビューの両方で、実装前方針レビューと実装後成果物レビューが必須の標準フローとして読める
- [x] レビュアーはread-onlyで指摘のみ、実装担当が採否判断・修正・再検証を行う責任分界が維持されている
- [x] 影響範囲が自明に小さい変更に対する既存のレビュー省略基準が維持されている
- [x] `CLAUDE.md`と`AGENTS.md`の役割・レビュー方針が矛盾しない
- [x] 既存の役割固定方針を履歴として残しつつ、変更日と新方針を`STATUS.md`から追跡できる
- [x] Claudeによる変更前レビューと変更後レビューで、修正すべき重大な問題がない
- [x] `git diff --check`が成功する

## Out of Scope

- アプリ本体、バックエンド、モバイルアプリの変更
- `scripts/codex-review.ps1`の変更
- 新しいレビュー用スクリプトや依存ライブラリの追加
- 各モデルの恒常的な得意分野を決め打ちすること

## Constraints

- 既存の未コミット変更がある場合は変更せず、本タスクの文書差分だけを扱う
- `AGENTS.md`を共通ルールの正本とし、ツール固有の詳細は必要最小限にする
- ユーザーの明示指示による更新であること、指示の要旨、Codexが更新する対象ファイルをClaudeへのレビュー依頼冒頭で明記する

## Verification

- `AGENTS.md`・`CLAUDE.md`・`STATUS.md`間の整合性確認
- `git diff --check`
- Claude read-onlyレビュー（実装前・実装後）

## Implementation Owner

Codex

## Reviewer

Claude Code

## Review History

### Review 1（実装前、Claude Code、2026-09-06）

- P0: なし
- P1: Codex実装時のClaudeレビューにCodexレビュー相当のラッパースクリプトがなく、運用が非対称。判断: 専用スクリプトがない点は事実だが、CodexからClaude CLIをread-only設定で直接実行でき、本レビューもその方法で実施したため「ユーザーが仲介する手動実行」という前提は不採用。直接実行する標準手順と、ラッパー追加がスコープ外であることを明記
- P1: `STATUS.md`に残る2026-09-02の役割固定方針との関係が未定義。反映: 当時の履歴は残し、2026-09-06の変更決定を追記する方針を明記
- P1: 実装担当の選定主体・時期・基準が未定義。反映: ユーザー指定を優先し、指定がなければ着手エージェントが利用可能ツール・既存コンテキスト・変更範囲を基準に選定・記録し、実装前レビュー対象に含める方針を明記
- P2: 過去タスクへのImplementation Owner/Reviewer欄の適用範囲が不明。反映: 新規タスクと今後再開する既存タスクへ適用し、完了済みタスクへは遡及しない
- P2: 「ユーザー指示による更新」の適用境界が曖昧。反映: ユーザーが特定のエージェントへプロジェクト内ファイルの更新を明示的に依頼した場合と定義
- P3: `CLAUDE.md`の具体的な置換文言は実装後レビューで確認する

### Review 2（実装前再レビュー、Claude Code、2026-09-06）

- P0: なし
- P1: CodexからClaude CLIを直接実行できた根拠がレビュー資料から確認できない。反映: Review 1・2はいずれもCodexが`claude -p`をread-only設定で直接起動し、ユーザーのコピー操作なしで終了コード0のレビュー本文を取得したことをProposed Changesへ実証結果として追記
- P2: 担当選定基準が抽象的。反映: 必要な更新・検証能力、直近の関連コンテキスト、独立レビュアー確保の順に判断し、同等なら依頼を受けた側を実装担当とする決定順を明記
- P2: `CLAUDE.md`のCollaborationセクションにあるCodexレビュー依頼手段の扱いが未記載。反映: Claudeが実装担当の場合に限定する変更と、Claudeがレビュアーの場合の責務追記を明記
- P3: 「再開して更新する既存タスク」の判定基準が曖昧。反映: Proposed/In Progress、または新たな実装のため再オープンする場合に適用し、完了済み成果物のread-only確認だけなら適用しないと定義

### Review 3（実装前最終レビュー、Claude Code、2026-09-06）

- 1回目の応答は前置きだけで終了して判定本文が無かったため、レビュー完了と扱わず内容を絞って再実行
- P0/P1: なし
- P2: Claude CLIの具体的な直接実行例を`STATUS.md`にも残すことを推奨。採用し、2026-09-06の決定記録へ追記
- P3: 既存の軽微変更に対するレビュー省略基準と、`CLAUDE.md`の具体的な文言を実装後レビューで確認すること
- 結論: 重大な問題なし。実装着手可

## Implementation Summary

- `AGENTS.md`のReviewセクションを役割可変型へ変更し、担当選定、実装前方針レビュー、実装後成果物レビュー、read-only責務、適用範囲、ユーザー指示による更新の明記をClaude/Codex双方へ一般化
- Reviewerを確保できない場合は自己レビューで代替せず、方針レビュー前または完了判定前で停止する安全弁を追加
- `CLAUDE.md`のClaude RoleとCollaborationを、Implementation OwnerとReviewerのどちらも担える内容へ変更
- `STATUS.md`の現在のOwner/Reviewerをタスク単位へ変更し、2026-09-02の旧方針を履歴として残したうえで、2026-09-06の新方針とClaude CLIの再現可能な実行例を追記

## Implementation Verification

- `git diff --check`: PASS（LFからCRLFへの作業ツリー警告のみ）
- `rg`による`AGENTS.md`・`CLAUDE.md`・`STATUS.md`・T018の役割記述照合: PASS
- `npm run typecheck`・`npm test`・`flutter analyze`: 未実行（ドキュメントのみの変更でアプリコードへの影響なし）

### Review 4（実装後、Claude Code、2026-09-06）

- P0/P1: なし
- P2: `AGENTS.md`へ追加した「Reviewer未確保時は停止する」安全弁がT018のProposed Changesへ未記載。反映: Proposed ChangesとImplementation Summaryへ追記
- P3: ClaudeがImplementation Ownerの場合のレビュー手順が`AGENTS.md`と`CLAUDE.md`で重複。判断: 共通フローの正本とClaude固有の実行責務という異なる読者向けであり、内容も一致しているため現状維持
- P3: 旧`codex exec --sandbox read-only`の詳細説明が`AGENTS.md`から減った。判断: 実行の詳細は既存スクリプトとClaude固有文書が担い、共通規約には利用手段が残っているため追加しない
- P3: Claude側から今回の呼び出し経路を確認できない。判断: Review 1〜4はいずれもCodexがClaude CLIを直接起動して終了コード0で取得しており、Implementation Owner側で実証済みのため追加対応なし
- 結論: 重大な問題なし。P2反映後は完了可能

### Review 5（P2反映後の最終確認、Claude Code、2026-09-06）

- Review 4のP2で求められたReviewer未確保時の停止規定が、T018のProposed Changes・Implementation Summary・`AGENTS.md`で一致していることを確認
- 新たなP0/P1/P2: なし
- 結論: 重大な問題なし。完了可
