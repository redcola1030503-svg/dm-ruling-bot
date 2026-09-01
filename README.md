# dm-ruling-bot

デュエル・マスターズの対戦中に発生したルール裁定について、モバイルアプリから自然文で質問すると、公式サイト(dm.takaratomy.co.jp)の情報を一次根拠として裁定候補を回答するAPI + モバイルアプリ(Android/iOS)です。

このBotはAIの記憶だけで裁定を回答しません。必ず公式カード情報・公式Q&A・公式ルール変更を取得し、それらを根拠として回答します(RAG方式)。

> **注記**: 元々はLINE Botとして開発しましたが、2026-09-02にモバイルアプリへ一本化しLINE Bot版を廃止しました(詳細は`DECISIONS.md`のD-002参照)。

> **AI開発者向け**: このリポジトリはClaude CodeとCodexの協働開発環境を採用しています。作業前に`AGENTS.md`・`STATUS.md`・`DECISIONS.md`を読んでください。セットアップ・使い方は`.ai/README.md`参照。

## 現在の状況

実装はPhase単位で進行中です。

- [x] Phase 1: 最小API(`GET /health`, `POST /api/ruling` ダミー応答)
- [x] Phase 2: 公式カード検索(`POST /api/debug/search`)
- [x] Phase 3: 公式Q&A検索(`POST /api/debug/search`)
- [x] Phase 4: ルール変更検索(`POST /api/debug/search`)
- [x] Phase 5: LLM裁定(Claude API) — 実機確認済み
- [x] Phase 6: LINE Bot — 実機確認済み(ngrok経由でWebhook動作確認 → 本番Webhookで運用 → **2026-09-02廃止、モバイルアプリへ一本化**)
- [x] 総合ルールPDF検索 — 実機確認済み。裁定の優先順位を「総合ルールへの当てはめ最優先→類似Q&A事例→ルール変更→カードテキスト」に変更
- [x] Phase 7: 品質改善(一部) — レート制限・ログ整備・カード読み仮名検索を実装。Q&A rerank(LLM)は既存のスコアリングで十分な精度が出ているため見送り
- [x] カード専用Q&A一覧の活用 — 実際の誤答事例から発見。カード詳細ページに埋め込まれた「このカードのよくある質問」への直接リンクを活用し、キーワード検索で漏れていたQ&Aを拾えるように改善(実機確認済み)
- [x] confidence信頼性の改善 — 「表面的にキーワードは一致するが論点が異なるQ&A」を誤って強い根拠にしてしまう問題を実際の誤答事例から発見。LLM自身にconfidenceを自己評価させ、機械的スコアとの慎重な方を採用するよう変更。medium/lowの場合は「推論を含む」「ジャッジに確認を」という注記を自動付与するよう改善(実機確認済み)
- [x] JSON出力順序の変更 — conclusionとexplanationが矛盾する出力(結論見出しと理由説明で逆のことを言う)を実際の誤答事例で発見。JSON出力順を steps→explanation→conclusion に変更し、推論してから結論を書く構造にして矛盾を防止
- [x] ジャッジ訂正の蓄積・参照機能 — モバイルアプリの`POST /api/corrections`により、ログイン中の公認ジャッジが直前のBot回答への訂正を記録できる。蓄積された訂正は本プロジェクト上の「公式参考情報」として以降の類似質問でLLMに提示され、論点が明確に一致する場合は直接の裁定根拠として扱う。タカラトミー公開物である「公式一次情報」とは区別する(詳細は`DECISIONS.md`のD-004参照)
- [x] 公認ジャッジのログイン機能 — `POST /api/login`で`VALID_JUDGE_IDS`に登録済みのジャッジIDのみログインでき、セッショントークンを持つユーザーのみ訂正記録APIを実行できる。ログイン状態はDBにセッションとして保存し、`POST /api/logout`で解除できる
- [x] **本番リリース** — Render(Starterプラン)にデプロイ済み

## 本番稼働状況

- 本番URL: `https://dm-ruling-bot.onrender.com`
- ホスティング: [Render](https://render.com)(`render.yaml` によるBlueprint定義をリポジトリに同梱)
- masterブランチへのPushで自動デプロイ(Auto-Deploy: On Commit)
- 永続ディスク(`/app/data`、1GB)をマウントし、SQLiteのキャッシュ・会話履歴・ジャッジ訂正データを永続化

## 必要環境

- Node.js 22.5以上(組み込みの `node:sqlite` を使用するため)

## ローカル起動

```bash
npm install
cp .env.example .env
npm run dev
```

`.env` に以下を設定してください。

```env
LLM_API_KEY=
```

- `LLM_API_KEY`: Anthropic Console(console.anthropic.com)で発行したAPIキー。裁定生成に必要
- `VALID_JUDGE_IDS`: ログインできる、有効な公認ジャッジIDのカンマ区切りリスト(例: `J001,J002`)。ここに登録されたジャッジIDでログインしたユーザーのみ訂正記録APIを実行できます

**ジャッジ/管理者の管理について**: `VALID_JUDGE_IDS`(ジャッジ)・`ADMIN_JUDGE_IDS`(管理者)環境変数は、起動のたびにDB(`judge`テーブル)へ差分シードされます(まだDBに存在しないIDのみ追加、既存の行は上書きしません)。以後の追加・削除は基本的にモバイルアプリの管理者機能(`/api/judges`)で行います。既存のジャッジIDを管理者に昇格させたい場合は、DBを直接操作するか、`ADMIN_JUDGE_IDS`にIDを追加してから該当行をDBから削除して再起動する必要があります(現時点でロール変更コマンドは未実装)。

## API

### GET /health

```json
{ "status": "ok" }
```

### モバイルアプリ向けAPI(裁定質問・ジャッジ認証・訂正・カード名サジェスト)

モバイルアプリ(Android/iOS)向けのJSON APIです。裁定質問(`/api/ruling/jobs`)はログイン不要ですが、ジャッジ限定機能(訂正記録・ジャッジ管理)はログインが必要です。

#### POST /api/login

ジャッジID(公認ジャッジ・管理者)でログインし、以降のAPI呼び出しに使うセッショントークンを取得します。パスワードは無くジャッジIDのみで認証するため、総当たり対策として1分あたり5回までのレート制限がかかっています。

request:

```json
{ "judgeId": "J001" }
```

response:

```json
{ "token": "63928eeb...", "judgeId": "J001", "role": "judge" }
```

以降の認証が必要なエンドポイントには `Authorization: Bearer <token>` ヘッダーを付与してください。

#### POST /api/logout

`Authorization: Bearer <token>` が必要。呼び出し元のセッションを破棄します。response: `{ "status": "ok" }`

#### GET /api/session

`Authorization: Bearer <token>` が必要。アプリ起動時に、保存済みトークンがまだ有効か(ログアウト済み・ジャッジ削除済みでないか)を確認する用途を想定しています。response: `{ "judgeId": "J001", "role": "judge" }`

#### POST /api/corrections

`Authorization: Bearer <token>` が必要(ジャッジ・管理者どちらも可)。訂正対象をスレッド履歴から自動特定する仕組みは無いため、画面に表示済みの質問・Botの結論をクライアント側から明示的に送ります。

request:

```json
{
  "originalQuestion": "《ボルメテウス・ホワイト・ドラゴン》でシールドをブレイクした場合、S・トリガーは使えますか？",
  "botConclusion": "使えません。",
  "correctRuling": "1体目は出せますが2体目は出せません"
}
```

response: `{ "status": "ok" }`

#### GET/POST /api/judges, DELETE /api/judges/:judgeId

`Authorization: Bearer <token>`(管理者のみ)が必要。ジャッジの一覧取得・追加・削除を行うAPIです。`POST`で追加できるロールは`"judge"`固定(管理者への昇格は不可)、`DELETE`で自分自身を削除しようとすると`409`が返ります。

```json
// GET /api/judges response
{ "judges": [{ "id": "J001", "role": "judge", "createdAt": 1234567890, "createdBy": "A001" }] }

// POST /api/judges request
{ "judgeId": "J002" }

// DELETE /api/judges/J002 response
{ "removed": true }
```

#### GET /api/cards/suggest?q=&lt;text&gt;

認証不要。質問入力中のカード名オートコンプリート用に、事前クロール済みのカード名インデックス(`card_index`テーブル)から前方一致優先で候補を返します。`q`が2文字未満の場合は空配列を返します。初回利用前に`npm run cards:index`の実行が必要です(詳細は次のセクション)。

response:

```json
{ "suggestions": [{ "id": "dm26ex3-005", "name": "ボルシャック・ドラゴン" }] }
```

#### POST /api/cards/reindex

`Authorization: Bearer <token>`(管理者のみ)が必要。`card_index`の再構築(≒`npm run cards:index`相当)をバックグラウンドで開始します。呼び出し自体は完了を待たず即座に返ります(全件クロールは最大約1.6時間かかるため)。既に実行中の場合は新たに開始せず`409`を返します。

response(開始時): `202 { "status": "started" }` / (実行中): `409 { "error": "already_running", "current": {...} }`

#### GET /api/cards/reindex/status

`Authorization: Bearer <token>`(管理者のみ)が必要。`POST /api/cards/reindex`(または後述の自動トリガー)の進捗をポーリングします。

```json
// 実行中
{ "status": "running", "startedAt": 1234567890, "processed": 6600, "total": 11654, "updated": 6319, "skipped": 280, "failed": 1 }
// 完了
{ "status": "completed", "startedAt": ..., "finishedAt": ..., "updated": 6319, "skipped": 5354, "failed": 1, "totalCount": 11654 }
// 未実行
{ "status": "idle" }
```

#### POST /api/cards/reindex/check

`Authorization: Bearer <token>`(管理者のみ)が必要。公式サイトへ1リクエストだけ送って全カード数(`total_count`)を取得し、前回チェック時の件数と比較する軽量チェックです。全件クロール(最大1.6時間)をせずに「新カードが追加された可能性があるか」だけを確認したい場合に使います。件数比較のみのため、既存カードのテキスト修正(エラッタ)までは検知できない点に注意してください。差分があれば`POST /api/cards/reindex`と同様に自動でバックグラウンドの再構築を開始します(既に実行中なら開始しません)。

response:

```json
{ "hasUpdate": true, "previousCount": 11654, "currentCount": 11700, "checkedAt": 1234567890, "reindexStarted": true }
```

### POST /api/debug/search (開発用、`ENABLE_DEBUG_ROUTES=true` の時のみ有効)

質問文中の《》『』「」で囲まれたカード名候補を抽出し、公式カード検索・詳細取得を行った結果を返す。

request:

```json
{ "question": "《ボルメテウス・ホワイト・ドラゴン》でシールドをブレイクした場合、S・トリガーは使えますか？" }
```

response:

```json
{ "cards": [{ "queried": "ボルメテウス・ホワイト・ドラゴン", "matches": [{ "card": { "...": "..." }, "matchType": "exact", "score": 1 }] }], "qa": [], "ruleChanges": [] }
```

本番環境では `ENABLE_DEBUG_ROUTES` を未設定(false)にして無効化してください。

## 総合ルール検索(キーワード検索 + Embedding意味検索のハイブリッド)

総合ルール(961条文チャンク)の検索は、以下の2種類を統合したハイブリッド検索で行っています。

- **キーワード検索**(常時有効): 質問文から抽出したカード名・ルール用語と条文テキストの部分文字列一致・2-gram類似度によるスコアリング(`src/rules/generalRuleRanking.ts`)。加えて、複数の保留/誘発型能力の処理順序を扱う一般原則条文(101.4系・409系・603.2〜603.3系)は、具体的なキーワードを含む条文に埋もれやすいため、スコア>0であれば別枠で必ず候補に含めています。
- **Embedding意味検索**(Voyage AI、任意): 質問文全体をembeddingし、事前に生成した各条文のembeddingとのコサイン類似度で検索します。「相手と自分の能力が同時に発動…」のような自然な言い回しと、「ターン・プレイヤーのものから順番に処理…」のような条文の硬い表現のように、字面は一致しないが意味的に近いケースを拾うためのものです。

2つの検索結果は、生スコアのスケールの違いに影響されないよう **Reciprocal Rank Fusion(RRF)** で統合しています(`src/search/hybridSearch.ts`)。`SEARCH_EMBEDDING_WEIGHT` / `SEARCH_KEYWORD_WEIGHT` で重みを調整できます。

### Voyage APIキーの設定

`.env` に以下を設定してください。

```env
VOYAGE_API_KEY=your-voyage-api-key
VOYAGE_EMBEDDING_MODEL=voyage-4
```

**`VOYAGE_API_KEY` が未設定の場合、embedding検索は自動的に無効化され、キーワード検索のみで動作します。** Voyage APIがタイムアウト・レート制限・障害等で失敗した場合も同様にキーワード検索へフォールバックし、応答自体は止まりません。

### embeddingの生成・更新

```bash
npm run embeddings:rules
```

未生成の条文・モデル変更・本文変更(SHA-256ハッシュで判定)があった条文のみを対象にVoyage APIへバッチでリクエストし、結果をSQLiteに保存します。総合ルールが7日ごとに再クロールされても、内容が変わっていない条文はembeddingを保持したまま残るため、毎回全件を再生成する必要はありません。

### 検索精度の評価

```bash
npm run eval:retrieval
```

`tests/retrieval/cases.json` に定義した質問と正解条文番号のペアをもとに、キーワード検索のみ/embedding検索のみ/ハイブリッドの3方式でRecall@1・3・5・10とMRR(Mean Reciprocal Rank)を算出し、比較表として出力します。embedding導入の効果を定量的に確認するために使います。

## カード名のあいまい確認

質問文から抽出したカード名が公式カード検索で一意に確定できない場合(例:「ベートーベン」→「ベートーベン・キューブ」「「修羅」の頂 VAN・ベートーベン」等が並立)、誤ったカードを前提に裁定を生成してしまうリスクを避けるため、LLMには回さずユーザーへ候補を提示して確認します。

カード名は、モバイルアプリの事前構築インデックス(`GET /api/cards/suggest`)からの選択や正式名称の入力を前提としており、公式サイト検索の結果をそのまま用いるシンプルな仕様です(表記ゆれのfallback探索やWeb検索による自動確定は行いません)。

## カード名サジェスト(モバイルアプリの入力補助用)

`GET /api/cards/suggest`は、公式サイトの全カードを事前にクロールしてローカルDB(`card_index`テーブル)に構築したカード名インデックスから候補を返します。公式サイトのカード一覧ページには画像サムネイルのみでカード名テキストが含まれないため、カード名を得るには各カードの詳細ページを個別に取得する必要があり、質問の都度公式サイトへライブ検索する方式は採用していません。

### インデックスの構築・更新

```bash
npm run cards:index
```

公式サイトを空キーワードで全件検索してカードID一覧を収集した後、各カードの詳細ページを取得して`card_index`に保存します。**全カード数は約11,654件(2026-08時点)あり、公式サイトへの負荷軽減のための500ms間隔レート制限により、初回実行には約1.6時間かかります。** 2回目以降は、前回の取得から30日以内のカードをスキップする差分更新のため高速に終わります。本番の初回構築時はRenderのShellから`node dist/scripts/buildCardIndex.js`を実行してください(`npm run embeddings:rules`と同じ運用)。

初回構築後は、管理者アカウントで`POST /api/cards/reindex`(即座に再構築、`GET /api/cards/reindex/status`で進捗確認)、または`POST /api/cards/reindex/check`(公式サイトへ1リクエストだけ送って新カードの有無を軽量確認し、あれば自動で再構築)をアプリ/APIから呼び出す方が、Shellにログインする手間がなく簡単です。いずれも同じ`card_index`テーブルへの差分更新ロジック(`src/cards/cardIndexCrawler.ts`)を共有しています。

インデックスが未構築(`card_index`が空)の間、`GET /api/cards/suggest`は常に空配列を返します(エラーにはなりません)。

## テスト

```bash
npm test
```

## デプロイ

`Dockerfile`(Node.js 22 alpineベース、マルチステージビルド、非rootユーザー実行、`/health`へのHEALTHCHECK付き)を用意しています。**本番は`render.yaml`(Blueprint定義)を使ってRenderにデプロイ済み**です。Railway / Google Cloud Runなど、他のDockerイメージ常駐デプロイ対応サービスでも同様の構成で動作するはずです。

### Renderへのデプロイ(実施済みの手順)

1. Renderダッシュボードで GitHubリポジトリ(`redcola1030503-svg/dm-ruling-bot`)と連携し、Web Serviceを作成(Docker、Starterプラン以上 — 永続ディスクはFreeプラン非対応)
2. `render.yaml`に定義済みの環境変数のうち、機密情報(`LLM_API_KEY`/`VALID_JUDGE_IDS`)をRenderダッシュボード上で入力
3. Disk設定で`/app/data`に1GBをマウント、Health Check Pathに`/health`を設定
4. Auto-Deployは「On Commit」設定のため、以後は`master`へのPushで自動的に再デプロイされる

### ローカルでのDockerビルド確認

```bash
docker build -t dm-ruling-bot .
docker run -p 3000:3000 --env-file .env -v ./data:/app/data dm-ruling-bot
```

### 重要: SQLiteデータの永続化

このBotはキャッシュ・会話履歴・訂正データを `data/cache.db`(SQLite)に保存します。コンテナは通常エフェメラル(再デプロイ時に消える)なため、**`data/` ディレクトリをデプロイ先の永続ボリューム機能でマウントしてください**。マウントしないと再デプロイのたびに以下が失われます。

- カード/Q&A/ルール変更/総合ルールのキャッシュ(実害は小さい、次回アクセス時に自動で再取得される)
- 会話履歴(直近の文脈が失われる程度で実害は小さい)
- **蓄積したジャッジ訂正データ(`correction`テーブル)とログインセッション(`judge_session`テーブル)** — こちらは再作成できないため、永続化しないと実質的に運用が成り立ちません

Render/Railwayでは「Persistent Disk」「Volume」機能を`/app/data`にマウントしてください。Cloud Runはデフォルトでは永続ディスクを提供しないため、Cloud SQLなど外部DBへの切り替えを検討する必要があります(現状のコードは`node:sqlite`前提のため、外部DBに切り替える場合はリポジトリ層の書き換えが必要です)。

### 本番環境変数チェックリスト

| 変数 | 本番での注意点 |
|---|---|
| `LLM_API_KEY` | Anthropicアカウントのクレジット残高を確認 |
| `VALID_JUDGE_IDS` | 実際に運用する公認ジャッジIDのみを列挙 |
| `VOYAGE_API_KEY` | 任意。未設定でもキーワード検索のみで動作する。設定する場合はデプロイ後に`npm run embeddings:rules`でembeddingを生成すること |
| `ENABLE_DEBUG_ROUTES` | **必ず未設定または`false`にする**(`/api/debug/*`は本番で無効化)。なお`NODE_ENV=production`(Dockerfileで設定済み)の場合はこの値が`true`でもコード側で強制的に無効化される(多層防御) |
| `DATABASE_URL` | 永続ボリューム上のパスを指定(例: `/app/data/cache.db`) |
| `RULING_USE_BATCH_API` | 任意、既定`false`。`true`にするとモバイルアプリの非同期裁定ジョブ(Push通知経路)のうち非購読ユーザーのみAnthropic Message Batches API(入出力とも50%割引)を使う。バッチは通常1時間以内に完了するが保証はなく最大24時間かかりうるため、レイテンシ悪化が問題になれば`false`に戻すだけで即座に通常APIへ復帰できる |
| `PORT` | Renderはコンテナに`PORT`環境変数を自動注入し、そのポートで待ち受ける(明示的な設定は不要。本番では10000番ポートが割り当てられている) |
| `REVENUECAT_WEBHOOK_SECRET` | RevenueCatダッシュボード(Project > Integrations > Webhooks)の「Authorization header value」と同じ値を設定。未設定のままだと`/api/billing/revenuecat-webhook`は全リクエストを401で拒否し続ける(起動時に警告ログが出る) |
| `REVENUECAT_API_KEY` | RevenueCatのSecret API Key(REST API呼び出し用)。未設定だと`/api/billing/sync`が常に失敗する(起動時に警告ログが出る) |
| `REVENUECAT_ENTITLEMENT_ID` | 任意、既定`unlimited_questions`。RevenueCatダッシュボードで設定した月額サブスクリプションのエンタイトルメントIDと一致させること |
| `RULING_FREE_MONTHLY_LIMIT` | 任意、既定`10`。無料で利用できる月間の質問数。超過後はアクティブなサブスクリプションが必須になる |

### デプロイ後の確認

1. `GET /health` が `{"status":"ok"}` を返すこと
2. `POST /api/debug/search` 等のデバッグ系エンドポイントが404または無効化されていること(`ENABLE_DEBUG_ROUTES`未設定を確認)
3. モバイルアプリから実際に質問を送り、裁定の返信が届くこと

## セキュリティ・品質対策

- `POST /api/ruling/jobs`・`GET /api/cards/suggest`: 1分あたり10リクエストまでにレート制限(`express-rate-limit`)
- リバースプロキシ(ngrok/Render/Railway等)配下での実行を想定し `trust proxy` を設定済み
- 公式サイトへのスクレイピングは同一ホストへ最低500ms間隔、タイムアウト10秒、リトライ2回(`src/utils/httpClient.ts`)
- ログには質問文・検出カード名・検索キーワード・取得したQ&A/ルール変更/総合ルールのURL・confidence・処理時間・エラーを記録。個人情報はログに出力しない
