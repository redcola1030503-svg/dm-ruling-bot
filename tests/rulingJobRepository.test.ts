import { beforeEach, describe, expect, it, vi } from "vitest";

const prepareMock = vi.fn();
const execMock = vi.fn();
vi.mock("../src/config/db", () => ({
  db: { prepare: (...args: unknown[]) => prepareMock(...args), exec: (...args: unknown[]) => execMock(...args) },
}));

const decrementMonthlyUsage = vi.fn<(deviceId: string, monthKey: string) => void>();
vi.mock("../src/billing/deviceMonthlyUsageRepository", () => ({
  decrementMonthlyUsage: (deviceId: string, monthKey: string) => decrementMonthlyUsage(deviceId, monthKey),
}));

const {
  createJob,
  getJobsByThread,
  deleteJobsByThread,
  pruneOldJobs,
  migrateLegacyCorrectionTitlesInResultJson,
  findUnresolvedLegacyCorrectionTitleJobIds,
  finalizeRulingJob,
  finalizeOrphanedRulingJob,
  markRunning,
  renewHeartbeat,
} = await import("../src/ruling/rulingJobRepository");

describe("rulingJobRepository", () => {
  beforeEach(() => {
    prepareMock.mockReset();
    execMock.mockReset();
    decrementMonthlyUsage.mockReset();
  });

  it("createJob: thread_id・usage_month_keyを含めてINSERTする", () => {
    const runFn = vi.fn();
    prepareMock.mockReturnValue({ run: runFn });

    createJob("job-1", "質問", "device-1", "thread-1", "2026-09");

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("thread_id"));
    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("usage_month_key"));
    expect(runFn).toHaveBeenCalledWith("job-1", "device-1", "質問", "thread-1", "2026-09", expect.any(Number));
  });

  it("getJobsByThread: thread_idで絞り込みcreated_at昇順で取得する", () => {
    const allFn = vi.fn().mockReturnValue([]);
    prepareMock.mockReturnValue({ all: allFn });

    getJobsByThread("thread-1");

    expect(prepareMock).toHaveBeenCalledWith(
      expect.stringMatching(/WHERE thread_id = \?[\s\S]*ORDER BY created_at ASC/),
    );
    expect(allFn).toHaveBeenCalledWith("thread-1");
  });

  it("deleteJobsByThread: thread_idで絞り込みDELETEする", () => {
    const runFn = vi.fn();
    prepareMock.mockReturnValue({ run: runFn });

    deleteJobsByThread("thread-1");

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("WHERE thread_id = ?"));
    expect(runFn).toHaveBeenCalledWith("thread-1");
  });

  it("pruneOldJobs: thread_id IS NULLの孤立ジョブのみを削除対象にする", () => {
    const runFn = vi.fn();
    prepareMock.mockReturnValue({ run: runFn });

    pruneOldJobs(1000);

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("thread_id IS NULL"));
    expect(runFn).toHaveBeenCalledWith(expect.any(Number));
  });

  describe("markRunning/renewHeartbeat(T012 Review 8: worker_id/heartbeat_atリース)", () => {
    it("markRunning: status・started_atに加えてworker_id・heartbeat_atも設定する", () => {
      const runFn = vi.fn();
      prepareMock.mockReturnValue({ run: runFn });

      markRunning("job-1", "worker-abc");

      expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("worker_id"));
      expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("heartbeat_at"));
      expect(runFn).toHaveBeenCalledWith(expect.any(Number), "worker-abc", expect.any(Number), "job-1");
    });

    it("renewHeartbeat: 自分のworker_idかつrunning状態のジョブのみを対象にUPDATEする", () => {
      const runFn = vi.fn();
      prepareMock.mockReturnValue({ run: runFn });

      renewHeartbeat("job-1", "worker-abc");

      expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("worker_id = ?"));
      expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("status = 'running'"));
      expect(runFn).toHaveBeenCalledWith(expect.any(Number), "job-1", "worker-abc");
    });
  });

  describe("migrateLegacyCorrectionTitlesInResultJson(T008)", () => {
    it("result_json内の旧title(ジャッジID入り)をjudgeIdを含まない表記へ置き換えて保存する", () => {
      const legacyResultJson = JSON.stringify({
        conclusion: "結論",
        sources: [{ title: "過去の訂正事例(ジャッジID: J001)", url: "" }],
      });
      const allFn = vi.fn().mockReturnValue([{ id: "job-1", result_json: legacyResultJson }]);
      const runFn = vi.fn();
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id, result_json")) return { all: allFn };
        return { run: runFn };
      });

      const result = migrateLegacyCorrectionTitlesInResultJson(["J001"]);

      expect(result).toEqual({ migrated: 1, unresolvedMarkerCount: 0, invalidJsonCount: 0, possibleKnownIdCollisionCount: 0 });
      expect(runFn).toHaveBeenCalledWith(
        expect.stringContaining("過去の訂正事例(公認ジャッジによる記録)"),
        "job-1",
      );
      expect(runFn.mock.calls[0][0]).not.toContain("J001");
    });

    it("コロン直後にスペースが無い旧title形式(本番で実際に確認された形式)も置き換える", () => {
      // 2026-09-04、本番DBの読み取り専用クエリでこの形式(スペース無し)の
      // 移行漏れを確認・修正した回帰テスト(実際のjudgeIdはここには記載しない)。
      const legacyResultJson = JSON.stringify({
        conclusion: "結論",
        sources: [{ title: "過去の訂正事例(ジャッジID:J001)", url: "" }],
      });
      const allFn = vi.fn().mockReturnValue([{ id: "job-1", result_json: legacyResultJson }]);
      const runFn = vi.fn();
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id, result_json")) return { all: allFn };
        return { run: runFn };
      });

      const result = migrateLegacyCorrectionTitlesInResultJson(["J001"]);

      expect(result).toEqual({ migrated: 1, unresolvedMarkerCount: 0, invalidJsonCount: 0, possibleKnownIdCollisionCount: 0 });
      expect(runFn.mock.calls[0][0]).not.toContain("J001");
    });

    it("全角括弧で言い換えられた旧title形式(LLM生成の説明文中、本番で実際に確認された形式)は、埋め込み文脈のため自動置換せず未解決として報告する(Codexレビュー指摘、2026-09-04、round 14: 詳細は下記の説明参照)", () => {
      // 2026-09-04、再マイグレーション実行後もresult_json残存1件が消えなかったため
      // 本番DBの読み取り専用クエリで原因調査した結果判明した第3の亜種(実際のjudgeIdは
      // ここには記載しない)。sourcesのtitleではなく、LLMが生成したexplanation文中で
      // 「過去の訂正事例」を全角括弧（）で言い換えている箇所だった。
      //
      // 当初はこの埋め込みケースも正規表現の部分置換で自動的に直していたが、
      // 「IDの終端をどこまでとみなすか」という判断が必要になる時点で、文字種
      // 無制約のIDに対しては原理的に安全な境界判定ができない(round 14のCodex
      // レビューで、閉じ括弧直後がひらがな/漢字等の場合に断片が残ったまま誤って
      // 成功扱いになる具体例が指摘された)。そのため、旧titleが説明文へ埋め込まれた
      // ケースは自動置換の対象から外し、ラベル「ジャッジID」が残っていることを
      // unresolvedMarkerCountで検出させ、手動確認に回す設計にした。
      //
      // **このテストの対象データ(全角括弧での言い換え)は、実際に本番の
      // ruling_job.result_jsonへ現時点でも未解決のまま残っている(round 15の
      // Codexレビュー指摘、2026-09-04: この設計変更をデプロイして再実行しても
      // この行は自動解消されない)。この行は本タスクの自動移行の対象外とし、
      // 手動での個別対応が必要(`.ai/tasks/T008-correction-leak-quick-fix.md`の
      // 「残作業」参照)。**
      const legacyResultJson = JSON.stringify({
        conclusion: "結論",
        explanation: "なお、これは過去の訂正事例(ジャッジID:J001)とは論点が異なる。".replace("(", "（").replace(")", "）"),
      });
      const allFn = vi.fn().mockReturnValue([{ id: "job-1", result_json: legacyResultJson }]);
      const runFn = vi.fn();
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id, result_json")) return { all: allFn };
        return { run: runFn };
      });

      const result = migrateLegacyCorrectionTitlesInResultJson(["J001"]);

      expect(result).toEqual({ migrated: 0, unresolvedMarkerCount: 1, invalidJsonCount: 0, possibleKnownIdCollisionCount: 1 });
      expect(runFn).not.toHaveBeenCalled();
    });

    it("旧title形式がフィールド値全体と完全一致する場合は、IDの値自体に閉じ括弧を含んでいても断片を残さず正しく置換する(Codexレビュー指摘: ジャッジIDの入力検証(judgesルートのz.string().min(1).max(100))は文字種を制約していないため、IDに閉じ括弧が含まれることは実際にありうる)", () => {
      // 文字列全体がlegacyTitles(Set<string>)のいずれかと完全一致する場合のみを
      // 対象にする設計(round 14で導入、round 17でSet<string>.has()による直接比較へ
      // 変更)により、IDの内容に何が含まれていても「一致直後に何が続くか」を
      // 推測する必要が無い(一致条件そのものが「文字列全体がこれと同じ」であるため)。
      const legacyResultJson = JSON.stringify({
        sources: [{ title: "過去の訂正事例(ジャッジID:JUDGE)SECRET)", url: "" }],
      });
      const allFn = vi.fn().mockReturnValue([{ id: "job-1", result_json: legacyResultJson }]);
      const runFn = vi.fn();
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id, result_json")) return { all: allFn };
        return { run: runFn };
      });

      const result = migrateLegacyCorrectionTitlesInResultJson(["JUDGE)SECRET"]);

      expect(result).toEqual({ migrated: 1, unresolvedMarkerCount: 0, invalidJsonCount: 0, possibleKnownIdCollisionCount: 0 });
      const updatedJson = runFn.mock.calls[0][0] as string;
      expect(updatedJson).not.toContain("SECRET");
      expect(updatedJson).not.toContain("JUDGE");
      expect(updatedJson).toContain("過去の訂正事例(公認ジャッジによる記録)");
      expect(() => JSON.parse(updatedJson)).not.toThrow();
    });

    it("末尾に改行が付いた文字列は完全一致とみなさず置換しない(Codexレビュー指摘、2026-09-04、round 17: 旧`^...$`正規表現案は、一部の正規表現実装で`$`が末尾の改行の直前にも一致しうるため「完全一致」の保証が崩れる懸念があった。この懸念自体はJavaScript〈mフラグ無し〉には実際には当てはまらないことをNode.jsで直接検証済みだが、正規表現の意味論に関する知識に依存しない設計にするため、Set<string>.has()による文字列の直接比較へ変更した。この回帰テストは、末尾に改行が付いた文字列が誤って完全一致と判定されないことを確認する)", () => {
      const legacyResultJson = JSON.stringify({
        sources: [{ title: "過去の訂正事例(ジャッジID:J001)\n", url: "" }],
      });
      const allFn = vi.fn().mockReturnValue([{ id: "job-1", result_json: legacyResultJson }]);
      const runFn = vi.fn();
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id, result_json")) return { all: allFn };
        return { run: runFn };
      });

      const result = migrateLegacyCorrectionTitlesInResultJson(["J001"]);

      // 末尾の改行を含めた文字列全体はlegacyTitlesのどれとも完全一致しないため
      // 置換されない。ラベル「ジャッジID」がそのまま残り、unresolvedMarkerCountで
      // 正しく検出される。
      expect(result).toEqual({ migrated: 0, unresolvedMarkerCount: 1, invalidJsonCount: 0, possibleKnownIdCollisionCount: 1 });
      expect(runFn).not.toHaveBeenCalled();
    });

    it("短い既知IDが、別の長い既知IDの前方一致になっている場合でも、文字列全体の完全一致比較により誤って短い方でマッチしない(既知一覧の並び順に依存しない)", () => {
      // 既知ID "JUDGE" と "JUDGE)SECRET" が同時に存在する場合でも、legacyTitles
      // (Set<string>)との完全一致比較により、フィールド値全体が"JUDGE"の
      // legacyTitleと一致することはない(末尾に")SECRET)"が残ってしまい文字列
      // 全体としては一致しないため)。長い方のlegacyTitleだけが完全一致し、
      // 並び順のソートに頼らず正しく解決できることを確認する。
      const legacyResultJson = JSON.stringify({
        sources: [{ title: "過去の訂正事例(ジャッジID:JUDGE)SECRET)", url: "" }],
      });
      const allFn = vi.fn().mockReturnValue([{ id: "job-1", result_json: legacyResultJson }]);
      const runFn = vi.fn();
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id, result_json")) return { all: allFn };
        return { run: runFn };
      });

      // 既知一覧の並び順を意図的に「短い方が先」にする。
      const result = migrateLegacyCorrectionTitlesInResultJson(["JUDGE", "JUDGE)SECRET"]);

      expect(result).toEqual({ migrated: 1, unresolvedMarkerCount: 0, invalidJsonCount: 0, possibleKnownIdCollisionCount: 0 });
      const updatedJson = runFn.mock.calls[0][0] as string;
      expect(updatedJson).not.toContain("SECRET");
      expect(updatedJson).not.toContain("JUDGE");
      expect(() => JSON.parse(updatedJson)).not.toThrow();
    });

    it("本来の(より長い)IDが訂正・ジャッジの両方の削除により既知一覧から失われていても、現存する短いIDによる断片化した誤置換をしない(Codexレビュー指摘: knownJudgeIdsは削除されたIDを保持できないため、既知一覧の完全性だけには頼れない)", () => {
      // "JUDGE)SECRET"というIDを持つジャッジと、それを使った訂正が両方とも
      // 削除された(削除APIは実在する)状況を模擬する。knownJudgeIdsには
      // 現存する別の短いID"JUDGE"しか渡さない(=本来のIDはもう分からない)。
      const legacyResultJson = JSON.stringify({
        sources: [{ title: "過去の訂正事例(ジャッジID:JUDGE)SECRET)", url: "" }],
      });
      const allFn = vi.fn().mockReturnValue([{ id: "job-1", result_json: legacyResultJson }]);
      const runFn = vi.fn();
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id, result_json")) return { all: allFn };
        return { run: runFn };
      });

      const result = migrateLegacyCorrectionTitlesInResultJson(["JUDGE"]);

      // "JUDGE"の完全一致パターンは`^...$`のため、末尾に")SECRET)"が残る文字列
      // 全体とは一致しない(=置換されない)。ラベル「ジャッジID」がそのまま残るため、
      // unresolvedMarkerCountとして正しく検出され、断片化した誤った成功扱いには
      // ならない。加えて、既知ID値"JUDGE"自体は(置換されなかった結果として)文字列中に
      // 実在するため、possibleKnownIdCollisionCountも独立して1になる(Codexレビュー指摘、
      // 2026-09-04、round 14: else ifの排他集計だとこれが欠落していた)。
      expect(result).toEqual({ migrated: 0, unresolvedMarkerCount: 1, invalidJsonCount: 0, possibleKnownIdCollisionCount: 1 });
      expect(runFn).not.toHaveBeenCalled();
    });

    it("削除済みIDの残り部分が英数字以外(漢字)であっても、文字列全体の完全一致比較により誤って断片化した置換をしない(Codexレビュー指摘、2026-09-04、round 14: 旧設計の負の先読み(?![A-Za-z0-9])は「一致直後が英数字でなければ安全」という前提だったが、ジャッジIDは文字種無制約のためこの前提自体が誤りだった。次の具体例が実際に旧設計を突破していた: 過去の訂正事例(ジャッジID:JUDGE)秘密) → 過去の訂正事例(公認ジャッジによる記録)秘密)へ誤って部分置換され、ラベルも既知ID値も消えるため3種類の検査すべてが0のまま誤った成功扱いになっていた)", () => {
      const legacyResultJson = JSON.stringify({
        sources: [{ title: "過去の訂正事例(ジャッジID:JUDGE)秘密)", url: "" }],
      });
      const allFn = vi.fn().mockReturnValue([{ id: "job-1", result_json: legacyResultJson }]);
      const runFn = vi.fn();
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id, result_json")) return { all: allFn };
        return { run: runFn };
      });

      // 削除により本来のID("JUDGE)秘密")は既知一覧から失われており、現存する
      // 短いID"JUDGE"しか分からない状況を模擬する。
      const result = migrateLegacyCorrectionTitlesInResultJson(["JUDGE"]);

      // legacyTitlesとの完全一致比較により、"JUDGE"は末尾の")秘密)"まで含めて
      // 一致できないため置換されない。ラベル「ジャッジID」がそのまま残り、
      // unresolvedMarkerCountで正しく検出される(旧設計ではここが0のまま誤って
      // 成功扱いになっていた)。既知ID値"JUDGE"自体も文字列中に実在するため
      // possibleKnownIdCollisionCountも1になる。
      expect(result).toEqual({ migrated: 0, unresolvedMarkerCount: 1, invalidJsonCount: 0, possibleKnownIdCollisionCount: 1 });
      expect(runFn).not.toHaveBeenCalled();
      expect(prepareMock.mock.calls.some(([sql]) => typeof sql === "string" && sql.startsWith("UPDATE"))).toBe(false);
    });

    it("半角開き括弧・全角閉じ括弧の組み合わせ(不一致)は過剰置換しない(Codexレビュー指摘)", () => {
      // 半角[(]と全角[）]、あるいはその逆の組み合わせで括弧が対応していない場合、
      // 閉じ括弧を探して別フィールドの境界まで飛び越え、result_jsonを破損させて
      // しまう危険がある。既知ID値ごとの完全一致パターンを使う現行設計では、
      // knownJudgeIdsを渡さない(またはこの値と一致するIDが無い)限りそもそも
      // 置換対象にならないことを確認する。
      const legacyResultJson = JSON.stringify({
        conclusion: "結論",
        explanation: "過去の訂正事例(ジャッジID:J001）は関係ない。",
        note: "この後の文字列(も破壊されてはならない)",
      });
      const allFn = vi.fn().mockReturnValue([{ id: "job-1", result_json: legacyResultJson }]);
      const runFn = vi.fn();
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id, result_json")) return { all: allFn };
        return { run: runFn };
      });

      const result = migrateLegacyCorrectionTitlesInResultJson();

      // 半角/全角が不一致のため置換対象にはならない(=0件)。置換されず
      // 「ジャッジID」がそのまま残るため、unresolvedMarkerCountとして検出・報告される(jobId自体は含めない)。
      expect(result).toEqual({ migrated: 0, unresolvedMarkerCount: 1, invalidJsonCount: 0, possibleKnownIdCollisionCount: 0 });
      expect(runFn).not.toHaveBeenCalled();
    });

    it("閉じ括弧を欠いたフィールドが、別フィールドの無関係な括弧まで飛び越えて置換しない(Codexレビュー指摘、JSON.parseベースの設計で構造的に防止)", () => {
      // 正規表現を生のJSON文字列全体へ適用する設計だと、あるフィールド内で
      // 開き括弧の後に対応する閉じ括弧が無い場合、次のフィールドにある無関係な
      // 閉じ括弧まで飛び越えて一致し、result_jsonを破損させる危険があった。
      // JSON.parseで文字列値ごとに分解してから置換する設計(migrateLegacyCorrectionTitlesInValue)
      // により、置換範囲が各フィールドの内部に構造的に限定されることを確認する。
      const legacyResultJson = JSON.stringify({
        explanation: "過去の訂正事例(ジャッジID:J001",
        note: "後続フィールドの括弧)",
      });
      const allFn = vi.fn().mockReturnValue([{ id: "job-1", result_json: legacyResultJson }]);
      const runFn = vi.fn();
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id, result_json")) return { all: allFn };
        return { run: runFn };
      });

      const result = migrateLegacyCorrectionTitlesInResultJson();

      // explanationフィールド単体には閉じ括弧が無いため置換対象にならない(=0件)。
      // 「ジャッジID」はそのまま残るため、unresolvedMarkerCountとして検出・報告される(jobId自体は含めない)。
      expect(result).toEqual({ migrated: 0, unresolvedMarkerCount: 1, invalidJsonCount: 0, possibleKnownIdCollisionCount: 0 });
      expect(runFn).not.toHaveBeenCalled();
    });

    it("移行後もresult_jsonが有効なJSONのまま保たれる(JSON破損防止の回帰テスト)", () => {
      const legacyResultJson = JSON.stringify({
        conclusion: "結論",
        sources: [{ title: "過去の訂正事例(ジャッジID:J001)", url: "" }],
        note: "後続フィールド(括弧を含む)も無事であること",
      });
      const allFn = vi.fn().mockReturnValue([{ id: "job-1", result_json: legacyResultJson }]);
      const runFn = vi.fn();
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id, result_json")) return { all: allFn };
        return { run: runFn };
      });

      migrateLegacyCorrectionTitlesInResultJson(["J001"]);

      const updatedJson = runFn.mock.calls[0][0] as string;
      expect(() => JSON.parse(updatedJson)).not.toThrow();
      const parsed = JSON.parse(updatedJson);
      expect(parsed.note).toBe("後続フィールド(括弧を含む)も無事であること");
    });

    it("__proto__というキーを含むJSONでも、キーと値がそのまま保持され、生成オブジェクトのプロトタイプが変化しない(Codexレビュー指摘: {}へのブラケット代入だとプロトタイプ汚染の危険がある)", () => {
      // JS object literalの`{ __proto__: ... }`はプロトタイプ設定として特別扱いされ
      // own propertyを作らないため、JSON.stringifyでは再現できない。JSON.parseは
      // 通常のCreateDataPropertyでown propertyとして生成するため、生のJSON文字列
      // として直接組み立てる。
      const title = "過去の訂正事例(ジャッジID:J001)";
      const legacyResultJson = `{"title":${JSON.stringify(title)},"__proto__":"この値がそのまま保持されるべき"}`;
      const allFn = vi.fn().mockReturnValue([{ id: "job-1", result_json: legacyResultJson }]);
      const runFn = vi.fn();
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id, result_json")) return { all: allFn };
        return { run: runFn };
      });

      migrateLegacyCorrectionTitlesInResultJson(["J001"]);

      const updatedJson = runFn.mock.calls[0][0] as string;
      const parsed = JSON.parse(updatedJson);
      expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
      expect(Object.prototype.hasOwnProperty.call(parsed, "__proto__")).toBe(true);
      expect(JSON.stringify(parsed)).toContain("この値がそのまま保持されるべき");
    });

    it("JSONのキー自体に「ジャッジID」ラベルや既知ID値が含まれる場合も検出する(Codexレビュー指摘: containsJudgeIdMarker/containsAnyKnownJudgeIdが値だけを見てキーを見ていなかった。現状のRulingResultは固定スキーマのため実際には起こらないが、多層防御として追加)", () => {
      const legacyResultJson = JSON.stringify({ "Judge ID: J001": "この値には既知パターンは含まれない" });
      const allFn = vi.fn().mockReturnValue([{ id: "job-1", result_json: legacyResultJson }]);
      const runFn = vi.fn();
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id, result_json")) return { all: allFn };
        return { run: runFn };
      });

      const result = migrateLegacyCorrectionTitlesInResultJson();

      // キーは自動置換の対象にしない(キー変更は衝突を招くため)が、
      // ラベルが検出されるためunresolvedMarkerCountとして報告され、
      // 呼び出し元は成功扱いにできない。
      expect(result.migrated).toBe(0);
      expect(result.unresolvedMarkerCount).toBe(1);
    });

    it("result_jsonがJSONとして解析できない場合は安全側に倒してスキップする(壊れたJSONで上書きしない)", () => {
      const allFn = vi.fn().mockReturnValue([{ id: "job-1", result_json: "not a valid json{ジャッジID:J001)" }]);
      const runFn = vi.fn();
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id, result_json")) return { all: allFn };
        return { run: runFn };
      });

      const result = migrateLegacyCorrectionTitlesInResultJson();

      // 解析できないJSONは上書きしないが、内容不明として未解決扱いにし(表記揺れ
      // の残存とは別カウント)、呼び出し元へ報告する。
      expect(result).toEqual({ migrated: 0, unresolvedMarkerCount: 0, invalidJsonCount: 1, possibleKnownIdCollisionCount: 0 });
      expect(runFn).not.toHaveBeenCalled();
    });

    it("Unicodeエスケープで保存されたジャッジIDもJSON.parse後に検出する(SQL側のLIKEでは検出できないためCodexレビュー指摘)", () => {
      // SQLのLIKE 'ジャッジID%'は生のバイト列に対する一致判定のため、result_json内で
      // ジャッジIDのようにUnicodeエスケープされて保存されている場合、
      // JSON.parseするまで「ジャッジID」という文字列には見えず検出漏れが生じる。
      // SELECT側の絞り込みを廃止しresult_json IS NOT NULLの全件を対象にすることで、
      // JSON.parse後の判定(containsJudgeIdMarker)がこのケースも正しく検出できることを確認する。
      const legacyResultJson = '{"explanation":"\\u30b8\\u30e3\\u30c3\\u30b8ID:J001"}';
      // 上記は実際には`過去の訂正事例(...)`の形式ではないため、既知の正規表現では
      // 置換できない(=未知の表記揺れとして検出されるべきケース)。
      const allFn = vi.fn().mockReturnValue([{ id: "job-1", result_json: legacyResultJson }]);
      const runFn = vi.fn();
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id, result_json")) return { all: allFn };
        return { run: runFn };
      });

      const result = migrateLegacyCorrectionTitlesInResultJson();

      expect(result).toEqual({ migrated: 0, unresolvedMarkerCount: 1, invalidJsonCount: 0, possibleKnownIdCollisionCount: 0 });
      // この修正の要点はSELECT側のLIKE絞り込みを廃止したこと自体なので、実装が
      // 将来LIKE絞り込みへ戻る回帰を検出できるよう、実際に渡されたSQL文自体を
      // 検証する(Codexレビュー指摘、2026-09-04: モックがSQL内容を見ずに応答すると、
      // 実SQLiteでUnicodeエスケープ行がLIKEに一致せず検出漏れる回帰を防げない)。
      const selectSql = prepareMock.mock.calls
        .map(([sql]) => sql as string)
        .find((sql) => sql.includes("SELECT id, result_json"));
      expect(selectSql).toContain("result_json IS NOT NULL");
      expect(selectSql).not.toMatch(/LIKE/i);
    });

    it("ラベルが「ジャッジID」以外に完全に言い換えられていても、既知のジャッジID値そのものが残っていれば参考情報として検出する(Codexレビュー指摘: ラベルの表記揺れをいくら追っても切りがないため、値そのものも監査する)", () => {
      const legacyResultJson = JSON.stringify({
        explanation: "この裁定は公認ジャッジ番号PLACEHOLDER-ID-VALUEによる過去の判断を参考にしています。",
      });
      const allFn = vi.fn().mockReturnValue([{ id: "job-1", result_json: legacyResultJson }]);
      const runFn = vi.fn();
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id, result_json")) return { all: allFn };
        return { run: runFn };
      });

      const result = migrateLegacyCorrectionTitlesInResultJson(["PLACEHOLDER-ID-VALUE"]);

      // 「ジャッジID」というラベル自体は含まれないため既知の正規表現では拾えないが、
      // 実在するID値そのものが一致する。ただしこの値一致だけの検出は誤検知が多い
      // ため(Codexレビュー指摘、下記の負例テスト参照)、unresolvedMarkerCountでは
      // なくpossibleKnownIdCollisionCountとして区別して報告する(誤検知の可能性を
      // 理由に無条件で成功扱いにはせず、CLIは非ゼロ終了・要手動確認とする)。
      // 自動置換もしない。
      expect(result).toEqual({ migrated: 0, unresolvedMarkerCount: 0, invalidJsonCount: 0, possibleKnownIdCollisionCount: 1 });
      expect(runFn).not.toHaveBeenCalled();
    });

    it("既知のジャッジID値に一致しなければ、無関係な文字列だけでは誤検知しない", () => {
      const legacyResultJson = JSON.stringify({ explanation: "無関係な結論です。" });
      const allFn = vi.fn().mockReturnValue([{ id: "job-1", result_json: legacyResultJson }]);
      const runFn = vi.fn();
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id, result_json")) return { all: allFn };
        return { run: runFn };
      });

      const result = migrateLegacyCorrectionTitlesInResultJson(["PLACEHOLDER-ID-VALUE"]);

      expect(result).toEqual({ migrated: 0, unresolvedMarkerCount: 0, invalidJsonCount: 0, possibleKnownIdCollisionCount: 0 });
    });

    it("短い数値の既知ID(実際のインシデントの実績どおり4桁数値)がURL・型番等に偶然含まれても、unresolvedMarkerCount(終了コードを左右する件数)は上げない(Codexレビュー指摘: 短い数値IDの部分一致による恒久的な失敗扱いを防ぐ)", () => {
      const legacyResultJson = JSON.stringify({
        explanation: "総合ルール101.4aを参照。詳細はhttps://example.com/cards/1074を参照。",
      });
      const allFn = vi.fn().mockReturnValue([{ id: "job-1", result_json: legacyResultJson }]);
      const runFn = vi.fn();
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id, result_json")) return { all: allFn };
        return { run: runFn };
      });

      // "1074"を既知IDとして与える。カード紹介ページのURL末尾「1074」に偶然
      // 含まれるが、ジャッジIDとは無関係なコンテキストである。
      const result = migrateLegacyCorrectionTitlesInResultJson(["1074"]);

      expect(result.unresolvedMarkerCount).toBe(0);
      expect(result.possibleKnownIdCollisionCount).toBe(1);
      expect(runFn).not.toHaveBeenCalled();
    });

    it("既知ID値の比較もNFKC正規化する(全角数字へ変形されたIDも検出できるようにする、Codexレビュー指摘)", () => {
      const legacyResultJson = JSON.stringify({ explanation: "参考: ＰＬＡＣＥＨＯＬＤＥＲ" });
      const allFn = vi.fn().mockReturnValue([{ id: "job-1", result_json: legacyResultJson }]);
      const runFn = vi.fn();
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id, result_json")) return { all: allFn };
        return { run: runFn };
      });

      // JSON側は全角("ＰＬＡＣＥＨＯＬＤＥＲ")、既知ID側は半角("PLACEHOLDER")で
      // 一致させる。
      const result = migrateLegacyCorrectionTitlesInResultJson(["PLACEHOLDER"]);

      expect(result.possibleKnownIdCollisionCount).toBe(1);
    });

    it.each([
      ["全角英数字(NFKC正規化で半角化される)", "ジャッジＩＤ:J001"],
      ["「ジャッジ」と「ID」の間に空白がある", "ジャッジ ID:J001"],
      ["英語表記Judge ID", "Judge ID: J001"],
    ])(
      "LLMが将来言い換えうる未知の表記(%s)もunresolvedMarkerCountで検出する(完全一致だけに頼らないためCodexレビュー指摘)",
      (_label, snippet) => {
        const legacyResultJson = JSON.stringify({ explanation: `関連する${snippet}を参照。` });
        const allFn = vi.fn().mockReturnValue([{ id: "job-1", result_json: legacyResultJson }]);
        const runFn = vi.fn();
        prepareMock.mockImplementation((sql: string) => {
          if (sql.includes("SELECT id, result_json")) return { all: allFn };
          return { run: runFn };
        });

        const result = migrateLegacyCorrectionTitlesInResultJson();

        expect(result).toEqual({ migrated: 0, unresolvedMarkerCount: 1, invalidJsonCount: 0, possibleKnownIdCollisionCount: 0 });
      },
    );

    it("「ジャッジ」と無関係な「ID」が離れて登場するだけでは誤検知しない", () => {
      const legacyResultJson = JSON.stringify({
        explanation: "ジャッジの判断は正しい。別件でIDカードの提示を求められた。",
      });
      const allFn = vi.fn().mockReturnValue([{ id: "job-1", result_json: legacyResultJson }]);
      const runFn = vi.fn();
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id, result_json")) return { all: allFn };
        return { run: runFn };
      });

      const result = migrateLegacyCorrectionTitlesInResultJson();

      expect(result).toEqual({ migrated: 0, unresolvedMarkerCount: 0, invalidJsonCount: 0, possibleKnownIdCollisionCount: 0 });
    });

    it("対象ジョブが無ければUPDATEを一切呼ばない", () => {
      // SELECTがresult_json IS NOT NULLの全件を返す設計(Unicodeエスケープ等の
      // SQL側では検出できない表記揺れを取りこぼさないため、Codexレビュー指摘)に
      // なったため、0件を返せばUPDATEも呼ばれないことだけを確認する。
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id, result_json")) return { all: vi.fn().mockReturnValue([]) };
        return { run: vi.fn() };
      });

      expect(migrateLegacyCorrectionTitlesInResultJson()).toEqual({
        migrated: 0,
        unresolvedMarkerCount: 0,
        invalidJsonCount: 0,
        possibleKnownIdCollisionCount: 0,
      });
    });
  });

  describe("findUnresolvedLegacyCorrectionTitleJobIds(T008、2026-09-05)", () => {
    // migrateLegacyCorrectionTitlesInResultJsonが意図的に自動置換しない「旧titleが
    // 説明文へ埋め込まれたケース」の対象jobIdを特定する読み取り専用の診断関数。
    //
    // round18〜21では、この特定〜修復までを自動化する専用復旧スクリプト(部分置換
    // →フィールド値全体の非表示化→検証トークンによるTOCTOU対策、と設計を重ねた)を
    // 構築したが、対象は本番に実在する「たった1行の過去データ」であり、そのために
    // 積み上げた安全性のコストは見合わないとユーザー判断により撤回した。実際の
    // 修復(result_jsonの安全な固定文言への置き換え)は、この関数が返すjobIdを
    // 使って運用者がRender Web Shellから直接UPDATEする(自動更新は行わない)。

    it("「過去の訂正事例」とジャッジIDマーカーが同一文字列値内に共存する行のjobIdのみを返す", () => {
      const rows = [
        { id: "job-1", result_json: JSON.stringify({ explanation: "なお、これは過去の訂正事例（ジャッジID:J001）とは論点が異なる。" }) },
        { id: "job-2", result_json: JSON.stringify({ explanation: "無関係な結論です。" }) },
      ];
      const allFn = vi.fn().mockReturnValue(rows);
      prepareMock.mockReturnValue({ all: allFn });

      const result = findUnresolvedLegacyCorrectionTitleJobIds();

      expect(result).toEqual(["job-1"]);
    });

    it("「ジャッジID」ラベルを含むが「過去の訂正事例」を伴わない無害な文は候補にしない(Codexレビュー指摘、2026-09-05、round22: containsJudgeIdMarker単体だと誤検知し、手動UPDATEで無害な行を壊しうる)", () => {
      const allFn = vi.fn().mockReturnValue([{ id: "job-1", result_json: JSON.stringify({ explanation: "ジャッジIDは回答に含めないでください。" }) }]);
      prepareMock.mockReturnValue({ all: allFn });

      const result = findUnresolvedLegacyCorrectionTitleJobIds();

      expect(result).toEqual([]);
    });

    it("「過去の訂正事例」と「ジャッジID」が別々のフィールドに分かれて存在するだけでは候補にしない(同一文字列値内での共存を要求する)", () => {
      const allFn = vi
        .fn()
        .mockReturnValue([
          { id: "job-1", result_json: JSON.stringify({ conclusion: "過去の訂正事例を参照。", explanation: "ジャッジIDについては別途確認する。" }) },
        ]);
      prepareMock.mockReturnValue({ all: allFn });

      const result = findUnresolvedLegacyCorrectionTitleJobIds();

      expect(result).toEqual([]);
    });

    it("該当する行が無い場合は空配列を返す", () => {
      const allFn = vi.fn().mockReturnValue([{ id: "job-1", result_json: JSON.stringify({ explanation: "無関係な結論です。" }) }]);
      prepareMock.mockReturnValue({ all: allFn });

      const result = findUnresolvedLegacyCorrectionTitleJobIds();

      expect(result).toEqual([]);
    });

    it("JSONとして解析できない行は対象外としてスキップする", () => {
      const allFn = vi.fn().mockReturnValue([{ id: "job-1", result_json: "not a valid json{ジャッジID:J001)" }]);
      prepareMock.mockReturnValue({ all: allFn });

      const result = findUnresolvedLegacyCorrectionTitleJobIds();

      expect(result).toEqual([]);
    });

    it("result_jsonがnullの行は対象外としてスキップする", () => {
      const allFn = vi.fn().mockReturnValue([{ id: "job-1", result_json: null }]);
      prepareMock.mockReturnValue({ all: allFn });

      const result = findUnresolvedLegacyCorrectionTitleJobIds();

      expect(result).toEqual([]);
    });

    it("読み取り専用である(prepareへ渡されるSQLがSELECTのみで、UPDATE/DELETE/INSERTを含まない)ことを確認する(Codexレビュー指摘、2026-09-05、round22)", () => {
      const allFn = vi.fn().mockReturnValue([]);
      prepareMock.mockReturnValue({ all: allFn });

      findUnresolvedLegacyCorrectionTitleJobIds();

      for (const [sql] of prepareMock.mock.calls) {
        expect(sql as string).toMatch(/^SELECT/i);
        expect(sql as string).not.toMatch(/UPDATE|DELETE|INSERT/i);
      }
    });
  });

  describe("finalizeRulingJob(T010)", () => {
    type StubOptions = {
      // undefined(省略)= 既定値を使う。null = 行が存在しない(SELECTがundefinedを返す)。
      existing?: { device_id: string | null; usage_month_key: string | null } | null;
      changes?: number;
    };

    function stubDb({ existing, changes = 1 }: StubOptions = {}) {
      const resolvedExisting = existing === undefined ? { device_id: "device-1", usage_month_key: "2026-09" } : existing;
      const selectFn = vi.fn().mockReturnValue(resolvedExisting ?? undefined);
      const updateStatusRunFn = vi.fn().mockReturnValue({ changes });
      const updateRefundedAtRunFn = vi.fn();
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT device_id, usage_month_key")) return { get: selectFn };
        if (sql.includes("SET refunded_at")) return { run: updateRefundedAtRunFn };
        return { run: updateStatusRunFn };
      });
      return { selectFn, updateStatusRunFn, updateRefundedAtRunFn };
    }

    it("done/okは返金対象外(usage_month_keyがあってもdecrementMonthlyUsageを呼ばない)", () => {
      const { updateRefundedAtRunFn } = stubDb();

      const result = finalizeRulingJob("job-1", {
        outcome: "done",
        outcomeStatus: "ok",
        result: { conclusion: "結論", explanation: "", steps: [], confidence: "high", cards: [], sources: [] },
      });

      expect(result).toEqual({ won: true, refunded: false, deviceId: "device-1" });
      expect(decrementMonthlyUsage).not.toHaveBeenCalled();
      expect(updateRefundedAtRunFn).not.toHaveBeenCalled();
      expect(execMock.mock.calls.map((c) => c[0])).toEqual(["BEGIN", "COMMIT"]);
    });

    it("done/evidence_errorは返金対象(usage_month_key・device_idで減算し、refunded_atを更新する)", () => {
      const { updateRefundedAtRunFn } = stubDb();

      const result = finalizeRulingJob("job-1", {
        outcome: "done",
        outcomeStatus: "evidence_error",
        result: { conclusion: "結論", explanation: "", steps: [], confidence: "low", cards: [], sources: [] },
      });

      expect(result).toEqual({ won: true, refunded: true, deviceId: "device-1" });
      expect(decrementMonthlyUsage).toHaveBeenCalledWith("device-1", "2026-09");
      expect(updateRefundedAtRunFn).toHaveBeenCalledWith(expect.any(Number), "job-1");
    });

    it("failed(produceRuling自体のreject)も返金対象に含める", () => {
      stubDb();

      const result = finalizeRulingJob("job-1", { outcome: "failed", error: "network error" });

      expect(result).toEqual({ won: true, refunded: true, deviceId: "device-1" });
      expect(decrementMonthlyUsage).toHaveBeenCalledWith("device-1", "2026-09");
    });

    it("usage_month_keyがnull(購読中等、無料枠を消費していない)場合は返金しない", () => {
      stubDb({ existing: { device_id: "device-1", usage_month_key: null } });

      const result = finalizeRulingJob("job-1", { outcome: "failed", error: "network error" });

      expect(result).toEqual({ won: true, refunded: false, deviceId: "device-1" });
      expect(decrementMonthlyUsage).not.toHaveBeenCalled();
    });

    it("更新件数0件(既に他の経路で確定済み)ならwon:falseを返し、返金処理をしない", () => {
      stubDb({ changes: 0 });

      const result = finalizeRulingJob("job-1", { outcome: "failed", error: "timeout" });

      expect(result).toEqual({ won: false });
      expect(decrementMonthlyUsage).not.toHaveBeenCalled();
      expect(execMock.mock.calls.map((c) => c[0])).toEqual(["BEGIN", "COMMIT"]);
    });

    it("ジョブ行自体が存在しない(スレッド削除で物理削除済み等)場合もwon:falseを返す", () => {
      stubDb({ existing: null });

      const result = finalizeRulingJob("job-1", { outcome: "failed", error: "timeout" });

      expect(result).toEqual({ won: false });
      expect(decrementMonthlyUsage).not.toHaveBeenCalled();
    });

    it("DB例外が発生した場合はROLLBACKして例外を再送出する", () => {
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT device_id, usage_month_key")) {
          return { get: () => ({ device_id: "device-1", usage_month_key: "2026-09" }) };
        }
        return {
          run: () => {
            throw new Error("db error");
          },
        };
      });

      expect(() => finalizeRulingJob("job-1", { outcome: "failed", error: "timeout" })).toThrow("db error");
      expect(execMock.mock.calls.map((c) => c[0])).toEqual(["BEGIN", "ROLLBACK"]);
    });
  });

  describe("finalizeOrphanedRulingJob(T012 Review 8フォローアップ: TOCTOU競合対策)", () => {
    function stubOrphanDb({ changes = 1 }: { changes?: number } = {}) {
      const selectFn = vi.fn().mockReturnValue({ device_id: "device-1", usage_month_key: "2026-09" });
      const updateRunFn = vi.fn().mockReturnValue({ changes });
      const refundedAtRunFn = vi.fn();
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT device_id, usage_month_key")) return { get: selectFn };
        if (sql.includes("SET refunded_at")) return { run: refundedAtRunFn };
        return { run: updateRunFn };
      });
      return { updateRunFn, refundedAtRunFn };
    }

    it("pending: UPDATE自体にcreated_at鮮度条件を埋め込む", () => {
      const { updateRunFn } = stubOrphanDb();

      finalizeOrphanedRulingJob("job-1", { status: "pending", createdBefore: 1000 }, "timeout");

      expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("status = 'pending' AND created_at < ?"));
      expect(updateRunFn).toHaveBeenCalledWith("timeout", expect.any(Number), "job-1", 1000);
    });

    it("running: UPDATE自体にheartbeat_at鮮度条件(heartbeatあり/無しの両方)を埋め込む", () => {
      const { updateRunFn } = stubOrphanDb();

      finalizeOrphanedRulingJob(
        "job-1",
        { status: "running", heartbeatBefore: 2000, legacyCreatedBefore: 1000 },
        "timeout",
      );

      expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("heartbeat_at IS NOT NULL AND heartbeat_at < ?"));
      expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("heartbeat_at IS NULL AND created_at < ?"));
      expect(updateRunFn).toHaveBeenCalledWith("timeout", expect.any(Number), "job-1", 2000, 1000);
    });

    it("UPDATE条件を満たさない(=他プロセスがheartbeatを更新して既に生存確認済み)場合はwon:falseを返し返金しない", () => {
      // TOCTOU対策の中核: SELECT時点で候補に見えても、UPDATE時点の鮮度条件を
      // 満たさなければchanges=0になり、誤って正常ジョブを確定・返金しない。
      const { refundedAtRunFn } = stubOrphanDb({ changes: 0 });

      const result = finalizeOrphanedRulingJob(
        "job-1",
        { status: "running", heartbeatBefore: 2000, legacyCreatedBefore: 1000 },
        "timeout",
      );

      expect(result).toEqual({ won: false });
      expect(decrementMonthlyUsage).not.toHaveBeenCalled();
      expect(refundedAtRunFn).not.toHaveBeenCalled();
    });

    it("UPDATE条件を満たす場合は確定・返金する", () => {
      stubOrphanDb({ changes: 1 });

      const result = finalizeOrphanedRulingJob(
        "job-1",
        { status: "running", heartbeatBefore: 2000, legacyCreatedBefore: 1000 },
        "timeout",
      );

      expect(result).toEqual({ won: true, refunded: true, deviceId: "device-1" });
      expect(decrementMonthlyUsage).toHaveBeenCalledWith("device-1", "2026-09");
    });
  });
});
