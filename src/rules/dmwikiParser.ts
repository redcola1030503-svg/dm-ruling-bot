import * as cheerio from "cheerio";

// これらの見出しに到達したら本文の収集を止める(カード一覧・攻略テクニック・
// ゲーム版固有の実装・外部リンク集など、ルール上の一般化された説明ではない
// セクションを除外するため)。「◯◯の一覧」のようにキーワード名を含む見出しは
// includesで判定する。
const STOP_HEADING_PREFIXES = [
  "テクニック",
  "その他",
  "参考",
  "デュエル・マスターズ プレイスでは",
  "デュエル・マスターズ プレイス",
];

function isStopHeading(heading: string): boolean {
  if (heading.includes("一覧")) return true;
  return STOP_HEADING_PREFIXES.some((prefix) => heading.startsWith(prefix));
}

/**
 * dmwiki.net(PukiWiki)のキーワード能力ページから、冒頭の定義・ルール説明部分
 * (カード一覧やテクニック等を除いた、一般化されたルール文)を抽出する。
 * ページ構成が想定と異なる場合(#bodyが無い等)や本文が空の場合はnullを返す。
 */
export function parseKeywordAbilityPage(html: string): string | null {
  const $ = cheerio.load(html);
  const body = $("#body");
  if (body.length === 0) return null;

  const parts: string[] = [];
  let stopped = false;

  body.children().each((_, el) => {
    if (stopped) return;
    const tagName = (el as { tagName?: string }).tagName?.toLowerCase();

    if (tagName === "h2") {
      // ページタイトル見出し自体は本文に含めない。
      return;
    }
    if (tagName === "h3" || tagName === "h4") {
      const heading = $(el).text().replace(/\s+/g, " ").trim();
      if (isStopHeading(heading)) {
        stopped = true;
      }
      return;
    }

    const text = $(el).text().replace(/[ \t]+/g, " ").trim();
    if (text) parts.push(text);
  });

  const description = parts.join("\n").trim();
  return description.length > 0 ? description : null;
}
