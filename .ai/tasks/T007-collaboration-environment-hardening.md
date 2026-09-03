# T007: Claude/Codex共同環境の小規模修正

Status: Complete

## Goal

共同環境の点検で実機再現したレビュー用スクリプトの空差分時エラーを修正し、`CLAUDE.md`のレビュー方針を正本の`AGENTS.md`と一致させる。

## Findings

1. `scripts/codex-review.ps1`は、差分も未追跡ファイルもない状態で`$untrackedPaths`が`$null`になり、StrictMode下の`$untrackedPaths.Count`参照で異常終了する。また、差分なし・未追跡ファイル1件では文字列スカラーになり、同じ参照が異常終了する。PowerShell 5.1.26100.9168とPowerShell 7.6.4で、`$null`・文字列スカラーの両方について再現済み。本来は0件なら「レビュー対象がない」と警告して終了コード0、1件なら未追跡ファイルをレビュー対象に含める設計である。
2. `CLAUDE.md`は「重要な実装が終わったら、必要に応じてCodexへ独立レビュー」としているが、正本の`AGENTS.md`は、影響範囲が自明に小さい変更を除き、調査・改修方針の実装前レビューと実装後レビューを標準としている。`CLAUDE.md`の説明が旧方針のままである。

## Proposed Changes

- `scripts/codex-review.ps1`: 未追跡パス抽出パイプライン全体を`@(...)`で包み、0件でも空配列として扱う。既存の秘密情報ガードや未追跡ファイル処理は変更しない。
- `CLAUDE.md`: 方針の重複による再ドリフトを防ぐため、具体的なレビュー条件を再掲せず、レビューの実施基準・タイミングは`AGENTS.md`のReviewセクションを正とするという参照だけに置き換える。
- `STATUS.md`: 修正内容、Claudeレビュー結果、検証結果を記録する。

## Acceptance Criteria

- [x] 差分も未追跡ファイルもない一時Gitリポジトリで、`scripts/codex-review.ps1`が「レビュー対象がない」旨を表示して終了コード0になる
- [x] 差分なし・未追跡ファイル1件の一時Gitリポジトリで、StrictModeの`.Count`エラーを起こさずレビュー処理へ進むことを、Codex呼び出しをテスト用スタブへ差し替えて確認する
- [x] 上記をWindows PowerShell 5.1とPowerShell 7の両方で確認する
- [x] 差分がある場合のレビュー処理、未追跡ファイルの安全処理に意図しない変更がない
- [x] `CLAUDE.md`と`AGENTS.md`のレビュー方針が矛盾しない
- [x] Claudeによる変更前レビューと変更後レビューで、マージ前に直すべき問題がない
- [x] `git diff --check`が成功する

## Out of Scope

- `scripts/codex-review.ps1`の既知の別課題(`-Base`時の未コミット差分漏れ、未追跡ディレクトリ展開、全タスクファイルの無条件埋め込み、自動テスト基盤の追加)
- T006のジャッジ認証強化案と、そのステージ済みファイル
- アプリ本体、バックエンド、モバイルアプリの変更

## Constraints

- T006を含む既存のユーザー/Claude変更を変更しない
- 新しい依存ライブラリを追加しない
- PowerShellスクリプトのUTF-8 BOMを維持する

## Verification

- PowerShell構文解析
- 一時Gitリポジトリを用いたPowerShell 5.1/7の空差分E2E
- `git diff --check`
- Claude read-onlyレビュー

## Implementation Owner

Codex

## Reviewer

Claude Code

## Review History

### Review 1(実装前、Claude Code、2026-09-03)

- P0: なし
- P1: PowerShell 7での再現を実機確認すること。確認結果: PowerShell 7.6.4でも`$null.Count`と文字列スカラー`.Count`がStrictMode下で異常終了することを再確認し、本ファイルへ具体的なバージョンを追記
- P2: 未追跡ファイル1件のケースもAcceptance Criteriaへ追加すること。反映済み
- P2: `CLAUDE.md`へ共通方針を再掲せず、`AGENTS.md`への参照だけにすること。反映済み
- P3: PowerShellの具体的なバージョンと、1件ケースも直す理由を記録すること。反映済み

### Review 2(実装後、Claude Code、2026-09-03)

- P0: なし
- P1: `STATUS.md`へ修正・レビュー・検証結果を記録すること。反映済み
- P2: Acceptance Criteriaの変更後レビュー項目を完了し、Review Historyへ記録すること。反映済み
- P3: 手動E2Eの再現方法を残すと有用。今回は一時Gitリポジトリへスクリプトと必要ファイルをコピーし、Codex関数スタブを使って空差分・未追跡1件をPowerShell 5.1/7で実行した方法を本ファイルへ記録
- 結論: コード修正と`CLAUDE.md`修正自体は重大な問題なし

### Review 3(最終確認、Claude Code、2026-09-03)

- P0/P1/P2/P3: なし。Review 2の`STATUS.md`更新・T007完了記録が解消済みであることを確認
- 結論: 重大な問題なし。マージ可能

## Implementation Verification

- PowerShell 7.6.4: 空差分は警告を表示して終了コード0、未追跡1件はCodexスタブ呼び出しまで進んで終了コード0
- Windows PowerShell 5.1.26100.9168: 空差分は警告を表示して終了コード0、未追跡1件はCodexスタブ呼び出しまで進んで終了コード0
- PowerShell 7/5.1の構文解析: PASS
- `scripts/codex-review.ps1`のUTF-8 BOM維持: 確認済み
- `git diff --check`: PASS(LF→CRLFの作業ツリー警告のみ)
