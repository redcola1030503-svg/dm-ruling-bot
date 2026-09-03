import * as cheerio from "cheerio";
import { deriveAlternateNames } from "./cardFaceUtils";
import type { CardFace, CardInfo, CardSearchHit } from "./types";

const CARD_DETAIL_ORIGIN = "https://dm.takaratomy.co.jp";

export function parseCardListPage(html: string): CardSearchHit[] {
  const $ = cheerio.load(html);
  const hits: CardSearchHit[] = [];
  const seen = new Set<string>();

  $("#cardlist a[href*='/card/detail/']").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const url = new URL(href, CARD_DETAIL_ORIGIN).toString();
    const id = new URL(url).searchParams.get("id");
    if (!id || seen.has(id)) return;
    seen.add(id);
    hits.push({ id, url });
  });

  return hits;
}

export function parseTotalCount(html: string): number | null {
  const $ = cheerio.load(html);
  const text = $("#total_count").first().text().trim();
  const match = text.match(/\d+/);
  return match ? Number(match[0]) : null;
}

function cellText($: cheerio.CheerioAPI, selector: string): string {
  return $(selector).first().text().trim();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function blockCellText($block: cheerio.Cheerio<any>, selector: string): string {
  return $block.find(selector).first().text().trim();
}

export function parseCardDetailPage(html: string, id: string, url: string): CardInfo | null {
  const $ = cheerio.load(html);

  // サイキック・ドラグハート・ツインパクト等、1つのカードが複数の面
  // (.cardDetailブロック)を持つ場合、面ごとに別の名前・文明・パワー等を
  // 持つ。面ごとの属性一式をfacesに保持することで、どちらの面の名前で
  // 質問されても、その面の正しい属性を裁定に使えるようにする(過去に
  // 名前(name)だけ最初の面に固定していたため、裏面の質問に表面の属性が
  // 渡ってしまう不具合があった)。
  const faces: CardFace[] = [];
  $(".cardDetail").each((_, block) => {
    const $block = $(block);
    const nameHeading = $block.find(".card-name").first().clone();
    nameHeading.find(".packname").remove();
    const faceName = nameHeading.text().trim();
    if (!faceName) return;
    faces.push({
      name: faceName,
      cardType: blockCellText($block, "td.type"),
      civilization: blockCellText($block, "td.civil"),
      rarity: blockCellText($block, "td.rarelity"),
      power: blockCellText($block, "td.power"),
      cost: blockCellText($block, "td.cost"),
      mana: blockCellText($block, "td.mana"),
      race: blockCellText($block, "td.race"),
    });
  });

  const primaryFace = faces[0];
  if (!primaryFace) {
    return null;
  }
  const alternateNames = deriveAlternateNames(faces);

  // ツインパクト等、1つのカードに複数の面(.cardDetailブロック)を持つ場合、
  // 能力テキストは全面ぶん連結して取り漏らしを防ぐ。
  const cardTextParts: string[] = [];
  $(".cardDetail td.skills").each((_, el) => {
    const text = $(el).text().trim();
    if (text) cardTextParts.push(text);
  });

  const qaListUrl = $("#qa_url").attr("value") ?? null;

  return {
    id,
    url,
    name: primaryFace.name,
    alternateNames,
    cardType: cellText($, ".cardDetail td.type"),
    civilization: cellText($, ".cardDetail td.civil"),
    rarity: cellText($, ".cardDetail td.rarelity"),
    power: cellText($, ".cardDetail td.power"),
    cost: cellText($, ".cardDetail td.cost"),
    mana: cellText($, ".cardDetail td.mana"),
    race: cellText($, ".cardDetail td.race"),
    cardText: cardTextParts.join("\n---\n"),
    flavorText: cellText($, ".cardDetail td.flavor"),
    illustrator: cellText($, ".cardDetail td.illusttxt"),
    qaListUrl,
    faces,
  };
}
