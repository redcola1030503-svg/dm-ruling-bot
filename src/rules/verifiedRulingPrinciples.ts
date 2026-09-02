import { z } from "zod";
import principlesData from "./data/verified-ruling-principles.json";

const verifiedRulingPrincipleSchema = z.object({
  id: z.string(),
  title: z.string(),
  ruling: z.string(),
  appliesWhen: z.array(z.string()),
  doesNotApplyWhen: z.array(z.string()),
  officialRuleIds: z.array(z.string()),
  officialQaUrls: z.array(z.string()),
  triggerKeywords: z.array(z.string()),
  verification: z.enum(["official_rule", "accredited_judge"]),
  verifiedAt: z.string(),
  status: z.enum(["active", "deprecated"]),
});

export type VerifiedRulingPrinciple = z.infer<typeof verifiedRulingPrincipleSchema>;

// data/verified-ruling-principles.jsonはsrc配下(ビルド対象)に置く。/app/dataは
// Renderの永続ディスクマウント先であり(render.yaml参照)、実行時に生成される
// SQLiteキャッシュ等とは異なりGit管理された静的な正本データはそこに置けない
// (コンテナ起動時に永続ディスクの内容でマウント先が置き換わり、イメージに
// 同梱したファイルが見えなくなるため)。resolveJsonModuleでのimportにより
// ビルド成果物(dist/rules/data/)に自動的に複製される。
const ALL_PRINCIPLES: VerifiedRulingPrinciple[] = z.array(verifiedRulingPrincipleSchema).parse(principlesData);

/**
 * ルール概念・キーワードの明示的マッピングで関連する原則を検索する(D-006)。
 * Embedding検索は使わない(提案書のRetrieval節: 検索漏れが元の問題だったため
 * Embeddingだけに依存しない方針)。最終的な適用可否(appliesWhen/doesNotApplyWhen)
 * の判断はLLM側の指示(generateRuling.tsの該当ルール)に委ねる。
 */
export function searchVerifiedRulingPrinciples(criteria: {
  ruleConcepts: string[];
  keywords: string[];
}): VerifiedRulingPrinciple[] {
  const matchTerms = new Set([...criteria.ruleConcepts, ...criteria.keywords]);
  return ALL_PRINCIPLES.filter(
    (principle) => principle.status === "active" && principle.triggerKeywords.some((k) => matchTerms.has(k)),
  );
}
