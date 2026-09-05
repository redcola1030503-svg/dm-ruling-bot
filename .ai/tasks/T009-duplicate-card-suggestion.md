# T009: カード名サジェストに同一カード名が重複して表示される不具合

Status: 実装後レビュー対応済み、未コミット(Review 1で原因特定・Review 2で実装方針決定・実装完了・実装後レビューでP1 2件を追加反映)

## Goal

ユーザーがモバイルアプリで「輝きは」と入力した際、カード名サジェスト(`長押しでカード名を入力`欄)に「〜輝きは奇跡そのもの〜」が2件、完全に同じ表示で重複して並ぶ不具合が報告された。原因を調査し、対応方針を固める。

## 前提(証拠)

- ユーザー提供のスクリーンショット(2026-09-04)。質問入力画面で「輝きは」と入力し、サジェスト候補欄に「〜輝きは奇跡そのもの〜」が2行、同一の表示テキストで連続して表示されている。
- サジェストAPIは`GET /api/cards/suggest?q=...`(`src/routes/cards.ts:21-30`)、内部で`suggestCardNames(q, 10)`(`src/cards/cardIndexRepository.ts:43-68`)を呼び出す。

## コード上の既存の重複排除ロジック(確認済み)

`suggestCardNames`は以下の二重の重複排除を行っている。

1. SQL側: `card_index`と`card_index_alt_name`のUNION結果を`GROUP BY id`で集約し、同一`id`につき1行だけを返す(`cardIndexRepository.ts:35-41`)。これはT004で「表/裏どちらの面の名前でもヒットする」ようにした際、同一idが主要名・別名の両方でLIKEにヒットするケースの重複を防ぐために導入された。
2. JS側: `suggestCardNames`内で`seenIds`(`Set<string>`)を使い、前方一致検索(`prefixRows`)と部分一致検索(`partialRows`)の2回のクエリ結果を`id`単位でさらに重複排除している(`cardIndexRepository.ts:48-65`)。

**上記2点により、同一`id`の重複は理論上発生しない。** したがって、今回の「表示テキストが完全一致する2件」は、**異なる`id`を持つ2行が、たまたま(あるいは何らかのデータ不整合により)同一の`name`文字列を持っている**ケースだと考えられる。

## 仮説(当初、未検証)

1. **card_indexの残存レコード問題(T004/T005で既知)**: 旧idの行がゴミとして残存し、同名で重複表示される。
2. **同名の別カード(公式に本当に存在する)**: 全く別の`id`を持つ別カードが同じカード名を持つ場合(再録等)。
3. **card_index_alt_nameとcard_indexの間の不整合**。

**このセッションでの調査試行と結果**: Render Web Shellから本番DBを直接クエリして切り分けを試みたが、ブラウザ自動化経由での日本語(マルチバイト文字)を含むコマンド入力がターミナル側で正しく処理されず(URLエンコードされた文字列がそのまま出力される等)、有効な結果を得られなかった。代わりに、この方針決定段階のタスクファイルをCodexへレビュー依頼したところ、Codexが公式サイトの公開情報を直接確認し、原因を特定した(下記Review 1参照)。

## 原因(Review 1で特定、仮説2が正解)

対象カード「〜輝きは奇跡そのもの〜」は、現行の異なる2つのカードID `dm25ex3-002`(DM25EX3収録版)と`dm25rp3-012`(DM25RP3収録版)として、公式サイト上に**同名の再録として実在する**。したがって仮説1(残存レコード清掃が必要)という前提は誤りで、`card_index`のデータ自体に不整合は無い。`suggestCardNames`のid単位の重複排除ロジックも正しく動作している。

**副次的な指摘(Review 1)**: このタスクファイルの調査用SQL(上記、修正前バージョン)で使っていた波ダッシュ「〜」(U+301C)は、公式のカード名で使われている全角チルダ「～」(U+FF5E)とは異なる文字。`cardParser.ts`はこの差異を正規化せず`trim()`のみのため、このクエリ自体は本番で実行しても0件になっていた可能性が高い(過去に別の異体字問題として記録済みの「表記ゆれ」パターンの再発、[[project-dm-ruling-bot|Vaultメモリ]]参照)。

**もう一つの重要な指摘(Review 1)**: モバイルアプリ(Flutter)側は、サジェストで選択したカードの`id`を表示・送信せず、**カード名のテキストのみ**を質問入力欄へ挿入している(`inline_card_suggest_field.dart:153,201`)。つまり現行仕様では、ユーザーにとって`id`の違いは意味を持たず(どちらを選んでも同じ名前が入力されるだけ)、「見た目が同じ候補が2つ並ぶ」ことだけが問題になる。

## 対応方針(Review 1指摘を反映して確定)

現行仕様(idを使わず名前のみを挿入する)を前提とする限り、**サジェスト結果を`id`ではなく`name`(表示テキスト)単位で重複排除する**のが妥当。`suggestQuery`(`cardIndexRepository.ts:35-41`)のSQL、または`suggestCardNames`のJS側集約(`seenIds`)に、`name`文字列での重複排除を追加する(例: 既存の`GROUP BY id`の結果をさらに`name`でDISTINCTする、またはJS側で`seenNames`のSetを`seenIds`と並行して持つ)。

**(T012 Review 2で先行して指摘済みの懸念、実装時に反映する)**: JS側で`seenNames`をSQLの`LIMIT`適用後の結果に対して適用する案だと、同名再録がLIMIT枠(10件)を先に占有した場合、DB上には十分な別名候補が存在していても返却件数が数件に減ってしまう。**name単位の集約はSQL側で`LIMIT`より前に行う**(UNION・id集約後にname単位でGROUP化してからLIMIT)。代表として選ぶidも`MIN(id)`等で決定的にする。実装時は「同名再録が10件以上存在し、かつ別名候補も存在する」ケースのテストを追加する。

- 版(id)を区別して見せたい場合は、型番・収録セット名等をサジェスト表示に付加し、選択結果として`id`も後段(質問送信時)へ渡す設計変更が必要になるが、モバイル側の表示・送信仕様の変更を伴う大掛かりな変更になるため、**今回のスコープには含めない**(ユーザーへの実害は「同じ文字列が2回表示され紛らわしい」というUXレベルであり、機能上の実害は無いため)。

## Acceptance Criteria(現段階)

- [x] 仮説1/2/3のいずれに該当するか切り分ける → **2026-09-04、本番DBへの直接クエリは失敗(上記「このセッションでの調査試行と結果」参照)したが、Codexが公式サイトの公開情報を確認し、Review 1で仮説2(正当な別カードの再録)と特定**
- [x] 切り分け結果に基づき対応方針を1つに絞り込み、AGENTS.mdの運用に従いCodexへ方針決定段階のレビューを依頼する → **完了(方針決定と同時にReview 1を実施)**
- [x] name単位の重複排除案についてCodex Review 2を実施する(方針が変わったため) → **完了、P1 1件・P2 2件・P3 1件を反映**
- [x] レビュー反映後、実装に着手する → **完了(下記「実装完了」参照)**

## 実装完了(2026-09-05)

- `src/cards/cardIndexRepository.ts`: `suggestQuery`のSQLを、内側(id単位集約、T004由来)→外側(name単位集約、T009)→LIMITの二段階構造に変更。代表idは`MIN(id)`。`suggestCardNames`は`seenIds`を維持したまま`seenNames`を追加し、両方のSetで重複排除(Review 2 P1反映)。
- `tests/cardIndexRepository.test.ts`: SQL構造の回帰テスト(`GROUP BY id`・`GROUP BY name`の存在、LIMITがname単位集約後にあること)、同名再録カードが1件にまとめられるテスト、同一idが前方一致・部分一致で異なる面名を返す場合でも1件にまとまるテスト(Review 2 P1のケース)、別idの同名行が部分一致側でも重複排除されるテストを追加。

**検証**: `npm run typecheck`・`npm test`(49ファイル/369テスト)PASS。実SQLite(node:sqlite)による検証で、(1)同名再録カード(異なるid・同じname)が1件にまとまり代表idがMIN(id)になること、(2)同名再録がLIMIT件数(15件)以上存在する状況でも、他の別名候補(「重複カードX」)がLIMIT(3件)内に含まれること(name単位集約がLIMIT前に行われていることの回帰確認)、(3)前方一致内で同名2件が1件にまとまること、を確認した(検証用スクリプトは実行後に削除済み)。

### Review 3 — 2026-09-05(実装後レビュー、Codex)

- P1: 部分一致側は`limit`行しか取得しないが、前方一致の1件が部分一致側で最大2行(同idの別面名による`seenIds`除外、別idの同名による`seenNames`除外)を除外しうる。除外分を考慮せず`limit`件のまま取得すると、実際には十分な候補が存在するのに返却件数が`limit`へ届かないことがある → 部分一致の取得件数を`limit + prefixRows.length`に変更(前方一致件数をkとすると、除外されうる行は最大2k、必要な新規行はlimit-kのため、limit+k件あれば必ず充足できる)。この具体例(前方一致1件が部分一致側でid重複・name重複の2行を除外しても新規候補でlimitまで満たす)の回帰テストを追加
- P1: Round2で要求した「LIMIT位置の実動作」検証が、恒久的な回帰テストとして残っておらず、一時的な実SQLite確認のみだった → 恒久化を試みたが、**vitest環境(Vite 5.4.21)が`node:sqlite`モジュールの静的importの解決に対応しておらず(`Failed to load url sqlite`)、`resolve.conditions`・`ssr.external`・`server.deps.external`・カスタムViteプラグインの`resolveId`フック・`pool: "forks"`のいずれを試しても解消しなかった**(node:sqliteがNode 22.5+の比較的新しい機能で、Vite 5.4系の組み込みモジュール一覧にまだ含まれていないためと考えられる)。当初は恒久化を断念し一時スクリプト方式を維持する方針としたが、**Round4レビュー(下記参照)で`createRequire(import.meta.url)`経由の実行時requireでVite静的解析を回避できると指摘され、実際に解決した(下記Review 4参照)**
- P2: タスクファイル冒頭の`Status`が`Draft(...実装は未着手)`のままで、後半の実装完了記録と矛盾していた → 実態に合わせて更新
- 総評: 上記2件のP1以外は重大な問題なし。SQLの二段階集約(`GROUP BY id`→`GROUP BY name`→`LIMIT`)、`seenIds`/`seenNames`併用は意図通り実装されていることを確認済み

**再検証(Review 3反映後)**: `npm run typecheck`・`npm test`(49ファイル/370テスト)PASS。実SQLite検証(3ケース)も再実施しPASS(検証用スクリプトは削除済み)。

### Review 4 — 2026-09-05(部分一致取得件数修正+vitest制約記録への確認レビュー、Codex)

- P1: 恒久的な実SQLite回帰テストの断念は、代替手段(`createRequire(import.meta.url)`経由の実行時require、それも困難なら子プロセス起動)の検討が不十分だった → **`createRequire`方式を試したところ解決した**。テストファイル内で`const require = createRequire(import.meta.url); const { DatabaseSync } = require("node:sqlite");`とし、`vi.mock("../src/config/db", () => ({ db: realDb }))`で本物のin-memory SQLiteインスタンスを`db`として注入する形にしたところ、Viteの静的モジュール解決を回避でき、恒久的な実SQLite回帰テスト(`tests/cardIndexRepository.sqlite.test.ts`、Codexが提示した3ケースすべて)が実現できた
- 確認事項への回答: (1)`limit + prefixRows.length`への変更は正しい(Codex確認済み)。(2)追加した`toHaveBeenCalledWith("%Zoo%", 6)`のテストは旧実装(`5`)を確実に検出できる。(3)恒久テスト断念の判断は当初不十分だったが、上記の通り解決した。(4)その他の要件漏れ・regressionは無し

**最終検証**: `npm run typecheck`・`npm test`(50ファイル/373テスト、新規`cardIndexRepository.sqlite.test.ts`の3テストを含む)PASS。

## 実装イメージ(Review 2依頼用ドラフト、2026-09-05)

`src/cards/cardIndexRepository.ts`の`suggestQuery`・`suggestCardNames`を以下のように変更する。

```typescript
// 変更前(id単位のみ集約、LIMIT適用):
function suggestQuery(likePattern: string, limit: number): CardSuggestion[] {
  return db
    .prepare(
      `SELECT id, MIN(name) as name FROM (${SUGGEST_UNION_SQL}) WHERE name LIKE ? ESCAPE '\\' GROUP BY id ORDER BY name LIMIT ?`,
    )
    .all(likePattern, limit) as CardSuggestion[];
}

// 変更後(id単位で集約した結果を、さらにLIMIT前にname単位で集約する):
function suggestQuery(likePattern: string, limit: number): CardSuggestion[] {
  return db
    .prepare(
      `SELECT MIN(id) as id, name FROM (
         SELECT id, MIN(name) as name FROM (${SUGGEST_UNION_SQL}) WHERE name LIKE ? ESCAPE '\\' GROUP BY id
       ) GROUP BY name ORDER BY name LIMIT ?`,
    )
    .all(likePattern, limit) as CardSuggestion[];
}
```

- 内側のサブクエリ: 既存の`GROUP BY id`(T004由来、表/裏両面ヒット時の同一id重複排除)はそのまま維持する。
- 外側の`GROUP BY name`: 同名再録(異なるid・同じname)を1行にまとめる。代表idは`MIN(id)`で決定的に選ぶ(実行のたびに異なるidが返る非決定性を避ける)。
- `LIMIT`は外側(name単位集約後)に適用するため、同名再録がLIMIT枠を専有して他の別名候補を締め出す問題(T012 Review 2で先行して指摘済み)を回避する。

`suggestCardNames`側は、`seenIds`(id単位)は**削除せず維持**した上で、`seenNames`(name単位)を新たに追加し、両方で重複排除する(Codexレビュー指摘、2026-09-05、Review 2: 内側の`MIN(name)`は前方一致・部分一致で対象集合が異なるため、同じidでも異なる面名が選ばれることがある。`seenIds`を`seenNames`に完全置換すると、この場合に同一idが2回返ってしまう。両方のSetを併用することで、既存のid単位の保証〈同一idは1回だけ〉と、今回追加するname単位の保証〈同名再録は1回だけ〉の両方を維持する)。

```typescript
export function suggestCardNames(query: string, limit: number): CardSuggestion[] {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];

  const escaped = escapeLikePattern(trimmed);
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const results: CardSuggestion[] = [];

  const prefixRows = suggestQuery(`${escaped}%`, limit);
  for (const row of prefixRows) {
    seenIds.add(row.id);
    seenNames.add(row.name);
    results.push(row);
  }

  if (results.length < limit) {
    const partialRows = suggestQuery(`%${escaped}%`, limit);
    for (const row of partialRows) {
      if (seenIds.has(row.id) || seenNames.has(row.name)) continue;
      seenIds.add(row.id);
      seenNames.add(row.name);
      results.push(row);
      if (results.length >= limit) break;
    }
  }

  return results;
}
```

**`MIN(id)`の意味の明確化(Codexレビュー指摘、2026-09-05、Review 2)**: 外側の`MIN(id)`は「その名前を持つ全生データ中の最小id」ではなく、正確には「内側のid単位集約でその名前が選ばれた行の中での最小id」である。複数面が同時にLIKEに一致したidでは、内側の`MIN(name)`によって別の面名が選ばれ、そのidが外側の対象名グループに現れないことがあるが、これはT004の「同じidから複数候補を出さない」という既存方針との自然な結果であり、現行ではidが後段(質問送信時)で利用されないため実害は無い。将来idを選択結果として利用する場合は、単なる`MIN(id)`を版選択規則として扱わず再設計する必要がある。

**想定するテストケース**(Review 2指摘を反映):
- 同名の異なるid 2件がLIKEにヒットする場合、1件にまとめられ、代表idは「内側のid単位集約後に残った候補の中での`MIN(id)`」になること
- 同名再録がLIMIT件数以上存在する状況でも、他の別名候補がLIMIT内に含まれること(name単位集約がLIMIT前に行われていることの回帰テスト。旧SQLなら重複名が先に並んでLIMITを消費するよう、名前の並び順を明示したfixtureにする)
- 前方一致・部分一致の両方に同名(異なるid)の行が含まれる場合、名寄せされて1件になること
- **同一idが前方一致と部分一致で異なる面名になる場合でも、そのidは1件だけ返ること**(Review 2 P1で指摘されたケース: 同じidに「クエリで始まる名前」と「クエリを途中に含み辞書順ではより小さい名前」を登録し、前方一致と部分一致で内側の`MIN(name)`が異なる状況を作る)
- 既存のT004由来のテスト(表/裏面どちらの名前でもヒットする、同一idの重複が出ない)が壊れていないこと

**Out of Scope(Review 2 P3)**: `GROUP BY name`・`Set<string>`はUnicode正規化を行わないため、U+301C(波ダッシュ)とU+FF5E(全角チルダ)のような見た目の近い異体字は別名として残る。今回対応するのはDB上でも完全に同じ`name`を持つ再録カードのケースであり、表記ゆれ対応は別タスクとする。

## Implementation Owner

Claude Code

## Reviewer

Codex

## Review History

### Review 1 — 2026-09-04(方針決定段階、調査中のドラフト)

- P1: 原因調査は既に公式情報から確定できる。対象名には現行の異なる2 ID(`dm25ex3-002`・`dm25rp3-012`)があり、同名再録と判明。残存レコード清掃へ進む前提(仮説1)は不適切。また調査用SQLで使った波ダッシュ「〜」(U+301C)は公式名の全角チルダ「～」(U+FF5E)と異なり、`trim()`のみでは正規化されないため0件になる可能性がある。モバイル側はidを表示・送信せず名前のみ挿入する仕様のため、name単位での重複排除が現仕様に自然に合う対応 → 上記「原因」「対応方針」として反映

### Review 2 — 2026-09-05(実装イメージへの方針決定段階レビュー)

- P1: `suggestCardNames`で`seenIds`を`seenNames`に完全置換する案は回帰リスクがある。内側の`MIN(name)`は前方一致・部分一致で対象集合が異なるため、同じidでも異なる面名が選ばれることがあり(例: 同一idに`ZooFront`・`AZooBack`の2面があり「Zoo」で検索すると、前方一致は`ZooFront`、部分一致は辞書順の小さい`AZooBack`を選ぶ)、`seenNames`だけでは同一idが2回返ってしまう → `seenIds`を維持したまま`seenNames`を追加し、両方のSetで重複排除するよう修正(上記「実装イメージ」参照)
- P2: 外側の`MIN(id)`の意味(「その名前を持つ全生データ中の最小id」ではなく「内側のid単位集約後に残った候補の中での最小id」)をタスク記載・テストで明確にする → 上記「実装イメージ」に明記
- P2: 想定テストケースに、同一idが前方一致・部分一致で異なる面名になるケース(P1相当)が無かった → テストケース一覧に追加。「同名再録がLIMIT件数以上」のテストも、名前の並び順を明示したfixtureにする(LIMIT位置の回帰を確実に検出するため)
- P3: `GROUP BY name`・`Set<string>`はUnicode正規化を行わないため、波ダッシュ/全角チルダ等の異体字は別名として残る → 今回のスコープ(DB上で完全に同じnameを持つ再録カード)としては問題なし、表記ゆれ対応は別タスクとする(Out of Scopeに明記)
- 総評: SQL変更案(内側id集約→外側name集約→LIMIT)自体は「name単位の重複排除をLIMIT前に行う」という意図を実現できており、T004の「1id1行」も維持されている。方針に重大な問題なし、上記反映後に実装可
