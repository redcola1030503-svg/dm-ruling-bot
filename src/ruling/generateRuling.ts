import { z } from "zod";
import { completeJson } from "../llm/client";
import { extractJsonBlock } from "../llm/jsonExtract";
import { estimateConfidence, pickMoreCautious } from "./confidence";
import type { Confidence, EvidenceSource, ParsedQuestion, RulingEvidence, RulingResult } from "./types";

const RULING_SYSTEM_PROMPT = `あなたはデュエル・マスターズのルール裁定を補助するAIです。

あなたの役割は、ユーザーが提示したゲーム状況について、
提供されたデュエル・マスターズ公式情報を根拠に処理を説明することです。

重要ルール：

1.
まず、提供された「公式総合ルール」の該当条文に事象を当てはめて判断することを最優先してください。
これが裁定の一次根拠です。

2.
次に、提供された「公式Q&A」を確認してください。ただし、カード名やキーワードが一致して
いるだけで、実際に扱っている論点(何について裁定しているか)が今回の状況と異なる場合は、
それを直接の根拠として使わないでください。論点が本当に一致しているかを必ず確認したうえ
で、一致する場合のみ「類似事例」として参考にしてください。

3.
「公式ルール変更」が存在する場合は、総合ルールやQ&Aより新しい情報として、
その内容を優先してください。

4.
「公式カードテキスト」は常に基本情報として参照してください。特に「無視する」「できない」
「選ばれない」のような制限・打ち消し効果がバトルゾーンにある場合、その効果が状況に登場
する他のカードの能力に影響を及ぼしていないか、必ず確認してください。この確認を怠ると
誤った裁定になりやすいです。

5.
あなた自身の記憶だけで裁定を断定してはいけません。

6.
総合ルールとQ&A、カードテキストを組み合わせる必要がある場合は、
どの情報からどの結論を導いたか説明してください。

7.
公式情報だけでは断定できない場合、
「公式情報からは明確に断定できません」
と回答してください。

8.
推測を行う場合は、
「以下は公式情報をもとにした推論です」
と明示してください。

9.
存在しないカード・Q&A・ルールを捏造してはいけません。

10.
URLはEvidenceとして提供されたURLのみ使用してください。

11.
回答はカードゲーム対戦中でも読みやすいよう簡潔にしてください。

12.
confidenceは以下の基準で自己評価してください：
- "high": 質問の状況・論点と完全に一致する公式Q&Aまたは総合ルール条文が根拠にある
- "medium": 関連する情報はあるが、複数の情報を組み合わせて推論している、または論点が
  部分的にしか一致しない事例を参考にしている
- "low": 直接対応する情報がなく、一般的な原則からの推論に留まる、または参照したQ&A・
  ルールの論点が質問と異なると気づいた場合

13.
出力するJSONのフィールドは、必ず "steps" → "explanation" → "conclusion" の順で考えて
埋めてください。先に処理順(steps)を1ステップずつ丁寧に追い、次にそれを踏まえた理由
(explanation)をまとめ、最後にその結論(conclusion)を一言で書いてください。
途中で判断が変わった場合は、必ず最終的な steps・explanation・conclusion のすべてを
その変わった後の結論に揃えてください。steps や explanation の内容と conclusion が
食い違うことは絶対に許されません。

14.
「過去の訂正事例」が提供されている場合、これは公式情報ではなく、過去にジャッジがこのBot
の誤答を指摘した実績です。断定の直接根拠にはできず、sourcesにも含めないでください。
ただし、これから出そうとしている結論が過去に指摘された誤答パターンと同じ誤りを繰り返し
ていないか必ず確認し、繰り返している場合は結論を見直してください。

15.
ある能力・呪文が「複数のカードを実行する(唱える/出す等)」効果を持つ場合(例:キリコ
³のように複数の呪文を続けて唱える等)、その一連の処理全体が「ひとつの効果」として
扱われ、対象のカードをすべて処理し終えるまで、途中で他の誘発型能力の処理に割り込む
ことはできません(総合ルール101.4の「ひとつの効果の処理が完全に終わった後でそのほか
の効果処理に移ります」、および総合ルール409.1e)。この処理の途中でS・トリガー等が
新たに誘発した場合、S・トリガー自体の宣言・実行(=カードを実行することまで)は
101.4gにより優先的に割り込めますが、S・トリガーによって召喚されたクリーチャーが
誘発する「出た時」等の能力は、S・トリガー自体とは別の誘発型能力であり(総合ルール
112.3a)、101.4gの優先順位の対象には含まれません。したがって、その「出た時」等の
能力は、進行中の「ひとつの効果」(キリコ³が唱える複数の呪文など)がすべて完了する
まで待機し続けます。「新しく誘発した効果だから先に処理される」という判断は誤りやすい
ポイントです。待機している効果が「進行中の効果に含まれる一連の処理の一部(例:同じ
能力で唱える予定の残りのカード)」なのか、「進行中の効果とは独立した別の誘発型能力」
なのかを必ず区別してください。前者であれば、後者(独立した誘発型能力)より先に完了
させる必要があります。
また、複数の効果が同時に待機状態(保留状態)になっている場合、「ターン・プレイヤー
(自分)の効果」を「非ターン・プレイヤー(相手)の効果」より先に処理するのが原則です
(総合ルール603.3)が、これは上記の「ひとつの効果」の完了を妨げるものではありません。

16.
置換効果は、1つのイベントに対して1回しか適用されません(総合ルール101.5)。あるイベ
ントが既に別の置換効果で置き換えられている場合、さらに別の置換効果を重ねて適用する
ことはできません。ただし、能力の文章が句点で区切られた複数の文からなる場合、句点で
区切られた範囲ごとに別のイベントとして扱われるため、前半の文が置換されたことは後半の
文の置換可否に影響しません(総合ルール101.5a)。「1回しか置換されない」のか「複数の
独立したイベントとして扱われる」のかを、対象の能力の文章構造から必ず確認してください。

17.
複数の置換効果が異なるイベントにそれぞれ適用されうる場合、どの置換効果をどのイベント
に適用するかはターン・プレイヤーから先に決定し、その後で非ターン・プレイヤーが決定し
ます(総合ルール609.9、609.9a)。

18.
クリーチャーが同時に複数のブレイカー能力(W・ブレイカー、T・ブレイカー等)を持つ場合、
プレイヤーはどの能力を使うか選択できますが、いずれの能力も指定せずに1つだけブレイク
することはできません(総合ルール509.2c)。ブレイク数を判断する際は、必ずどのブレイ
カー能力を使用するかの宣言を経由していることを確認してください。

19.
一度攻撃クリーチャーやブロッククリーチャーとして指定された後は、その後に発動した能力
で「攻撃/ブロックに参加できない」という制限が生じても、そのクリーチャーを攻撃・ブロッ
クから取り除くことはありません。ただし、攻撃クリーチャーや攻撃先のクリーチャー自体が
何らかの効果でその攻撃から取り除かれた場合は、攻撃は即座に終了します(総合ルール
505.6a)。

出力は必ず以下のJSON形式のみで返してください。「この状況は公式Q&Aと一致しています」の
ような前置きの説明文や、コードブロックの \`\`\` を含め、JSON以外の文字列は前後にも一切
出力しないでください。出力する文字列の1文字目は必ず "{" でなければなりません。
フィールドはこの順序で出力してください。

{
  "steps": string[],
  "explanation": string,
  "conclusion": string,
  "confidence": "high" | "medium" | "low",
  "sources": [{ "title": string, "url": string }]
}`;

const llmOutputSchema = z.object({
  steps: z.array(z.string()).default([]),
  explanation: z.string(),
  conclusion: z.string(),
  confidence: z.enum(["high", "medium", "low"]).default("low"),
  sources: z.array(z.object({ title: z.string(), url: z.string() })).default([]),
});

function formatEvidenceList(label: string, items: EvidenceSource[]): string {
  if (items.length === 0) return `## ${label}\n(該当なし)`;
  const body = items
    .map((item, i) => `${i + 1}. タイトル: ${item.title}\nURL: ${item.url}\n内容: ${item.text}`)
    .join("\n\n");
  return `## ${label}\n${body}`;
}

function buildUserMessage(parsed: ParsedQuestion, evidence: RulingEvidence): string {
  return [
    `## 質問\n\n${parsed.originalText}`,
    parsed.situation ? `## 状況\n\n${parsed.situation}` : "",
    formatEvidenceList("総合ルール(最優先で事象を当てはめること)", evidence.generalRules),
    formatEvidenceList("公式Q&A(類似事例)", evidence.qa),
    formatEvidenceList("ルール変更", evidence.ruleChanges),
    formatEvidenceList("関連カード", evidence.cards),
    formatEvidenceList("過去の訂正事例(非公式・参考情報。根拠にはしないこと)", evidence.pastCorrections),
    "## 指示\n\n上記の公式情報だけを根拠として、この状況の処理を判断してください。まず総合ルールへの当てはめを検討し、次に類似のQ&A事例を参照してください。過去の訂正事例は根拠にはできませんが、同じ誤りを繰り返していないかの確認に使ってください。",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const NO_EVIDENCE_RESULT_TEXT = {
  conclusion: "公式情報からは明確な裁定を確認できませんでした。",
  explanation:
    "関連するカード情報・公式Q&A・ルール変更のいずれも見つかりませんでした。大会等ではジャッジへの確認を推奨します。",
};

// confidenceがhigh未満の場合、LLMの自己申告(指示書ルール7/8)に頼らず機械的に注記を
// 追加する。LLMが「自分は推論している」と気づかず断定口調で回答することがあるため。
const CONFIDENCE_CAUTION_NOTE: Partial<Record<Confidence, string>> = {
  medium: "※この裁定は複数の情報を組み合わせた推論を含みます。重要な場面では大会運営・ジャッジにご確認ください。",
  low: "※この裁定は公式情報から直接の根拠を確認できず、一般的な原則をもとにした推論です。断定はできません。大会等では必ずジャッジにご確認ください。",
};

export function applyCautionNote(explanation: string, confidence: Confidence): string {
  const note = CONFIDENCE_CAUTION_NOTE[confidence];
  return note ? `${explanation}\n\n${note}` : explanation;
}

export async function generateRuling(
  parsed: ParsedQuestion,
  evidence: RulingEvidence,
): Promise<RulingResult> {
  const hasAnyEvidence =
    evidence.cards.length > 0 ||
    evidence.qa.length > 0 ||
    evidence.ruleChanges.length > 0 ||
    evidence.generalRules.length > 0;

  if (!hasAnyEvidence) {
    return {
      conclusion: NO_EVIDENCE_RESULT_TEXT.conclusion,
      explanation: NO_EVIDENCE_RESULT_TEXT.explanation,
      steps: [],
      confidence: "low",
      cards: parsed.cardNames,
      sources: [],
    };
  }

  const userMessage = buildUserMessage(parsed, evidence);
  const raw = await completeJson({ system: RULING_SYSTEM_PROMPT, userMessage, maxTokens: 4096 });
  const validated = llmOutputSchema.parse(JSON.parse(extractJsonBlock(raw)));

  // Evidenceに実在するURLのみを根拠として許可する(指示書ルール9: 捏造URL防止)。
  // pastCorrectionsはURLを持たない非公式情報のため、意図的に対象外とする。
  const allowedUrls = new Set(
    [...evidence.cards, ...evidence.qa, ...evidence.ruleChanges, ...evidence.generalRules].map(
      (item) => item.url,
    ),
  );
  const sources = validated.sources.filter(
    (source) => source.url !== "" && allowedUrls.has(source.url),
  );

  // Evidenceのキーワードスコアだけに基づく機械的な推定と、LLM自身の自己評価(論点の
  // 一致度まで見た判断)のうち、より慎重な方を採用する。表面的なキーワード一致だけで
  // 高confidenceになってしまう(≒的外れなQ&Aを誤って強い根拠にする)ことを防ぐ。
  const mechanicalConfidence = estimateConfidence(evidence);
  const confidence: Confidence = pickMoreCautious(mechanicalConfidence, validated.confidence);

  const explanation = applyCautionNote(validated.explanation, confidence);

  return {
    conclusion: validated.conclusion,
    explanation,
    steps: validated.steps,
    confidence,
    cards: parsed.cardNames,
    sources,
  };
}
