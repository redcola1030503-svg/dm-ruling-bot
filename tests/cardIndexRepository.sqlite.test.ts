import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

// T009(Codexレビュー指摘、2026-09-05、Round4): モックベースのテスト
// (cardIndexRepository.test.ts)はJS側の重複排除ロジックのみを検証しており、
// SQL自体の`GROUP BY id`→`GROUP BY name`→`LIMIT`という二段階集約が実際に
// 意図通り動作すること(特に「name単位集約がLIMIT適用前に行われる」という
// 性質)を検証していない。`import { DatabaseSync } from "node:sqlite"`を
// 静的importすると、Vite(5.4.21時点)がモジュール解決に失敗する
// (`Failed to load url sqlite`、node:sqliteがVite側の組み込みモジュール
// 一覧にまだ無いためと思われる)ため、`createRequire`経由の実行時requireで
// Viteの静的解析を回避する(Codexレビュー提案)。
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

const realDb = new DatabaseSync(":memory:");
realDb.exec(`
  CREATE TABLE card_index (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE card_index_alt_name (
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (id, name)
  );
`);

vi.mock("../src/config/db", () => ({ db: realDb }));

const { suggestCardNames, upsertCardIndexEntry } = await import("../src/cards/cardIndexRepository");

describe("cards/cardIndexRepository(実SQLiteによるSQL集約の回帰テスト、T009)", () => {
  beforeEach(() => {
    realDb.exec("DELETE FROM card_index");
    realDb.exec("DELETE FROM card_index_alt_name");
  });

  it("同名再録カード(異なるid・同じname)が1件に集約され、代表idは内側id単位集約後のMIN(id)になる", () => {
    upsertCardIndexEntry("dm25rp3-012", "輝きは奇跡そのもの", "https://example.com/b");
    upsertCardIndexEntry("dm25ex3-002", "輝きは奇跡そのもの", "https://example.com/a");

    const result = suggestCardNames("輝きは", 10);

    expect(result).toEqual([{ id: "dm25ex3-002", name: "輝きは奇跡そのもの" }]);
  });

  it("同名再録がLIMIT件数以上存在しても、他の別名候補がLIMIT内に含まれる(name単位集約がLIMIT適用前に行われることの回帰確認。旧SQル〈id単位集約後に直接LIMIT〉であれば、同名15件がLIMIT枠を専有し検索B・検索Cは返らない)", () => {
    for (let i = 0; i < 15; i++) {
      upsertCardIndexEntry(`dup-${i}`, "検索A", `https://example.com/dup-${i}`);
    }
    upsertCardIndexEntry("b-1", "検索B", "https://example.com/b-1");
    upsertCardIndexEntry("c-1", "検索C", "https://example.com/c-1");

    const result = suggestCardNames("検索", 3);

    expect(result.map((r) => r.name)).toEqual(["検索A", "検索B", "検索C"]);
    expect(result.find((r) => r.name === "検索A")?.id).toBe("dup-0");
  });

  it("card_indexとcard_index_alt_nameを跨いだ同名(裏面名と主要名が偶然一致するケースを含む)も1件に集約される", () => {
    upsertCardIndexEntry("id-1", "表の名前", "https://example.com/1");
    realDb.prepare("INSERT INTO card_index_alt_name (id, name, updated_at) VALUES (?, ?, ?)").run(
      "id-2",
      "表の名前",
      Date.now(),
    );

    const result = suggestCardNames("表の名前", 10);

    expect(result.length).toBe(1);
    expect(result[0].name).toBe("表の名前");
  });
});
