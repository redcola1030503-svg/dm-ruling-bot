# dm-ruling-bot

デュエル・マスターズの対戦中に発生したルール裁定について、LINEから自然文で質問すると、公式サイト(dm.takaratomy.co.jp)の情報を一次根拠として裁定候補を回答するAPI + LINE Botです。

このBotはAIの記憶だけで裁定を回答しません。必ず公式カード情報・公式Q&A・公式ルール変更を取得し、それらを根拠として回答します(RAG方式)。

## 現在の状況

実装はPhase単位で進行中です。

- [x] Phase 1: 最小API(`GET /health`, `POST /api/ruling` ダミー応答)
- [x] Phase 2: 公式カード検索(`POST /api/debug/search`)
- [x] Phase 3: 公式Q&A検索(`POST /api/debug/search`)
- [x] Phase 4: ルール変更検索(`POST /api/debug/search`)
- [x] Phase 5: LLM裁定(Claude API) — 実機確認済み
- [x] Phase 6: LINE Bot — 実機確認済み(ngrok経由でWebhook動作確認 → 現在は本番Webhookで運用中)
- [x] 総合ルールPDF検索 — 実機確認済み。裁定の優先順位を「総合ルールへの当てはめ最優先→類似Q&A事例→ルール変更→カードテキスト」に変更
- [x] Phase 7: 品質改善(一部) — レート制限・ログ整備・カード読み仮名検索を実装。Q&A rerank(LLM)は既存のスコアリングで十分な精度が出ているため見送り
- [x] カード専用Q&A一覧の活用 — 実際の誤答事例から発見。カード詳細ページに埋め込まれた「このカードのよくある質問」への直接リンクを活用し、キーワード検索で漏れていたQ&Aを拾えるように改善(実機確認済み)
- [x] confidence信頼性の改善 — 「表面的にキーワードは一致するが論点が異なるQ&A」を誤って強い根拠にしてしまう問題を実際の誤答事例から発見。LLM自身にconfidenceを自己評価させ、機械的スコアとの慎重な方を採用するよう変更。medium/lowの場合は「推論を含む」「ジャッジに確認を」という注記を自動付与するよう改善(実機確認済み)
- [x] JSON出力順序の変更 — conclusionとexplanationが矛盾する出力(結論見出しと理由説明で逆のことを言う)を実際の誤答事例で発見。JSON出力順を steps→explanation→conclusion に変更し、推論してから結論を書く構造にして矛盾を防止
- [x] ジャッジ訂正の蓄積・参照機能 — LINEで`/訂正 <正しい裁定>`コマンドにより、ログイン中のジャッジが直前のBot回答への訂正を記録できる。蓄積された訂正は「非公式な過去の誤答実績」として、以降の類似質問でLLMに参考提示され、同じ誤りの再発を防ぐ(公式情報の根拠としては使わない設計)
- [x] 公認ジャッジのログイン機能 — `/login <ジャッジID>`で`VALID_JUDGE_IDS`に登録済みのジャッジIDのみログインでき、ログイン中のLINEユーザーのみ`/訂正`コマンドを実行できる。ログイン状態はDBにセッションとして保存し、`/logout`で解除できる
- [x] **本番リリース** — Render(Starterプラン)にデプロイ済み。LINE Webhookを本番URLに切り替え、実機での質問応答を確認済み

## 本番稼働状況

- 本番URL: `https://dm-ruling-bot.onrender.com`
- ホスティング: [Render](https://render.com)(`render.yaml` によるBlueprint定義をリポジトリに同梱)
- masterブランチへのPushで自動デプロイ(Auto-Deploy: On Commit)
- 永続ディスク(`/app/data`、1GB)をマウントし、SQLiteのキャッシュ・会話履歴・ジャッジ訂正データを永続化
- LINE Webhook URLは `https://dm-ruling-bot.onrender.com/webhook/line` を設定・検証済み

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
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
LLM_API_KEY=
```

- `LLM_API_KEY`: Anthropic Console(console.anthropic.com)で発行したAPIキー。Phase 5(`POST /api/ruling`)に必要
- `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN`: LINE Developersコンソールで作成したMessaging APIチャネルの値。Phase 6(`POST /webhook/line`)に必要
- `VALID_JUDGE_IDS`: `/login`コマンドでログインできる、有効な公認ジャッジIDのカンマ区切りリスト(例: `J001,J002`)。ここに登録されたジャッジIDでログインしたユーザーのみ`/訂正`コマンドを実行できます

### LINE Bot設定手順(概要)

1. [LINE Developers Console](https://developers.line.biz/console/)でプロバイダー・チャネル(Messaging API)を作成
2. チャネルシークレットとチャネルアクセストークン(長期)を発行し、`.env` に設定
3. サーバーを公開URLで起動(ローカル開発時は ngrok 等でトンネルする)
4. LINE Developers ConsoleのWebhook URLに `https://<公開URL>/webhook/line` を設定し、Webhookを有効化
5. 応答メッセージ機能はOFFにする(Bot からの返信のみを使うため)

### LINE Botのコマンド

- 通常のメッセージ: ルール質問として裁定を返す
- `/whoami`: 自分のLINEユーザーIDを返す(デバッグ用)
- `/login <ジャッジID>`: 公認ジャッジとしてログインする。`VALID_JUDGE_IDS`に登録されたジャッジIDのみ成功する
- `/logout`: ログアウトする
- `/訂正 <正しい裁定>`: ログイン中のジャッジのみ実行可能。直前のBot回答に対する訂正を、ログイン中のジャッジIDと紐付けて記録する。例:「`/訂正 1体目は出せますが2体目は出せません`」

## API

### GET /health

```json
{ "status": "ok" }
```

### POST /api/ruling

request:

```json
{ "question": "ボルメテウス・ホワイト・ドラゴンでシールドをブレイクした場合、S・トリガーは使えますか？" }
```

response:

```json
{
  "conclusion": "...",
  "explanation": "...",
  "steps": [],
  "confidence": "low",
  "cards": [],
  "sources": []
}
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

**`VOYAGE_API_KEY` が未設定の場合、embedding検索は自動的に無効化され、キーワード検索のみで動作します。** Voyage APIがタイムアウト・レート制限・障害等で失敗した場合も同様にキーワード検索へフォールバックし、LINE Botの応答自体は止まりません。

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

## テスト

```bash
npm test
```

## デプロイ

`Dockerfile`(Node.js 22 alpineベース、マルチステージビルド、非rootユーザー実行、`/health`へのHEALTHCHECK付き)を用意しています。**本番は`render.yaml`(Blueprint定義)を使ってRenderにデプロイ済み**です。Railway / Google Cloud Runなど、他のDockerイメージ常駐デプロイ対応サービスでも同様の構成で動作するはずです。

### Renderへのデプロイ(実施済みの手順)

1. Renderダッシュボードで GitHubリポジトリ(`redcola1030503-svg/dm-ruling-bot`)と連携し、Web Serviceを作成(Docker、Starterプラン以上 — 永続ディスクはFreeプラン非対応)
2. `render.yaml`に定義済みの環境変数のうち、機密情報(`LLM_API_KEY`/`LINE_CHANNEL_SECRET`/`LINE_CHANNEL_ACCESS_TOKEN`/`VALID_JUDGE_IDS`)をRenderダッシュボード上で入力
3. Disk設定で`/app/data`に1GBをマウント、Health Check Pathに`/health`を設定
4. デプロイ後、LINE Developers ConsoleのWebhook URLを`https://<Renderが割り当てたURL>/webhook/line`に変更し「検証」で成功を確認
5. Auto-Deployは「On Commit」設定のため、以後は`master`へのPushで自動的に再デプロイされる

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
| `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers Consoleの本番チャネルの値を設定 |
| `VALID_JUDGE_IDS` | 実際に運用する公認ジャッジIDのみを列挙 |
| `VOYAGE_API_KEY` | 任意。未設定でもキーワード検索のみで動作する。設定する場合はデプロイ後に`npm run embeddings:rules`でembeddingを生成すること |
| `ENABLE_DEBUG_ROUTES` | **必ず未設定または`false`にする**(`/api/debug/*`は本番で無効化)。なお`NODE_ENV=production`(Dockerfileで設定済み)の場合はこの値が`true`でもコード側で強制的に無効化される(多層防御) |
| `DATABASE_URL` | 永続ボリューム上のパスを指定(例: `/app/data/cache.db`) |
| `PORT` | Renderはコンテナに`PORT`環境変数を自動注入し、そのポートで待ち受ける(明示的な設定は不要。本番では10000番ポートが割り当てられている) |

### デプロイ後の確認

1. `GET /health` が `{"status":"ok"}` を返すこと
2. LINE Developers ConsoleのWebhook URLを本番URL(`https://<本番ドメイン>/webhook/line`)に更新し、「検証」が成功すること
3. `POST /api/debug/search` 等のデバッグ系エンドポイントが404または無効化されていること(`ENABLE_DEBUG_ROUTES`未設定を確認)
4. LINEから実際に質問を送り、裁定の返信が届くこと(本番確認済み: 2026-08-10)

## セキュリティ・品質対策

- `POST /api/ruling`: 1分あたり10リクエストまでにレート制限(`express-rate-limit`)
- `POST /webhook/line`: 1分あたり60リクエストまでにレート制限、LINE署名検証必須
- リバースプロキシ(ngrok/Render/Railway等)配下での実行を想定し `trust proxy` を設定済み
- 公式サイトへのスクレイピングは同一ホストへ最低500ms間隔、タイムアウト10秒、リトライ2回(`src/utils/httpClient.ts`)
- ログには質問文・検出カード名・検索キーワード・取得したQ&A/ルール変更/総合ルールのURL・confidence・処理時間・エラーを記録。LINEユーザーIDや個人情報はログに出力しない
