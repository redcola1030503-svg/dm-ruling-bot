import * as cheerio from "cheerio";
import type { GeneralRuleChunk } from "./types";

const ORIGIN = "https://dm.takaratomy.co.jp";

/**
 * 総合ルールトップページのHTMLから「総合ゲームルール」PDFへのリンクを抽出する。
 * ファイル名に更新日が含まれ変化するため、都度ページから取得する。
 */
export function extractGeneralRulePdfUrl(html: string): string | null {
  const $ = cheerio.load(html);
  let url: string | null = null;

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const text = $(el).text();
    if (href.toLowerCase().endsWith(".pdf") && text.includes("総合ゲームルール")) {
      url = new URL(href, ORIGIN).toString();
    }
  });

  return url;
}

const RULE_NUMBER_PATTERN = /^(\d{3}(?:\.\d+)*[a-z]?)\.?\s*/;

/**
 * PDFから抽出したテキストを条文番号(例: 609.5.)単位のチャンクに分割する。
 */
export function splitIntoRuleChunks(text: string): GeneralRuleChunk[] {
  const normalized = `\n${text.replace(/\r\n/g, "\n")}`;
  const parts = normalized.split(/(?=\n\d{3}(?:\.\d+)*[a-z]?\.?\s)/);

  const chunks: GeneralRuleChunk[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const match = trimmed.match(RULE_NUMBER_PATTERN);
    if (!match?.[1]) continue;

    const ruleNumber = match[1];
    const bodyText = trimmed.replace(/\s+/g, " ").trim();
    if (bodyText.length < 5) continue;

    chunks.push({ ruleNumber, text: bodyText });
  }

  return chunks;
}
