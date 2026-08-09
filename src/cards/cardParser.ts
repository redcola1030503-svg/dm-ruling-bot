import * as cheerio from "cheerio";
import type { CardInfo, CardSearchHit } from "./types";

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

export function parseCardDetailPage(html: string, id: string, url: string): CardInfo | null {
  const $ = cheerio.load(html);
  const nameHeading = $(".cardDetail .card-name").first().clone();
  nameHeading.find(".packname").remove();
  const name = nameHeading.text().trim();

  if (!name) {
    return null;
  }

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
    name,
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
  };
}
