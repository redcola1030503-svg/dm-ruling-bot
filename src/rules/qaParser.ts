import * as cheerio from "cheerio";
import type { QaDetail, QaListItem } from "./types";

const ORIGIN = "https://dm.takaratomy.co.jp";

/**
 * 「過去のよくある質問」(/rule/qa_old/、現行の/rule/qa/検索一覧には出てこなく
 * なった古いQ&A)の一覧ページも同じHTML構造・同じ検索フォームを持つため、
 * このパーサーを共用する。qa_old側の個別ページは/rule/qa/{id}/へ301リダイレクト
 * される(同一WordPress投稿)ため、urlは常に正規の/rule/qa/{id}/へ正規化する。
 */
export function parseQaListPage(html: string): QaListItem[] {
  const $ = cheerio.load(html);
  const items: QaListItem[] = [];

  $("#qa_result_area ul.newsList03 > li").each((_, el) => {
    const anchor = $(el).find("p.tit01 a").first();
    const href = anchor.attr("href");
    if (!href) return;

    const rawUrl = new URL(href, ORIGIN).toString();
    const match = rawUrl.match(/\/rule\/qa(?:_old)?\/(\d+)\//);
    const id = match?.[1];
    if (!id) return;

    items.push({
      id,
      url: `${ORIGIN}/rule/qa/${id}/`,
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
