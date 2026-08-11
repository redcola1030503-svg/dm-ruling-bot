export function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i++) dp[i]![0] = i;
  for (let j = 0; j < cols; j++) dp[0]![j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }

  return dp[rows - 1]![cols - 1]!;
}

export function similarityScore(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(a, b);
  return 1 - distance / maxLen;
}

function bigrams(text: string): Set<string> {
  const grams = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) {
    grams.add(text.slice(i, i + 2));
  }
  return grams;
}

export type BigramOverlapResult = {
  ratio: number; // queryの2-gramのうちtextに含まれる割合(0〜1)
  commonCount: number; // 実際に一致した2-gramの個数
};

/**
 * queryの2-gramのうち、どれだけがtextに含まれるかを、割合と一致個数の両方で返す。
 * LLMが生成する自然な言い回し(例:「ターンプレイヤーの優先権」)と、
 * 条文の硬い表現(例:「ターン・プレイヤーのものから順番に処理」)のように
 * 字面は完全一致しないが意味的に近い場合を緩く拾うために使う。
 * queryが短いと2-gramが1〜2個しかなく、1個の偶然一致だけで割合が高くなって
 * しまう(例:3文字語は2-gramが2個しかなく、1個一致で0.5になる)ため、
 * 呼び出し側では割合に加えて一致個数の下限も併用すること。
 */
export function bigramOverlap(query: string, text: string): BigramOverlapResult {
  const queryGrams = bigrams(query);
  if (queryGrams.size === 0) return { ratio: 0, commonCount: 0 };
  const textGrams = bigrams(text);
  let common = 0;
  for (const gram of queryGrams) {
    if (textGrams.has(gram)) common++;
  }
  return { ratio: common / queryGrams.size, commonCount: common };
}
