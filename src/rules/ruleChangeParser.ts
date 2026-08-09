import * as cheerio from "cheerio";
import type { RuleChangeListItem } from "./types";

const ORIGIN = "https://dm.takaratomy.co.jp";

export function parseRuleChangeListPage(html: string): RuleChangeListItem[] {
  const $ = cheerio.load(html);
  const items: RuleChangeListItem[] = [];

  $("ul.newsList03 > li").each((_, el) => {
    const anchor = $(el).find("p.tit01 a").first();
    const href = anchor.attr("href");
    if (!href) return;

    const url = new URL(href, ORIGIN).toString();
    const match = url.match(/\/rule\/rulechange\/(\d+)\//);
    const id = match?.[1];
    if (!id) return;

    items.push({
      id,
      url,
      title: anchor.text().trim(),
      date: $(el).find("p.day01").first().text().trim(),
    });
  });

  return items;
}

export function hasNextPage(html: string): boolean {
  const $ = cheerio.load(html);
  return $(".wp-pagenavi a.nextpostslink").length > 0;
}

export function parseRuleChangeDetailPage(
  html: string,
  id: string,
  url: string,
): { id: string; url: string; title: string; date: string; body: string } | null {
  const $ = cheerio.load(html);
  const title = $("h1.h1_basic01 span").first().text().trim();
  const bodyContainer = $("section.sectionFormat01 .sectionIn01").first();
  const body = bodyContainer.text().trim().replace(/\n{3,}/g, "\n\n");

  if (!title || !body) return null;

  const dateMatch = body.match(/掲載日[:：]\s*([^\n]+)/);
  const date = dateMatch?.[1]?.trim() ?? "";

  return { id, url, title, date, body };
}
