# T012: Batch API全廃+汎用的な孤立ジョブ回収の実装

Status: 実装済み・Codexコードレビュー完了(Review 9まで実施)。Review 8で指摘されたプロセス内メモリ(`runningJobIds`)の限界(デプロイ時の新旧プロセス並存問題)を、DBベースのworker_id/heartbeatリース方式で解消済み(Review 9参照)。実機での動作確認(ローカルdevサーバー・実SQLiteでの検証スクリプト)も完了。本番デプロイは未実施。T008の残存確認をユーザーへ確認依頼中

## Goal

ユーザーから「デュエマ裁定確認アプリに質問を送っても応答がない」との報告を受け調査した結果、Batch API(Anthropic Message Batches API、入出力とも50%割引だが完了時間の保証なし)経由の裁定生成が体感で「止まっている」と感じられるほど遅く、ユーザーへの説明の結果「Batch APIを全廃し、常に通常APIを使う」方針で検討を進めることになった(ユーザー判断、2026-09-04)。

Codex Review 1で「Batch API全廃だけでは孤立ジョブ問題は根本解消しない」という、当初案の前提を覆す指摘を受けたため、対応範囲を(A)汎用的な孤立ジョブ回収の実装 + (B)Batch API全廃、の2本立てに拡張して改訂した。

## 調査結果(2026-09-04、本番DB・Renderダッシュボード確認済み)

### 発見した事実

1. **本番環境変数 `RULING_USE_BATCH_API` は `true` に設定されている**(Render Web Shellで確認)。コード側のデフォルト値は`"false"`(`src/config/env.ts`)だが、本番はこの環境変数で明示的に有効化されていた。
2. ユーザーが「昨日2時頃(2026-09-04未明)に同じ質問を2回送信し、昨晩は反応がなかったが朝になって回答が返ってきていた」と報告した件を本番DB(`ruling_job`テーブル)で確認したところ、該当する2件のジョブは実際には**42分・86分後に`status='done', outcome_status='ok'`で正常完了していた**。「応答が永久に無い」わけではなく、Batch APIの完了時間のばらつき(コード内コメント通り「通常1時間以内、保証なし、最大24時間」)により、就寝前に確認した時点ではまだ未完了で、寝ている間に完了・体感上「一晩放置されていた」ように見えたことが原因と判明した。
3. 上記調査と同時に、[[project-dm-ruling-bot|T011]](`.ai/tasks/T011-orphaned-batch-job-on-restart.md`)で発見済みの**真に永久に完了しないジョブ**(以下「孤立ジョブX」と呼ぶ。作成日時2026-09-01、調査時点で経過57時間超。実際のジョブIDは本番DBを直接参照。本ファイルは公開リポジトリで管理されるため、認証不要API`GET /api/ruling/jobs/:jobId`経由で特定されうる実際のIDはここに記載しない)が依然として`status='running'`のまま残存していることを再確認した。
4. 同じ本番DB調査で、Batch API経由の応答時間には大きなばらつきがあることを確認した(今回の調査対象4件で37秒(evidence_error、LLM呼び出し前に失敗)・42分・86分・3.3分)。過去の記録(`STATUS.md`、T004検証時)でも「約2分」という、今回とは大きく異なる所要時間の実績がある。同じ実装でも数分〜1.5時間以上の幅で完了時間が変動しており、ユーザー体験として一貫しない。

### 問題の切り分け(2段階)

- (A) **Batch APIの正常だが遅いレイテンシ**(今回の2件、42分・86分): 設計通りの動作だが体感速度が悪く、就寝等でユーザーが確認しない時間帯を挟むと強い不満につながる。
- (B) **T011: プロセス再起動により処理状態が失われ永久に完了しない**(孤立ジョブX、経過57時間超)。

**Codex Review 1で判明した重要な訂正**: 当初(B)の原因を「Batch APIのポーリングがメモリ上でのみ行われるため」と限定していたが、実際には**通常API経路でも同じ問題が起こりうる**。`src/ruling/rulingJob.ts`の`runRulingJobInBackground`は、HTTPレスポンス返却後の裁定生成処理(証拠取得・LLM呼び出し・結果保存)を全てプロセスメモリ上の`Promise`チェーンとして実行しており、Batch/通常APIを問わず、この処理の途中でプロセスが再起動すれば`markDone`/`markFailed`のどちらも呼ばれないまま`ruling_job.status`が`pending`/`running`に取り残される。Batch APIは処理時間が長い(最大24時間)ぶんデプロイと重なる確率が高いだけで、**発生確率の差であって根本原因の違いではない**。

## 決定(ユーザー判断、2026-09-04。方針の骨子はCodex Review 1後も維持、実装範囲を拡張)

1. **(A) 汎用的な孤立ジョブ回収を実装する**: サーバー起動時、`status IN ('pending','running')`のジョブを一定時間(要検討、後述)以上経過しているものについて、原因(Batch/通常API)を問わず`failed`へ確定し、消費済みの無料枠を返金する。これが実際の「孤立ジョブ問題」への根本対応であり、Batch API全廃の有無に関わらず必要。
2. **(B) Batch APIを全廃し、常に通常API(同期呼び出し)で裁定生成する**: (A)とは独立に、体感レイテンシ(40〜90分超のばらつき)そのものを解消するために実施する。購読者は既に`access.hasActiveSubscription`により常に通常APIへ固定されているため、この決定は無料枠ユーザーにも同じ扱いを拡張するもの。

### 採用の根拠

- (A)は、T011で発見された「孤立ジョブX」のような個別インシデントへの対症療法(手動DB修正)を、恒久的な自動回収の仕組みに置き換える。Batch API全廃後も、通常API経路でのプロセス再起動(デプロイ・クラッシュ等)によるジョブ孤立は原理的に起こりうるため、(A)は(B)と独立に必要。
- (B)の妥当性については、後述「コスト再試算」の通り、無料枠ユーザー全体をBatch→通常APIに切り替えた場合の追加コストは、現在の実利用データ(2026-08-19〜08-31、48台・127ジョブ)を前提にすると小さいと見積もられる。
- (A)を実装すれば、環境変数切り替えに伴うプロセス再起動で発生する一時的なジョブ孤立も自動回収されるため、(B)実施(=`RULING_USE_BATCH_API`変更に伴う再起動)を安全に行える。

## 対応方針(ドラフト、詳細はCodexレビューで詰める想定)

### (A) 汎用的な孤立ジョブ回収の実装

- **(Codex Review 2のP1指摘を反映、重要な訂正)**: 当初「サーバー起動時に一度だけ走査する」設計だったが、これでは再起動の直前(閾値未満の経過時間)に中断されたジョブが除外され、その後は再走査の機会が無いまま永久に`pending`/`running`のまま残ってしまう(次にサーバーが再起動されるまで気づかれない)。**起動時の1回に加えて、稼働中も定期的に(案: 5分間隔の`setInterval`)同じ走査処理を実行する**設計に変更する。これにより、走査時点で経過時間が閾値未満だったジョブも、稼働継続中にいずれ閾値を超えた時点の定期走査で確実に回収される。
- 走査条件: `status IN ('pending','running')`かつ`created_at`が一定時間(案: 30分。Batch API全廃後は通常APIの所要時間は通常数十秒〜数分のため、これより十分大きい閾値であれば処理中の正常なジョブを誤って打ち切らない。要Codex確認)より古いジョブを対象に、`status='failed'`・`error`(理由: プロセス再起動または異常終了により処理が中断されたことを示す固定メッセージ)・`finished_at=now`を設定して確定する。
- 上記の確定処理は、T010(`.ai/tasks/T010-refund-quota-on-answer-failure.md`)が設計する「ジョブ確定+返金」の共通関数(`finalizeRulingJob`相当)を再利用し、無料枠の返金も同じトランザクションで行う。
- **T010との統合に必須の修正(Codex Review 1のP1指摘#6)**: T010ドラフトの`refunded_at IS NULL`のみによる二重確定防止は不十分(最初に`ok`で確定した後、本回収処理が誤って上書き・二重返金しうる)。`UPDATE ruling_job SET status=... WHERE id=? AND status IN ('pending','running')`のように、**現在のstatusが未確定状態であることを更新条件に含め、更新件数が1件の場合のみ返金処理に進む**設計に修正する。この修正はT010本体にも反映する。
- 孤立ジョブXを含む既存の孤立ジョブは、この回収処理を実装・デプロイした時点で自動的に`status='failed'`へは確定される(手動DB修正は不要になる。下記「孤立ジョブXへの対応」参照)。**ただし返金については別途注意が必要**: T010が新設する`usage_month_key`列は、この変更をデプロイした後に作成されるジョブにしか記録されない。孤立ジョブX等、変更前から存在する既存の未完了ジョブは`usage_month_key`が`NULL`のままのため、T010の返金判定(`usage_month_key`が非NULL かつ返金対象ステータス)を素通りし**自動では返金されない**(Codex Review 4のP1指摘)。デプロイ時点で残っている未完了ジョブがあれば、回収処理の対象になったこと自体をログ等で確認した上で、そのジョブが無料枠を消費していたかを本番`device_monthly_usage`/`ruling_job`から個別に確認し、必要なら手動で返金する(自動マイグレーションは行わない。対象件数が現時点で孤立ジョブX 1件のみと少数であるため、個別確認で十分と判断)。
- **アプリ側の考慮(2026-09-04調査完了)**: `GET /api/ruling/jobs/:jobId`をポーリング中のクライアントは、`ruling_job.dart`の`isFinished`(done/failedの両方を含む)判定でポーリングを停止する設計に既になっており、`status='failed'`時は`ruling_screen.dart`・`ruling_turn_view.dart`ともエラーメッセージ(`job.error`)を赤字表示、質問入力欄・追加質問欄は常時表示されたままのため再送も可能。追加のモバイル側修正は不要と判断。
- **(Codex Review 3のP1指摘を反映、重要な追加)**: 定期走査による回収は「経過時間が閾値(30分)を超えている」ことだけを根拠に`failed`確定するが、これだけでは**プロセスが生きたまま単に処理が長引いているだけの正常なジョブ**と、**本当に孤立した(プロセス側では誰も処理していない)ジョブ**を区別できない。前者を誤って`failed`確定してしまうと、(a)裏では処理が止まらず外部API(Anthropic)のコストを消費し続け、結果を得ても捨てられる (b)T010の原子的な状態遷移(上記参照)によりデータ不整合(二重書き込み)自体は防げるが、コスト浪費と「ユーザーには失敗と伝えたのに裏で処理が続く」という無駄は残る。**対策として、外部呼び出し自体に明示的なタイムアウトを設定し、正常なジョブが物理的に30分を超えて生き続けることが無いようにする**: `src/llm/client.ts`の`completeJson`(`messages.create`呼び出し)に明示的な`timeout`オプション(案: 2〜3分。Anthropic SDKの既定タイムアウトに依存せず明示する)を設定する。`src/utils/httpClient.ts`の外部サイトへのリクエストは既に`REQUEST_TIMEOUT_MS`(10秒)で個別に上限があるため対応済み。これにより、30分経過時点で`pending`/`running`のジョブは「タイムアウトで既に失敗しているのにmarkFailedが呼ばれていない(=プロセス再起動等で処理自体が消えた)」ケースにほぼ限定でき、正常ジョブの誤ったキャンセルを実質的に排除できる。
- **(Codex Review 4のP1指摘を反映、上記タイムアウト案の限界と根本的な対策)**: 個々の外部呼び出し(LLM 2〜3分)にタイムアウトを設定しても、`produceRuling`全体(質問解析・複数回の外部サイト参照・リトライ等を合算)が30分を超えないことまでは保証しない。時間ベースの推定だけでは「正常に稼働中」と「孤立」を確実には区別できないため、**本質的な解決策として、この単一インスタンス構成(Renderの`plan: starter`)を前提に、プロセス内メモリ上で「現在このプロセスが処理中のjobId集合」を管理する**設計に変更する。`rulingJob.ts`に`runningCount`(現在は件数のみ)と並べて`Set<string>`(例: `runningJobIds`)を追加し、`runRulingJobInBackground`の開始時に該当jobIdを追加、`.finally()`で削除する。定期走査は、経過時間が閾値を超えているジョブのうち**この集合に含まれないもの**だけを孤立ジョブとして確定する。この構成なら、(a)同一プロセスが本当に処理中のジョブは集合に含まれるため何時間かかっても誤確定されない (b)プロセス再起動直後は集合が空になるため、旧プロセスの生存中ジョブ(=この新プロセスにとっては誰も処理していない)は正しく経過時間超過時点で回収される、という単一インスタンス前提に基づく確実な切り分けができる。LLM呼び出しタイムアウト(上記)は、この一次的な判定に加えて外部APIコストの上限を明示する二次的な安全策として引き続き有用なため両方とも実装する。**複数インスタンス構成に将来移行する場合はこの前提が崩れるため再設計が必要**(現時点では対象外、既存のSTATUS.md記載の他のP1未解決事項と同様に「単一インスタンス前提」の制約として扱う)。

### (B) Batch APIコードの削除

- `src/llm/client.ts`: `completeJsonViaBatch`関数、`BATCH_POLL_INTERVAL_MS`・`BATCH_CUSTOM_ID`定数、`completeJson`内の`useBatchApi`分岐を削除。常に通常の`messages.create`呼び出しのみにする。
- `src/config/env.ts`: `RULING_USE_BATCH_API`のZodフィールドを削除。
- `src/routes/rulingJobs.ts`: `useBatchApi`算出ロジックを削除し、`runRulingJobInBackground`の呼び出しから引数を外す。
- `src/ruling/rulingJob.ts`・`src/ruling/produceRuling.ts`・`src/ruling/generateRuling.ts`: `useBatchApi`オプションの受け渡しを削除。
- `.env.example`: `RULING_USE_BATCH_API`の記載を削除(Codex Review 1のP3指摘: `render.yaml`には元々この変数の記載が無く、削除対象は`.env.example`が正しい)。
- テスト: `tests/rulingJob.test.ts`の`useBatchApi`分岐テスト(「優先処理」特典実装時に追加された3件)を削除・整理。
- ドキュメント: README等にBatch API関連の記載があれば更新。

### (B)の反映手順(Codex Review 1のP1指摘#3を踏まえた訂正)

**訂正**: 当初「Renderの環境変数を`false`に変更するだけでコード変更・デプロイ無しに即座に反映される」と記載したが誤りだった。`RULING_USE_BATCH_API`は`src/config/env.ts`のモジュール初期化時に一度だけ読み込まれるため、反映には**プロセス再起動が必要**。

- (A)未実装の場合: 環境変数変更→プロセス再起動時に、その瞬間処理中だった一部ジョブが孤立するリスクがある(規模は小さいが可能性はある)。
- (A)実装後: 再起動で孤立したジョブも次回起動時の回収処理で自動的に`failed`+返金されるため、安全に環境変数変更・再起動を行える。**このため実装順序は(A)を先に完了させてから(B)の環境変数変更・コード削除に進むことを推奨する。**

### 孤立ジョブXへの対応(Codex Review 1のP2指摘#1を反映)

(A)の回収処理を実装・デプロイすれば自動的に処理されるため、個別の手動DB修正は不要になる見込み。ただし(A)の実装・デプロイまでに時間がかかる場合の暫定対応として手動修正を行うなら、`outcome_status`だけでなく**`status='failed'`・`error`・`finished_at`を一貫して更新**する(`outcome_status`のみの更新ではアプリがポーリングを継続してしまう。`finished_at`が`NULL`のままだと将来の一括削除処理からも漏れる)。無料枠の返金も同じ手順で行う。

### 有料特典(優先処理)の表示整合(Codex Review 1のP1指摘#4を反映)

全ユーザーが通常APIになると、購読者向け「優先処理(高速回答)」という有料特典が実質的に消滅する。以下の箇所で明示的に謳っているため、(B)実施と同時にコピーの見直しが必要:

- `mobile_app/lib/screens/paywall_screen.dart:310`(「無料枠を超えて質問し放題・広告非表示・優先処理(高速回答)が有効です。」)
- `mobile_app/lib/screens/settings_screen.dart:253`(同様の文言)
- プライバシーポリシー・ストア掲載文言等、他に同様の記載が無いか棚卸しする

**確定済み(2026-09-04、ユーザー判断)**: 「優先処理」という文言はコピーから削除するのみとし、代替の有料差別化要素は新設しない(他の有料特典である広告非表示・質問し放題は引き続き有効なため)。`paywall_screen.dart`・`settings_screen.dart`・`docs/mobile-app-privacy-policy.html`の3箇所から該当文言を削除済み(未コミット)。

### コスト再試算(Codex Review 1のP2指摘#2を反映)

当初案は「最もヘビーな端末(月35問換算)の通常API単価コストを月額¥300と比較する」という誤った比較をしていた(この端末が仮に購読者であれば既に通常API側であり、無料ユーザーのBatch全廃による増分評価には使えない)。

正しくは、無料ユーザー全体の**Batch→通常API切り替えによる増分コスト**で評価すべき。実データ(2026-08-19〜08-31の12日間、48台・127ジョブ、当時はほぼ全数が無料ユーザーと推定)を用いると:

- 追加コスト ≈ 127ジョブ × (通常API単価 − Batch API単価)/ジョブ
- 単価差は概算で保守的単価7円/ジョブ×50%引き=3.5円/ジョブ程度(Batch APIは入出力とも50%割引のため)
- 12日間の追加コスト ≈ 127 × 3.5円 ≈ 445円、30日換算で**月あたり概算1,000円強程度**

現在のユーザー規模(48台、無料ベータ)ではごく小さい金額だが、iOS本番リリース後にユーザー数が増えれば線形に増加する。実装時にはより正確な単価(実際のトークン数ベース)で再試算し、ユーザーへ確認する。

### 回帰テストの受入条件(Codex Review 1のP2指摘#4を反映)

- 無料・購読どちらのユーザーでも`generateRuling`が常に通常API(`messages.create`)経由になり、`anthropic.messages.batches.create`が一切呼ばれないことを確認するテスト
- (A)の起動時回収処理: 一定時間以上`pending`/`running`のジョブが`failed`+返金で確定されること、既に`done`のジョブには影響しないこと、同一ジョブに対して二重に返金されないことを検証するテスト

## 未確定・要検討事項

- (A)の「一定時間」の閾値設計(案: 30分)の妥当性
- 有料特典コピーの見直し方針(上記参照、ユーザー判断待ち)
- コスト再試算の前提(48台・127ジョブ、2026-08時点)は、iOS本番リリース後の実績で改めて監視する
- `RULING_USE_BATCH_API`環境変数をコードから削除した場合、Renderダッシュボード側に同名の環境変数が残っていても実害が無いか(Zodスキーマが未知キーをどう扱うか)を実装時に確認する
- ~~アプリ側が`status='failed'`のジョブをどう表示するか(既存のエラー表示経路で対応できるか、要調査)~~ → **2026-09-04調査完了、既存の表示で十分と判断(Acceptance Criteria参照)**

## Acceptance Criteria(現段階)

- [x] 本改訂版の方針(A・B両方、およびT010との統合設計)についてAGENTS.mdの運用に従いCodexへ再レビューを依頼する(Review 2) → **2026-09-04完了、P1 3件・P2 2件を反映済み(下記Review History参照)**
- [x] STATUS.mdをT012の内容で更新する → **2026-09-04完了**
- [x] 有料特典コピーの見直し方針をユーザーへ確認してから該当箇所を修正する → **2026-09-04完了**(「文言を削除」で確定、`paywall_screen.dart`・`settings_screen.dart`・`docs/mobile-app-privacy-policy.html`の3箇所から「優先処理(高速回答)」を削除済み。未コミット)
- [x] (A)の実装前に、モバイル側が`GET /api/ruling/jobs/:jobId`で`status='failed'`を受け取った際の挙動を確認する → **2026-09-04完了。`ruling_screen.dart`・`ruling_turn_view.dart`とも`isFinished`(done/failedの両方を含む)でポーリングを停止し、`status==failed`時は`job.error`を赤字表示、質問入力欄(`ruling_screen.dart`)・追加質問欄(`ruling_thread_detail_screen.dart`、`canSubmit`が`isFinished`で再度trueになる)は常に表示されたままのため再送も可能。返金されたことを明示するUI要素は無いが、既存の「無料枠残数」表示を次回確認すれば間接的にわかるため、今回は追加UI無しで十分と判断し、モバイル側の変更はスコープに含めない**
- [x] (A)(B)の実装に着手する → **2026-09-04完了(下記参照)**。`ruling_job`への`usage_month_key`/`refunded_at`列追加、`finalizeRulingJob`(T010)実装、`src/ruling/orphanedJobSweep.ts`新設(起動時+5分間隔の定期走査)、`src/index.ts`での起動、`src/llm/client.ts`へのLLM呼び出しタイムアウト(3分)、Batch API関連コード(`completeJsonViaBatch`・`RULING_USE_BATCH_API`・`useBatchApi`の全経路)を削除。**実行中ジョブ判定は当初`runningJobIds`集合(プロセス内メモリ)で行っていたが、デプロイ時の新旧プロセス並存に対応できない不備が判明し、`worker_id`/`heartbeat_at`によるDBベースのリース方式へ変更済み(最新の設計・実装はReview 9参照、以降このタスクファイル内で`runningJobIds`に言及している箇所は方針決定当時の議論の記録であり、現在の実装はheartbeatベースに置き換わっている)**
- [x] T011は(A)の実装完了をもってClosedにする → **2026-09-04、`.ai/tasks/T011-orphaned-batch-job-on-restart.md`をSupersededからClosedへ更新**

## Implementation Owner

Claude Code(2026-09-04、ユーザー「自己判断できる課題を進めて」指示により実装)

## Reviewer

Codex

## Review History

**Review 1(2026-09-04)**: `scripts/codex-review.ps1`で実施。P0なし。P1 6件・P2 4件・P3 1件を検出。

- P1: (1) タスクファイルに本番の実ジョブIDを記載しており公開リポジトリで漏洩する → 修正済み(本ファイルから実IDを削除) (2) Batch API全廃だけでは孤立ジョブ問題は根本解消しない(通常APIでも同じ再起動問題が起こりうる) → (A)汎用回収処理を追加して対応 (3) 環境変数変更が「デプロイ無しで即時反映」という記述は誤り(プロセス再起動が必要) → 記述訂正、実装順序を(A)→(B)に変更して対応 (4) 有料特典「優先処理」の表示がアプリ内・資料と食い違う → 該当箇所を洗い出し、ユーザー確認事項として明記 (5) T011のbatch_id再開設計は複雑すぎ、汎用的な失敗確定に置き換えるべき → (A)に統合する形で対応 (6) T010の`refunded_at IS NULL`のみの冪等性条件は不十分(二重返金しうる) → atomicなstatus遷移条件に修正する方針を明記
- P2: (1) 孤立ジョブの手動修正が`outcome_status`のみで不完全 → 修正手順を訂正 (2) コスト試算の比較対象が誤り → 無料ユーザーの増分コストで再試算 (3) STATUS.md未同期 → Acceptance Criteriaに追加 (4) 回帰テスト条件不足 → 追加
- P3: 削除対象は`render.yaml`ではなく`.env.example` → 修正済み

**Review 2(2026-09-04)**: 改訂版を再度`scripts/codex-review.ps1`でレビュー。P0なし。P1 3件・P2 2件を検出(Codexが読み取り専用コマンドで実際にSTATUS.md・T010・T011の内容を確認した上での指摘)。

- P1: (A)の「起動時に一度だけ走査」設計では、再起動直前に中断された(閾値未満の経過時間の)ジョブが除外され、その後再走査されず永久に取り残される → 起動時+定期的な再走査(5分間隔案)に変更して対応(上記(A)節を参照)
- P1: T010の`refunded_at IS NULL`のみの冪等性条件が、T012では課題として認識されつつも正本であるT010本体に未反映だった → T010ファイルへ実際に「原子的な状態遷移(`status IN ('pending','running')`条件での更新件数チェック)」の設計を反映済み(`.ai/tasks/T010-refund-quota-on-answer-failure.md`のReview 2参照)
- P1: `rulingJob.ts`の`markRunning()`がPromiseチェーン開始前に同期実行されており、ここでのDB例外は返金・確定処理の対象経路を通らない → T010ファイルへ対応方針を追記(同上)
- P2: T009の候補重複排除案が`LIMIT`適用順序により件数不足を起こしうる指摘(T012とは別件、T009実装時の参考として記録)
- P2: STATUS.mdがT012の新方針(汎用回収+Batch API全廃)を反映しておらず、T011の旧設計(batch_id永続化)が引き続き進行中と読める → 本レビュー完了後、STATUS.mdをT012の内容で更新する(Acceptance Criteria参照)

**Review 3(2026-09-04、T013実装レビューに同梱)**: T013(バナー広告)のコードレビュー依頼時、埋め込まれていた本ファイルの内容についても追加指摘を受けた。

- P1: 「作成から30分」での回収は、孤立ジョブ(プロセスが死んでいる)と正常に実行中のジョブ(プロセスは生きているが単に遅い)を区別できない。誤って後者を`failed`確定すると、裏の処理が止まらず外部APIコストを浪費した末に結果が捨てられる → `src/llm/client.ts`の`completeJson`(LLM呼び出し)に明示的なタイムアウト(案2〜3分)を設定し、正常なジョブが物理的に30分を超えて生き続けないようにする対策を追加(上記(A)節を参照)。`httpClient.ts`側は既に10秒タイムアウト設定済みのため対応不要と確認。

**Review 4(2026-09-04、T014のP1修正差分レビューに同梱)**: T014(カードインデックス管理)の実装差分レビュー依頼時、他の未コミット差分と共に埋め込まれていた本ファイルの内容についても追加指摘を受けた(P1 6件のうち2件が本ファイル関連)。

- P1: LLM呼び出し単体へのタイムアウト(Review 3で追加)だけでは、質問解析・複数回の外部取得・リトライを含む`produceRuling`全体が30分を超えないことまでは保証できず、正常に稼働中のジョブと孤立ジョブの区別を時間ベースの推定だけに頼るのは不十分 → Renderの単一インスタンス構成を前提に、プロセス内メモリで「現在このプロセスが処理中のjobId集合」(`runningJobIds`)を管理し、定期走査はこの集合に含まれないジョブのみを孤立ジョブとして確定する設計に変更(上記(A)節を参照)。LLM呼び出しタイムアウトは外部APIコスト上限を明示する二次的な安全策として維持
- P1: T010が新設する`usage_month_key`列は変更後に作成されたジョブにしか記録されないため、デプロイ前から存在する既存の未完了ジョブ(孤立ジョブX等)は回収処理で`failed`確定はされても`usage_month_key`が`NULL`のままで自動返金の対象外になる → 「孤立ジョブXへの対応」節に、デプロイ時点で残っている未完了ジョブは個別に本番データを確認し手動返金する旨を追記(自動マイグレーションは対象件数の少なさから見送り)

**Review 5(2026-09-04、T014のP1修正差分の再レビューに同梱)**: T014のP1 3件対応後の差分を再レビューした際、他の未コミット差分と共に埋め込まれていた本ファイルの内容についても追加指摘を受けた。

- P1: バックエンドで孤立ジョブを`failed`確定しても、モバイル側が`status='failed'`受信時にポーリングを止めず再送導線も出さなければ、ユーザー体験としては元の「生成が止まって見える」問題が解消しない → Acceptance Criteriaへ、(A)実装前にモバイル側の`failed`受信時の挙動(ポーリング停止・中断理由表示・再送可能・返金の案内)を確認し、不十分ならスコープに含める項目を追加(上記Acceptance Criteria参照)

**Review 6(2026-09-04、(A)(B)実装完了後の差分レビュー)**: `scripts/codex-review.ps1`で実装差分をレビュー。P0なし、P1 3件・P2 3件を検出・全件対応済み。

- P1: `src/ruling/orphanedJobSweep.ts`の定期走査(`setInterval`)にtry/catchが無く、DB例外1件でプロセス全体が落ちかねない設計だった → 走査全体・ジョブ単位の両方をtry/catchで隔離し、1件の失敗が後続ジョブの回収を止めないよう修正。テスト2件追加(`tests/orphanedJobSweep.test.ts`)
- P1: `expectedTotal`使用時の99%閾値のままだと、直近取得値が大きいほど実際の欠落許容数(例: 11,700件なら最大117件、概ね1ページ分)が大きくなり、`last_known_total_count`を確定してしまうと次回以降その欠落が再試行されない → クロール自体の失敗判定(99%閾値)とは別に、「観測値を確定してよいか」の判定に`summary.totalCount >= currentCount`(実際にDBへ反映できた総数が直近取得値以上であること)の条件を追加。テスト追加
- P1: 処理中ジョブが載ったスレッドの削除時に返金する当初の実装(前回のセッションで追加)は、バックグラウンドの`produceRuling`自体を止める手段が無いため、「質問作成→即座にスレッド削除」を繰り返すことで無料枠を消費せずに外部APIコストだけを発生させられる悪用経路になっていた → **返金処理を取り消し、スレッド削除時は元の挙動(返金しない、ジョブ行は削除)に戻した**。返金機会の喪失自体は元々のT010スコープ外(システム側都合の失敗のみが対象)と整理し直す
- P2: プッシュ通知(FCM送信・`markNotified`)の失敗が同じPromiseチェーンの`.catch()`に流れ、`finalizeRulingJob(...failed)`が意味なく再度呼ばれ`ruling_job_failed`という誤ったログが残っていた → 通知処理を独立したtry/catchで囲み、失敗時は`ruling_job_notification_failed`として別途記録するよう分離。テスト追加
- P2: STATUS.md/T010/T012が「実装は未着手」のまま差分と矛盾していた → 本ファイルおよびSTATUS.mdを実装完了の内容へ同期(下記参照)
- P2: T008の`ruling_job.result_json`残存確認が未完了のまま → 既知の検証ギャップとして`T008-correction-leak-quick-fix.md`に記録済み(本番DBへの読み取り専用クエリでの確認は別途対応、本ラウンドでは実施せず)

**検証(Review 6対応後)**: `npm run typecheck` PASS、`npm test` PASS(46ファイル/305テスト)。ローカルdevサーバー(`npm run dev`、別ポート)を実際に起動し、(1)通常の質問→`status=done, outcome_status=ok`で無料枠消費・返金無し (2)処理中スレッドの即時削除→ジョブ行削除・無料枠は消費されたまま(返金なし、Review 6のP1修正により意図通り) (3)DBへ直接1時間前作成の`running`ジョブを挿入→孤立ジョブ回収スイープを手動実行し`status=failed`+返金(`device_monthly_usage.count`が1→0)を確認、の3パターンを実データで確認した。テスト用に作成したデータは実行後にクリーンアップ済み。

**Review 7(2026-09-04、Review 6対応差分の再レビュー)**: P0なし、P1 5件・P2 2件を検出。うち3件を対応、2件は既存のユーザー判断・既知の対応見送り事項として現状維持。

- P1: `src/ruling/rulingJob.ts`の`.catch()`内`finalizeRulingJob()`・`.finally()`内`pruneOldJobs()`自体が例外を投げた場合、後続のcatchが無く未処理のPromise rejectionになり得る(孤立ジョブ回収側は既に例外を隔離済みで設計が不統一だった) → 両方をtry/catchで囲み、専用ログ(`ruling_job_finalize_failed`・`ruling_job_prune_failed`)に分離。テスト2件追加(`tests/rulingJob.test.ts`)
- P1: 管理画面の「全件再構築」が`expectedTotal`を渡していなかった → `src/routes/cards.ts`で実行前に`fetchTotalCardCount()`を取得し渡すよう修正(詳細はT014のReview 4参照)
- P1: 初回のRevenueCat問い合わせ失敗で無償ユーザー扱いへフォールバックする挙動(T013で実装)について、既存購読者にも起動直後の一時障害で広告が表示されうるとの再指摘 → **これは実装中にユーザーへ明示的に確認済みのトレードオフ**(T013 Review 3参照。「確定するまで一切広告を出さない」代替案とその副作用〈RevenueCat不調時に無償ユーザーへの広告表示も止まる、バックオフ再試行の追加実装が必要〉を提示した上で、ユーザーが「現状維持」を選択、2026-09-04)。仕様として維持し、コード変更は行わない
- P1: `src/config/db.ts`の`usage_month_key`/`refunded_at`列追加の`try/catch`が、重複カラム以外のDB障害(ロック・破損等)も無条件に握りつぶす → **既存コードベース全体(thread_id列・faces列・judge_id列・general_rule_chunk関連列等)で同一パターンが7箇所以上採用されている既存の設計方針であり、今回追加した2列だけを別方式にすると一貫性が崩れる。ファイル全体のマイグレーション方式の見直しは本タスクのスコープを超えるため、今回は対応しない**(現状維持のリスクは他の既存カラムと同等)
- P1: T008(`ruling_job.result_json`の旧judgeId残存確認)が引き続き未完了 → **本番DBへの読み取り専用クエリでの確認が必要な項目のため、今回のセッションでは対応しない。ユーザーへ別途確認を依頼する**(下記参照)
- P2: `.ai/tasks/T015-rules-qa-autorefresh-investigation.md`の記述が新設した`orphanedJobSweep.ts`の`setInterval`と矛盾する表現になっていた → 記述を訂正(対象は総合ルール/Q&A/ルール変更の最新化に限定する旨を明記)、`reindex/check`起点の自動再構築が実際には差分更新であることも訂正
- P2: `SubscriptionProvider`の状態遷移(初回失敗・確定後維持)、LLM呼び出しタイムアウト、全件再構築の部分失敗表示等の直接的な回帰テストが不足 → LLM呼び出しタイムアウトのテストを追加(`tests/llmClient.test.ts`)。`SubscriptionProvider`はRevenueCat SDKのモック基盤がこのプロジェクトに前例が無く、追加コストが大きいため今回は見送り、既知のギャップとして残す(T013参照)

**検証(Review 7対応後)**: `npm run typecheck` PASS、`npm test` PASS(47ファイル/309テスト、`tests/llmClient.test.ts`新設)。

**Review 8(2026-09-04、T017実装レビューに同梱)**: T017(検証済み裁定原則の修正)の差分レビュー時、他の未コミット差分と共に埋め込まれていた本ファイルの内容についても追加指摘を受けた。

- P1: **プロセス内メモリの`runningJobIds`(Set)では、デプロイ時の新旧プロセス並存を防げない**。新プロセスは起動直後に孤立ジョブ回収を実行するが、旧プロセスがまだ処理中のジョブIDは新プロセスの`runningJobIds`には存在しないため、単一インスタンス構成でもローリングデプロイ等で新旧プロセスが一時的に並存すると、新プロセスが正常に処理中のジョブを誤って孤立扱いし`failed`+返金確定してしまい、旧プロセスが後で生成する正常な結果を無駄にする可能性がある。修正案: DB上に`worker_id`・`heartbeat_at`等のリース情報を持たせ、期限切れリースのみを条件付きUPDATEで回収する設計に変更する必要がある。現状の`runningJobIds`によるプロセス内判定は、単一プロセスが再起動を挟まず稼働し続ける前提でのみ正しく機能する(Renderのデプロイ時は必ず新旧プロセスが一時的に並存するため、この前提は成り立たない)。→ **2026-09-04実装完了(下記Review 9参照)**
- P2: `finalizeRulingJob`の`outcomeStatus`が`string`型のため、将来`ProduceRulingOutcome`に新しい正常系ステータス(例: `partial_success`)が追加された場合、`isRefundableOutcome`の判定(`!(outcome==="done" && outcomeStatus==="ok")`)により自動的に返金対象になってしまう → `ProduceRulingOutcome["status"]`相当のunion型へ絞り込むと安全。**対応は次回以降に持ち越し**(実装未着手のため今すぐの実害は無いが、T010実装時に反映する)。

**実装完了(2026-09-04)・Review 9(実装差分レビュー)**: 上記Review 8のP1(プロセス内メモリの限界)を、`ruling_job`テーブルへ`worker_id`(TEXT)・`heartbeat_at`(INTEGER)列を追加するDBベースのリース方式で解消した。

- `src/config/db.ts`: `worker_id`・`heartbeat_at`列を追加(既存カラム追加と同じALTER TABLE+try/catchパターン)。
- `src/ruling/rulingJobRepository.ts`: `markRunning(id, workerId)`が`worker_id`・`heartbeat_at`も同時に打刻するよう拡張。`renewHeartbeat(id, workerId)`を新設(`worker_id`一致かつ`status='running'`の行のみ更新)。
- `src/ruling/rulingJob.ts`: プロセスごとに`WORKER_ID`(`randomUUID()`)を生成し`markRunning`へ渡す。`startHeartbeatRenewal`/`stopHeartbeatRenewal`(1分間隔)を新設し、`runningJobIds`(このプロセスが処理中のjobId集合、heartbeat対象の絞り込み専用に用途を縮小)へ含まれるジョブのheartbeatを定期更新する。プロセスをまたいだ孤立判定には使わなくなったため、`isJobRunningInThisProcess`は削除(未使用化)。
- `src/index.ts`: `startHeartbeatRenewal()`を`startOrphanedJobSweep()`と並べて起動時に呼ぶ。
- `src/ruling/orphanedJobSweep.ts`: running判定を`isJobRunningInThisProcess`ではなく`heartbeat_at`の鮮度(5分)で行うよう変更。

実装後の差分レビューでさらにP1 2件を検出、両方とも実装済み:

- P1: **初回デプロイ直後、旧プロセス由来のrunning行(`heartbeat_at`がNULL)を経過時間を考慮せず即座に孤立扱いしてしまう** → running判定を「`heartbeat_at`がある場合は5分の鮮度」「`heartbeat_at`がNULL(旧デプロイ由来)の場合はpendingと同じ30分の`created_at`猶予」の2条件に分離(`orphanedJobSweep.ts`の`findStaleJobs`)。回帰テスト追加(`tests/orphanedJobSweep.test.ts`)、実データ(実SQLite)での検証スクリプトでも確認済み。
- P1: **heartbeat確認(SELECT)と失敗確定(UPDATE)が原子的でなく、SELECT後にheartbeatが更新されたジョブを誤って確定しうるTOCTOU競合** → `findStaleJobs`のSELECTは候補抽出のみに用途を限定し、実際の確定は新設の`finalizeOrphanedRulingJob()`が発行するUPDATE文自体に同じ鮮度条件(`heartbeat_at < ?`等)を埋め込んで再検証するよう変更。SELECT後に別プロセスがheartbeatを更新していた場合はUPDATEの更新件数が0件になり`won: false`を返す(確定・返金しない)。`rulingJobRepository.ts`に`commitFinalize`(共通のBEGIN/UPDATE/返金/COMMIT処理)を抽出し、`finalizeRulingJob`(通常完了用)と`finalizeOrphanedRulingJob`(孤立回収用、鮮度条件をUPDATEに埋め込む)の両方から使う設計にした。回帰テスト追加(`tests/rulingJobRepository.test.ts`)。

その他、同レビューで検出されたP2 2件(D-006検証済み裁定原則の過剰発火・空`requiredCardNameGroups`の扱い)は`src/rules/`配下の別件(T017関連)、1件(購読切替時のバナー広告未破棄)は`mobile_app/lib/widgets/loading_banner_ad.dart`(T013関連)で、いずれも本タスク(T012)のスコープ外のため対応は別途判断する。

**検証(Review 9対応後)**: `npm run typecheck` PASS、`npm test` PASS(47ファイル/326テスト)。加えて実際のSQLite(node:sqlite、本番と同じエンジン)に対する検証スクリプトで、(1)markRunning/renewHeartbeatによるworker_id・heartbeat_atの打刻 (2)heartbeatが新鮮なrunningジョブは回収されない (3)heartbeatが5分超古いrunningジョブは回収される (4)heartbeat_atがNULL(旧デプロイ由来)でも作成直後なら回収されない(初回デプロイ時の誤爆防止) (5)heartbeat_atがNULLで作成から30分超なら回収される (6)確定直前にheartbeatが更新された場合は誤って回収されない(TOCTOU対策)、の6パターンを確認した(検証用スクリプトは実行後に削除済み)。
