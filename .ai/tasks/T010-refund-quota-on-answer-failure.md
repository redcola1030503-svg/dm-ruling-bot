# T010: 裁定に回答できなかった場合、無料枠を消費しないようにする

Status: 実装済み・Codexコードレビュー完了(T012実装差分レビューのReview 5に同梱、下記参照)。本番デプロイは未実施

## Goal

ユーザーが実機で、質問に対し「現在、公式情報を取得できませんでした。誤った裁定を返す可能性があるため、今回は回答を保留します。」という結果(confidence: low)を受け取った事例をスクリーンショットで報告した(質問:「《〜輝きは奇跡そのもの〜》が場にいる時、ワールドブレイクをするとシールドは何枚ブレイクされる?」)。この場合でも無料枠(月10問)が1問分消費されてしまう。**システム側の都合で回答を返せなかった場合は、無料枠を消費しないようにしてほしい**という要望。

## 現状の実装(コード確認済み)

無料枠の消費と裁定生成は**別のタイミング**で行われている。

1. `POST /api/ruling/jobs`(`src/routes/rulingJobs.ts:65-72`)がジョブ作成と同時に`createJobTransactionally({ consumeFreeQuota: !access.hasActiveSubscription, ... })`を呼び、`incrementMonthlyUsage`(`src/billing/deviceMonthlyUsageRepository.ts:12-19`)で`device_monthly_usage`テーブルのカウンタを**その場で加算する**(`billingTransaction.ts:9-29`)。この時点では、まだ裁定生成(LLM呼び出し・公式サイト参照)は行われていない。
2. その後`runRulingJobInBackground`(`src/ruling/rulingJob.ts:25-68`)がバックグラウンドで`produceRuling`(`src/ruling/produceRuling.ts:92-157`)を呼び出し、結果を`markDone(jobId, outcome.status, outcome.result)`でジョブへ保存する。
3. `produceRuling`が返す`status`は4種類ある(`ProduceRulingOutcome`型、`produceRuling.ts:45-49`):
   - `"ok"`: 正常に裁定を生成できた
   - `"evidence_error"`: 公式サイト等からの根拠取得に失敗(`retrieveEvidence`が例外を投げた場合、`officialSiteUnreachableResult()`を返す)。**今回のユーザー報告事例はこれ**
   - `"llm_error"`: LLM呼び出しが失敗(`generateRuling`が例外を投げた場合、`llmFailedResult()`を返す)
   - `"needs_clarification"`: カード名を一意に確定できず、LLMには回さずユーザーに確認を求める(`ambiguousCardResult()`)

**つまり、無料枠は「ジョブを受け付けた時点」で無条件に消費され、実際に`produceRuling`がどの結果を返すかとは無関係**。ユーザー報告の通り、`evidence_error`・`llm_error`のような**システム側の都合による失敗**でも消費されてしまう。

## 対応方針(ユーザー方針確定、2026-09-04。Review 1指摘を反映し改訂)

`outcome.status`が`"evidence_error"`・`"llm_error"`・`"needs_clarification"`の**いずれの場合も**無料枠を返金する。**`"ok"`(正常に裁定を生成できた)の場合のみ消費を確定させる。**

- **`needs_clarification`を含める理由(ユーザー判断)**: カード名が確定できずユーザーへ確認を求めている段階では、まだ実質的な回答を得られていないため、`evidence_error`/`llm_error`と同様に無料枠を消費すべきではないという判断。

### 実装設計(Review 1のP1指摘を反映)

単純な「完了時に1減算」では、(a)プロセス再起動やDB更新失敗時に返金漏れ・重複返金が起こりうる、(b)`produceRuling`自体がreject(例外)した場合と、結果保存後の通知送信失敗が同じ`.catch`で扱われ区別できない、という2つの問題がReview 1で指摘された。これを踏まえ以下の設計とする。

1. **`ruling_job`テーブルに列を追加**: `usage_month_key TEXT`(消費した無料枠のmonthKey、消費していない場合はNULL)・`refunded_at INTEGER`(返金済みなら時刻、未返金ならNULL)。
2. **ジョブ作成時(`createJobTransactionally`)**: `consumeFreeQuota`がtrueの場合、`incrementMonthlyUsage`と同一トランザクション内で、そのとき使った`monthKey`を`ruling_job.usage_month_key`へ書き込む。これにより、完了時の処理は`nowMs`/`consumeFreeQuota`をメモリ(クロージャ)で引き継ぐ必要がなく、DBの`ruling_job`行から直接読み取れる(プロセス再起動にも耐える)。
3. **ジョブ確定処理を1トランザクション化**: `markDone`/`markFailed`と条件付き返金を1つの関数(例: `finalizeRulingJob(jobId, outcomeStatus, result)`)にまとめ、`billingTransaction.ts`と同様のBEGIN/COMMIT/ROLLBACKで実行する。**返金対象を特定するキー(`device_id`)は、呼び出し元の引数やクロージャではなく、必ず`ruling_job`テーブルに永続化済みの当該ジョブ行(`device_id`列、既存)から読み取る**(Codexレビュー指摘: `device_monthly_usage`は`device_id`+`monthKey`の組で管理されており、これを引数等メモリ経由の値に依存すると、別端末のカウンタを誤って減算するリスクがある)。処理内容:
   - **(T012 Review 2のP1指摘を反映、重要な訂正)**: `refunded_at IS NULL`という値の事後チェックだけでは冪等性を担保できない。例えば既に`status='done', outcome_status='ok'`で正常確定済みのジョブ(`refunded_at`はNULLのまま、返金対象外だったため)に対し、何らかの理由で`finalizeRulingJob`が誤って再度呼ばれると、`refunded_at IS NULL`の条件を満たしてしまい、正常回答が返金対象として上書き・二重処理されうる。**確定処理はまず`UPDATE ruling_job SET status=?, outcome_status=?, result_json=?, finished_at=? WHERE id=? AND status IN ('pending','running')`のように、現在のstatusが未確定状態であることを更新条件に含めた上で実行し、実際に更新された行数(SQLiteの`changes`)が1件の場合のみ**、続けて返金要否判定(`usage_month_key`が非NULL かつ`outcomeStatus`が返金対象)を行い`decrementMonthlyUsage`・`refunded_at`更新に進む。更新件数が0件(=既に他の経路で確定済み)の場合は、返金処理も後続の通知処理も行わずそのまま終了する。
   - `finalizeRulingJob`は呼び出し元へ「実際にこの呼び出しが確定処理を行ったか(成功/競合負け)」を返す。競合に負けた(=他の経路が先に確定していた)場合、呼び出し元(`rulingJob.ts`)はプッシュ通知等の後続処理を実行しない(二重通知防止)。
4. **`produceRuling`自体がreject(例外)した場合も返金対象に含める**: `produceRuling.ts:97`の`analyzeQuestion`は現状try外にあり、ここで例外が発生すると`rulingJob.ts`側の`.catch`(`markFailed`)へ進み、回答が一切生成されないまま無料枠だけ消費された状態になる。**この経路も「回答を返せなかった」に含め、返金対象とする**。
5. **通知送信失敗とは明確に分離する**: `produceRuling`が正常に解決し`markDone`相当の確定処理(返金判定込み)が完了した**後**の、プッシュ通知送信(`sendPushNotification`)やその後始末での失敗は、既に回答自体は保存済み(`GET /api/ruling/jobs/:jobId`で取得可能)なので**返金しない**。`rulingJob.ts`のPromiseチェーンを、「produceRuling解決/reject→確定処理(返金判定含む)」と「確定後の通知処理(失敗しても返金に影響しない)」の2段階に分離する実装変更が必要。
6. **`device_monthly_usage`テーブルには減算関数が無い**(`deviceMonthlyUsageRepository.ts`は`incrementMonthlyUsage`のみ)。新設する`decrementMonthlyUsage(deviceId, monthKey)`は、上記3.の通り`ruling_job`行から読み取った`device_id`・`usage_month_key`を引数として渡し、0未満にならないよう`MAX(count - 1, 0)`等でガードする。
7. **購読中(`hasActiveSubscription`)は元々無料枠を消費していない**ため、`usage_month_key`がNULLのまま(上記2)であり、返金判定は自然にスキップされる(追加のフラグ引き回しは不要になった)。
8. **不正利用のリスク**: `evidence_error`は公式サイト接続障害等のインフラ要因、`llm_error`はLLM API側のエラーが主因であり、いずれもユーザーが意図的に狙って再現しやすい経路ではない。一方`needs_clarification`は「公式名と一致しないカード名を入力する」というユーザーが完全に制御できる入力で確実に発生させられるため、性質が異なる。実際の裁定は得られないため悪用の実利は乏しいと考えられるが、無料枠を無限に温存する目的での意図的な連発(例: 存在しないカード名を繰り返し送る)が可能になる点は留意事項として残す(対応は見送り、実害が出た場合に再検討)。
9. **既存のP1未解決事項(`STATUS.md`)との関係**: 「無料枠上限判定の原子化」「ジョブ失敗時のスレッドロールバック」がすでに`actions/dm-ruling-bot_残作業リスト.md`(Vault側)にfollow-upとして記録されている。今回の返金処理も無料枠カウンタを操作する変更のため、同種の並行実行時の整合性リスク(現状は単一インスタンス・同期的SQLite呼び出しのため実害は低いと判断されている前提)を踏まえて設計する。
10. **(T012 Review 4のP1指摘を反映)既存の未完了ジョブは自動返金の対象外**: `usage_month_key`列はこの変更のデプロイ後に作成されたジョブにしか記録されない。デプロイ時点で既に存在する未完了ジョブ(孤立ジョブX等、T012(A)の回収処理で`status='failed'`へ確定されるもの)は`usage_month_key`が`NULL`のままのため、上記3.の返金判定を素通りし自動では返金されない。自動マイグレーション(過去ジョブへの`usage_month_key`遡及付与)は、当時の購読状態を正確に再現できない(`hasActiveSubscription`の履歴を保存していない)ため行わない。デプロイ時点で残っている未完了ジョブがあれば、本番の`device_monthly_usage`/`ruling_job`を個別に確認し、無料枠を消費していたと判断できる場合は手動で返金する(詳細は`.ai/tasks/T012-remove-batch-api.md`の「孤立ジョブXへの対応」参照)。
11. **(T012 Review 2のP1指摘を反映)ジョブ開始直後の同期例外**: `rulingJob.ts`の`runRulingJobInBackground`は`runningCount++`・`markRunning(jobId)`をPromiseチェーン開始前に同期実行しており、ここでDB例外等が発生すると`.then`/`.catch`のどちらも通らず、既に消費済みの無料枠・作成済みジョブ行がそのまま取り残される(`runningCount`のデクリメントもされない)。この経路は`finalizeRulingJob`のtry/catch範囲外のため、`runRulingJobInBackground`全体を同期例外も捕捉できる形(例: 関数冒頭の同期処理も含めて`try`で囲み、例外時は`finalizeRulingJob`相当の失敗確定を呼ぶ)にするか、少なくともT012(A)の汎用孤立ジョブ回収(`status IN ('pending','running')`かつ経過時間超過を定期的に回収)でこの経路も最終的にカバーされることをテストで確認する。

## Acceptance Criteria(現段階)

- [x] needs_clarificationの扱いについてユーザーへ確認する → **2026-09-04、「含める」で確定**(evidence_error/llm_error/needs_clarificationのすべてを返金対象とする)
- [x] AGENTS.mdの運用に従いCodexへ方針決定段階のレビューを依頼する → **2026-09-04、Review 1実施・反映済み(下記Review History参照)**
- [x] Review 2〜4(改訂した実装設計への波及指摘)を反映する → **2026-09-04完了(下記Review History参照)**
- [x] レビュー反映後、実装に着手する(`ruling_job`へのカラム追加・マイグレーション、`decrementMonthlyUsage`新設、`finalizeRulingJob`相当の実装、`rulingJob.ts`のPromiseチェーン分離、テスト追加) → **2026-09-04完了**。`npm run typecheck`・`npm test`(46ファイル/305テスト)PASS。ローカルdevサーバーでの実機確認(通常完了時は返金無し、孤立ジョブ回収時は返金あり)も完了
- [x] 返金対象の範囲を明確化する → **2026-09-04、実装中に判明した論点を反映**: 当初「処理中ジョブが載ったスレッドを削除した場合も返金する」実装を追加したが、Codexレビューで「バックグラウンドの`produceRuling`自体を止める手段が無いため、質問作成→即座にスレッド削除を繰り返すことで無料枠を消費せずに外部APIコストだけを発生させられる」悪用経路になると指摘され、**この返金は取り消した(スレッド削除時は元の挙動通り返金しない)**。T010の対象は明示的に「システム側都合の失敗」(evidence_error/llm_error/needs_clarification/produceRuling自体のreject)に限定し、ユーザー起因の削除・キャンセルは対象外とする

## Implementation Owner

Claude Code(2026-09-04、ユーザー「自己判断できる課題を進めて」指示により実装)

## Reviewer

Codex

## Review History

### Review 1 — 2026-09-04(方針決定段階、単純な1減算案のドラフト)

- P1: 単純な「完了時に1減算」は原子的でも冪等でもない。`markDone`と減算の間で停止すると返金漏れが残り、同じ完了処理が再実行されると別の正常利用分まで二重返金しうる。`nowMs`/`consumeFreeQuota`をメモリで引き継ぐだけではプロセス再起動にも耐えない。`ruling_job`へ課金月・返金済み状態を保存し、「ジョブ確定+条件付き返金」を1トランザクションで行う設計が必要 → `usage_month_key`/`refunded_at`列の追加、`finalizeRulingJob`への統合として反映
- P1: `ProduceRulingOutcome`の3ステータスだけを返金対象にしており、Promiseのreject経路(`analyzeQuestion`がtry外で例外を投げ`markFailed`へ進むケース)を取りこぼしていた。逆に、結果保存後の通知送信失敗は回答自体が保存済みのため返金すべきではない。両者を混同せず分離する必要がある → analyzeQuestion失敗を返金対象に追加、Promiseチェーンを確定処理と通知処理の2段階に分離する設計として反映
- P2: `STATUS.md`のT010記述が「ユーザー確認が必要」のままでタスクファイルの確定内容(「含める」)と矛盾していた → `STATUS.md`を同期して解消(下記参照)

### Review 2 — 2026-09-04(T012の方針決定レビューの一環として、T010設計への波及指摘)

T012(Batch API全廃+汎用孤立ジョブ回収)のCodexレビューで、T010本体の設計にも波及する指摘を受けた。

- P1: `refunded_at IS NULL`のみによる冪等性担保は不十分(正常確定済みジョブに`finalizeRulingJob`が誤って再度呼ばれると、値の事後チェックだけでは二重処理を防げない) → `UPDATE ... WHERE id=? AND status IN ('pending','running')`の更新件数チェックによる原子的な状態遷移に変更、呼び出し元が競合の成否を判定できるよう戻り値を追加(上記「実装設計」3.を参照)
- P1: `markRunning()`がPromiseチェーン開始前に同期実行されており、ここでのDB例外は`finalizeRulingJob`の対象経路を通らない(上記「実装設計」11.を参照)

### Review 3 — 2026-09-04(T014のP1修正差分レビューに同梱、T010設計への波及指摘)

- P1: `usage_month_key`列はデプロイ後に作成されたジョブにしか記録されないため、デプロイ時点で既に存在する未完了ジョブ(孤立ジョブX等)はT012(A)の回収処理で`failed`確定はされても自動では返金されない → 上記「実装設計」10.に、デプロイ時点で残っている未完了ジョブは個別確認・手動返金する旨を追記(自動マイグレーションは対象件数の少なさから見送り)

### Review 4 — 2026-09-04(T014のP1修正差分の再レビューに同梱、T010設計への波及指摘)

- P1: 返金対象の`device_monthly_usage`行を特定するキー(`device_id`)の取得元が設計上明記されておらず、実装時に呼び出し元のメモリ値等へ依存すると別端末の枠を誤って返金するリスクがある → 上記「実装設計」3.・6.に、`device_id`は必ず`ruling_job`行(永続化済み)から読み取る旨を明記

### Review 5 — 2026-09-04(実装完了後の差分レビュー、T012実装レビューに同梱)

- P1: 処理中ジョブが載ったスレッドを削除した際に返金する実装(実装中にT010 Review 4の指摘を踏まえて追加)が、バックグラウンドの`produceRuling`自体を停止できないため、意図的な連続作成・即時削除で無料枠を消費せずに外部APIコストだけを発生させる悪用経路になっていた → **この返金処理を取り消した**。T010の対象を「システム側都合の失敗」に明確に限定し、ユーザー起因の削除は対象外とする(上記Acceptance Criteria参照)
