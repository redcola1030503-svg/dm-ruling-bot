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
- [x] Phase 6: LINE Bot — 実機確認済み(ngrok経由でWebhook動作確認)
- [x] 総合ルールPDF検索 — 実機確認済み。裁定の優先順位を「総合ルールへの当てはめ最優先→類似Q&A事例→ルール変更→カードテキスト」に変更
- [x] Phase 7: 品質改善(一部) — レート制限・ログ整備・カード読み仮名検索を実装。Q&A rerank(LLM)は既存のスコアリングで十分な精度が出ているため見送り
- [x] カード専用Q&A一覧の活用 — 実際の誤答事例から発見。カード詳細ページに埋め込まれた「このカードのよくある質問」への直接リンクを活用し、キーワード検索で漏れていたQ&Aを拾えるように改善(実機確認済み)
- [x] confidence信頼性の改善 — 「表面的にキーワードは一致するが論点が異なるQ&A」を誤って強い根拠にしてしまう問題を実際の誤答事例から発見。LLM自身にconfidenceを自己評価させ、機械的スコアとの慎重な方を採用するよう変更。medium/lowの場合は「推論を含む」「ジャッジに確認を」という注記を自動付与するよう改善(実機確認済み)
- [x] JSON出力順序の変更 — conclusionとexplanationが矛盾する出力(結論見出しと理由説明で逆のことを言う)を実際の誤答事例で発見。JSON出力順を steps→explanation→conclusion に変更し、推論してから結論を書く構造にして矛盾を防止
- [x] ジャッジ訂正の蓄積・参照機能 — LINEで`/訂正 <正しい裁定>`コマンドにより、ログイン中のジャッジが直前のBot回答への訂正を記録できる。蓄積された訂正は「非公式な過去の誤答実績」として、以降の類似質問でLLMに参考提示され、同じ誤りの再発を防ぐ(公式情報の根拠としては使わない設計)
- [x] 公認ジャッジのログイン機能 — `/login <ジャッジID>`で`VALID_JUDGE_IDS`に登録済みのジャッジIDのみログインでき、ログイン中のLINEユーザーのみ`/訂正`コマンドを実行できる。ログイン状態はDBにセッションとして保存し、`/logout`で解除できる

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

## テスト

```bash
npm test
```

## デプロイ

`Dockerfile`(Node.js 22 alpineベース、マルチステージビルド、非rootユーザー実行、`/health`へのHEALTHCHECK付き)を用意しています。Render / Railway / Google Cloud Runなど、Dockerイメージからの常駐デプロイに対応したサービスを想定しています。

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
| `ENABLE_DEBUG_ROUTES` | **必ず未設定または`false`にする**(`/api/debug/*`は本番で無効化)。なお`NODE_ENV=production`(Dockerfileで設定済み)の場合はこの値が`true`でもコード側で強制的に無効化される(多層防御) |
| `DATABASE_URL` | 永続ボリューム上のパスを指定(例: `/app/data/cache.db`) |
| `PORT` | デプロイ先が要求するポート番号に合わせる(Cloud Run等は`PORT`を自動注入する場合あり) |

### デプロイ後の確認

1. `GET /health` が `{"status":"ok"}` を返すこと
2. LINE Developers ConsoleのWebhook URLを本番URL(`https://<本番ドメイン>/webhook/line`)に更新し、「検証」が成功すること
3. `POST /api/debug/search` 等のデバッグ系エンドポイントが404または無効化されていること(`ENABLE_DEBUG_ROUTES`未設定を確認)

## セキュリティ・品質対策

- `POST /api/ruling`: 1分あたり10リクエストまでにレート制限(`express-rate-limit`)
- `POST /webhook/line`: 1分あたり60リクエストまでにレート制限、LINE署名検証必須
- リバースプロキシ(ngrok/Render/Railway等)配下での実行を想定し `trust proxy` を設定済み
- 公式サイトへのスクレイピングは同一ホストへ最低500ms間隔、タイムアウト10秒、リトライ2回(`src/utils/httpClient.ts`)
- ログには質問文・検出カード名・検索キーワード・取得したQ&A/ルール変更/総合ルールのURL・confidence・処理時間・エラーを記録。LINEユーザーIDや個人情報はログに出力しない
