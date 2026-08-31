# PR #1 (subscription-billing) 独立レビュー

- 実施日: 2026-08-31
- レビュアー: Codex(`codex exec --sandbox read-only`、diff+コンテキストをテキストで直接埋め込む方式。理由: Windows環境でread-only sandboxがローカルのgit/Get-Content実行自体を全面拒否したため、`git diff master...subscription-billing`の出力とAGENTS.md/STATUS.md/DECISIONS.mdをプロンプトに埋め込んで渡した)
- 対象: `git diff master...subscription-billing`(https://github.com/redcola1030503-svg/dm-ruling-bot/pull/1)
- 対象タスクファイル: なし(作成前にレビューを実施)

## 総評

現状はマージ非推奨。P0が1件、P1が4件。

## P0 — `deviceId`省略で課金ゲートを完全に迂回できる

- ファイル: `src/routes/rulingJobs.ts`
- 根拠: `deviceId`が存在する場合だけ無料枠を検査・加算している。旧アプリや任意のHTTPクライアントは`deviceId`を省略するだけで無制限にジョブを作成できる。D-001の赤字防止要件を満たせず、D-002で指摘された「課金回避の抜け道」と同種。
- 修正案:
  - モバイル用の`POST /api/ruling/jobs`では`deviceId`を必須にする
  - 旧バージョン互換が必要なら期限付きの移行策や強制アップデートを設ける。無期限の無料バイパスは残さない
  - `deviceId`省略時に400/401となり、カウントを回避できない統合テストを追加する
  - 自己申告ID自体も変更可能なため、正式な不正利用対策が必要ならApp Attest/Play Integrity等は別課題として検討

## P1 — 購読中の質問まで無料枠カウンタを消費する

- ファイル: `src/routes/rulingJobs.ts`
- 根拠: アクセス許可の理由(無料枠/有効購読)に関係なく全ジョブで`incrementMonthlyUsage()`している。月途中で購読が失効・返金されると、実際には無料利用していなくても無料10問を消費済み扱いになる。D-001の「無料枠10問＋購読中は使い放題」の想定と不一致。
- 修正案:
  - `evaluateRulingAccess`から`hasActiveSubscription`または`consumeFreeQuota`を返す
  - 有効購読で許可されたジョブでは無料枠を加算しない
  - 「購読失効後も当月未使用の無料枠が残る」テストを追加

## P1 — 遅延した`EXPIRATION`/`REFUND`が新しい更新状態を巻き戻す

- ファイル: `src/billing/revenueCatEventPolicy.ts`, `src/routes/billing.ts`
- 根拠: `EXPIRATION`/`REFUND`は現在の`active_until`より古くても無条件で反映される。新しい`RENEWAL`反映後に旧期間の`EXPIRATION`が遅延到着すると即座に失効扱いになる。
- 修正案:
  - 古い`expiration_at_ms`はイベント種別によらず上書きしない
  - 期限前失効の即時反映が必要ならWebhook値だけで判断せずRevenueCat REST APIから現在のエンタイトルメントを再取得
  - `RENEWAL(new)→EXPIRATION(old)`/`RENEWAL(new)→REFUND(old)`の順序逆転テストを追加

## P1 — ジョブ作成と使用回数加算が同一トランザクションではない

- ファイル: `src/routes/rulingJobs.ts`, `src/billing/deviceMonthlyUsageRepository.ts`
- 根拠: `createJob()`成功後に別DB操作でカウンタを加算しており、加算失敗時にジョブだけ残り500になり得る。将来複数プロセス化した場合は「件数取得→許可判定→加算」が競合し上限超過を許してしまう。
- 修正案:
  - 枠確保・ジョブ作成・カウンタ加算をSQLiteトランザクション内で行う
  - 可能なら条件付きUPDATE/UPSERTで「上限未満の場合だけ加算」を原子的に行う
  - 加算失敗時のロールバック、上限直前の並行要求のテストを追加

## P1 — 重要な課金ルートの統合テストがない

- ファイル: `tests/`, `src/routes/billing.ts`, `src/routes/rulingJobs.ts`
- 根拠: 追加テストは純粋関数・Repository単体のみ。ルート配線・402応答・Webhook認証・欠損フィールド時のREST照会・同期APIの状態反映が未検証で、上記P0のような抜け道も検出できない。
- 修正案: 少なくとも以下をルートレベルで追加
  - 10件目成功・11件目402
  - 402時はジョブ・カウンタとも増えない
  - `deviceId`省略は拒否
  - 有効購読時は許可
  - Webhook認証失敗は401
  - 欠損`expiration_at_ms`でREST取得失敗なら状態保持のうえ502
  - 遅延イベントで新しい購読状態を巻き戻さない

## P2 — Webhookとアプリ同期が同一IPレート制限枠を共有

- ファイル: `src/routes/billing.ts`, `src/utils/rateLimit.ts`
- 根拠: RevenueCat Webhookと`/api/billing/sync`が同じIP単位30回/分制限を共有。購入集中時やキャリアNAT環境で正規イベントが429になり得る。
- 修正案:
  - Webhookとクライアント同期でLimiterを分離
  - Webhookは認証済み前提で上限を上げるか、イベントIDによる冪等性で保護
  - `/sync`はIPだけでなく`deviceId`単位の制限も検討

## 実装側(Claude Code)の判断待ち

- 上記はCodexの指摘であり、まだコード・テスト結果と照合していない(反映するかはこれから判断)
- 特にP0の「`deviceId`必須化」は既存配信済みバージョン(v1.4.0〜v1.6.1)との互換性に影響するため、対応方針(強制アップデート要否・移行期間)は人間の判断が必要
