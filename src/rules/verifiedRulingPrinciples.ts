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
  // 特定の2枚以上のカードが揃った場合にのみ発火させたい原則向け(2026-09-04追加)。
  // 内側の配列に列挙したカード名が「すべて」質問文中で解決できた場合にマッチする
  // (OR条件のtriggerKeywordsと違い、AND条件)。省略時は空配列(既存の原則は
  // triggerKeywordsのみで判定される)。単純にカード名をtriggerKeywordsへ混ぜると、
  // どちらか1枚だけ登場する無関係な質問でも発火してしまうため、明確に区別する。
  requiredCardNameGroups: z.array(z.array(z.string())).default([]),
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
 *
 * cardNames(質問文中で解決できたカード名)はrequiredCardNameGroupsの判定にのみ
 * 使う(2026-09-04追加、triggerKeywordsの緩いOR一致には混ぜない)。特定の2枚以上の
 * カードが絡む相互作用(例: あるカードの「能力を無視する」効果と、別カードの
 * 誘発型/常在型能力の相互作用)は、質問文が「無視する」等の一般的なルール語を
 * 使わずカード名だけで表現されることが多く、ruleConcepts/keywordsだけでは初回の
 * 質問(スレッドの1ターン目)で検索漏れが起きていた(フォローアップで使い方を
 * 変えて初めてヒットする、という一貫性の無い挙動の原因になっていた)。
 */
export function searchVerifiedRulingPrinciples(criteria: {
  ruleConcepts: string[];
  keywords: string[];
  cardNames: string[];
}): VerifiedRulingPrinciple[] {
  const matchTerms = new Set([...criteria.ruleConcepts, ...criteria.keywords]);
  const cardNameSet = new Set(criteria.cardNames);
  return ALL_PRINCIPLES.filter((principle) => {
    if (principle.status !== "active") return false;
    if (principle.triggerKeywords.some((k) => matchTerms.has(k))) return true;
    return principle.requiredCardNameGroups.some((group) => group.every((name) => cardNameSet.has(name)));
  });
}
