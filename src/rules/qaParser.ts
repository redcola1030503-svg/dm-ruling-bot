import * as cheerio from "cheerio";
import type { QaDetail, QaListItem } from "./types";

const ORIGIN = "https://dm.takaratomy.co.jp";

export function parseQaListPage(html: string): QaListItem[] {
  const $ = cheerio.load(html);
  const items: QaListItem[] = [];

  $("#qa_result_area ul.newsList03 > li").each((_, el) => {
    const anchor = $(el).find("p.tit01 a").first();
    const href = anchor.attr("href");
    if (!href) return;

    const url = new URL(href, ORIGIN).toString();
    const match = url.match(/\/rule\/qa\/(\d+)\//);
    const id = match?.[1];
    if (!id) return;

    items.push({
      id,
      url,
      titleText: anchor.text().trim(),
      date: $(el).find("p.day01").first().text().trim(),
    });
  });

  return items;
}

/**
 * カード詳細ページの「このカードのよくある質問」リンク先(カード専用Q&A一覧)をパースする。
 * 公式サイトが手動でカードとQ&Aを紐付けているため、キーワード検索より精度が高い。
 */
export function parseCardQaListPage(html: string): QaListItem[] {
  const $ = cheerio.load(html);
  const items: QaListItem[] = [];

  $(".sectionIn01.list ul.newsList03 > li").each((_, el) => {
    const anchor = $(el).find("p.tit01 a").first();
    const href = anchor.attr("href");
    if (!href) return;

    const url = new URL(href, ORIGIN).toString();
    const match = url.match(/\/rule\/qa\/(\d+)\//);
    const id = match?.[1];
    if (!id) return;

    items.push({
      id,
      url,
      titleText: anchor.text().trim(),
      date: $(el).find("p.day01").first().text().trim(),
    });
  });

  return items;
}

export function parseQaDetailPage(html: string, id: string, url: string): QaDetail | null {
  const $ = cheerio.load(html);
  const box = $(".qabox01").first();
  if (box.length === 0) return null;

  const questionEl = box.find(".question h2").first().clone();
  questionEl.find(".qabox01_hl01").remove();
  const question = questionEl.text().trim();

  const answerEl = box.find(".answer").first().clone();
  answerEl.find(".qabox01_hl01").remove();
  const answer = answerEl.text().trim();

  if (!question || !answer) return null;

  return { id, url, question, answer };
}
