import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeQuestion } from "../../src/ruling/analyzeQuestion";
import { searchAndRankGeneralRules } from "../../src/rules/generalRuleRanking";
import { semanticSearchGeneralRules } from "../../src/search/semanticSearch";
import { hybridSearchGeneralRules } from "../../src/search/hybridSearch";

type EvalCase = {
  question: string;
  expectedRuleIds: string[];
};

type ModeResult = {
  mode: string;
  recallAt: Record<number, number>;
  mrr: number;
};

const CUTOFFS = [1, 3, 5, 10];
const CANDIDATE_COUNT = 10;
const MODES = ["keyword", "embedding", "hybrid"] as const;
type Mode = (typeof MODES)[number];

function reciprocalRank(rankedIds: string[], expected: string[]): number {
  for (let i = 0; i < rankedIds.length; i++) {
    if (expected.includes(rankedIds[i]!)) return 1 / (i + 1);
  }
  return 0;
}

function hitsAtK(rankedIds: string[], expected: string[], k: number): boolean {
  return expected.some((id) => rankedIds.slice(0, k).includes(id));
}

type Criteria = { cardNames: string[]; ruleConcepts: string[]; keywords: string[] };

async function rankedIdsForMode(
  mode: Mode,
  question: string,
  criteria: Criteria,
): Promise<string[]> {
  if (mode === "keyword") {
    const results = await searchAndRankGeneralRules(criteria, { topN: CANDIDATE_COUNT });
    return results.map((r) => r.ruleNumber);
  }
  if (mode === "embedding") {
    const results = await semanticSearchGeneralRules(question, CANDIDATE_COUNT);
    return results.map((r) => r.ruleNumber);
  }
  const results = await hybridSearchGeneralRules(question, criteria, {
    finalResultCount: CANDIDATE_COUNT,
  });
  return results.map((r) => r.ruleNumber);
}

async function evaluateAllModes(cases: EvalCase[]): Promise<ModeResult[]> {
  const recallHitsByMode = new Map<Mode, Record<number, number>>();
  const mrrSumByMode = new Map<Mode, number>();
  for (const mode of MODES) {
    recallHitsByMode.set(mode, Object.fromEntries(CUTOFFS.map((k) => [k, 0])));
    mrrSumByMode.set(mode, 0);
  }

  for (const testCase of cases) {
    // analyzeQuestion(LLM呼び出し)はモード間で共通のため、質問ごとに1回だけ実行する。
    const parsed = await analyzeQuestion(testCase.question);
    const criteria: Criteria = {
      cardNames: parsed.cardNames,
      ruleConcepts: parsed.ruleConcepts,
      keywords: parsed.keywords,
    };

    for (const mode of MODES) {
      const rankedIds = await rankedIdsForMode(mode, testCase.question, criteria);
      const recallHits = recallHitsByMode.get(mode)!;
      for (const k of CUTOFFS) {
        if (hitsAtK(rankedIds, testCase.expectedRuleIds, k)) recallHits[k]! += 1;
      }
      mrrSumByMode.set(mode, mrrSumByMode.get(mode)! + reciprocalRank(rankedIds, testCase.expectedRuleIds));
    }
  }

  return MODES.map((mode) => {
    const recallHits = recallHitsByMode.get(mode)!;
    const recallAt: Record<number, number> = {};
    for (const k of CUTOFFS) recallAt[k] = recallHits[k]! / cases.length;
    return { mode, recallAt, mrr: mrrSumByMode.get(mode)! / cases.length };
  });
}

function printReport(results: ModeResult[]): void {
  const header = ["Mode", ...CUTOFFS.map((k) => `R@${k}`), "MRR"];
  console.log(header.map((h) => h.padEnd(10)).join(""));
  for (const result of results) {
    const row = [
      result.mode,
      ...CUTOFFS.map((k) => `${(result.recallAt[k]! * 100).toFixed(1)}%`),
      result.mrr.toFixed(3),
    ];
    console.log(row.map((cell) => String(cell).padEnd(10)).join(""));
  }
}

async function main(): Promise<void> {
  const casesPath = join(__dirname, "cases.json");
  const cases: EvalCase[] = JSON.parse(readFileSync(casesPath, "utf-8"));

  console.log(`Total: ${cases.length}\n`);

  const results = await evaluateAllModes(cases);

  printReport(results);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
