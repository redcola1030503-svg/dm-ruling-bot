import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAllCorrections } from "../corrections/repository";

/**
 * judge_correction(訂正)のcorrectRuling本文に公式Q&AのURLが含まれている場合、
 * それを根拠QAとみなしてtests/retrieval/qa_cases.jsonへ自動追加する。
 * URLが含まれない訂正(一般原則のみの説明等)は対象外とし、手動での追加に委ねる。
 */
const QA_URL_PATTERN = /https:\/\/dm\.takaratomy\.co\.jp\/rule\/qa\/(\d+)\//g;

type EvalCase = {
  question: string;
  expectedQaIds: string[];
};

function extractQaIds(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(QA_URL_PATTERN)) {
    ids.add(match[1]!);
  }
  return Array.from(ids);
}

function main(): void {
  const casesPath = join(__dirname, "..", "..", "tests", "retrieval", "qa_cases.json");
  const existingCases: EvalCase[] = JSON.parse(readFileSync(casesPath, "utf-8"));
  const existingQuestions = new Set(existingCases.map((c) => c.question));

  const corrections = getAllCorrections();
  let added = 0;
  let skippedNoUrl = 0;
  let skippedDuplicate = 0;

  for (const correction of corrections) {
    const qaIds = extractQaIds(correction.correctRuling);
    if (qaIds.length === 0) {
      skippedNoUrl += 1;
      continue;
    }
    if (existingQuestions.has(correction.originalQuestion)) {
      skippedDuplicate += 1;
      continue;
    }
    existingCases.push({ question: correction.originalQuestion, expectedQaIds: qaIds });
    existingQuestions.add(correction.originalQuestion);
    added += 1;
  }

  writeFileSync(casesPath, `${JSON.stringify(existingCases, null, 2)}\n`, "utf-8");

  console.log(`訂正総数: ${corrections.length}`);
  console.log(`追加: ${added}`);
  console.log(`スキップ(URLなし): ${skippedNoUrl}`);
  console.log(`スキップ(既存重複): ${skippedDuplicate}`);
  console.log(`qa_cases.json総件数: ${existingCases.length}`);
}

main();
