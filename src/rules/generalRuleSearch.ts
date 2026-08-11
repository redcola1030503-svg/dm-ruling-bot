import { env } from "../config/env";
import { fetchBinary, fetchHtml } from "../utils/httpClient";
import { extractGeneralRulePdfUrl, splitIntoRuleChunks } from "./generalRuleParser";
import { extractTextFromPdf } from "./generalRulePdf";
import {
  getAllCachedGeneralRuleChunks,
  isGeneralRuleCacheFresh,
  saveGeneralRuleChunks,
} from "./generalRuleRepository";
import type { GeneralRuleChunk } from "./types";

async function crawlGeneralRule(): Promise<GeneralRuleChunk[]> {
  const pageHtml = await fetchHtml(env.DM_GENERAL_RULE_PAGE_URL);
  const pdfUrl = extractGeneralRulePdfUrl(pageHtml);
  if (!pdfUrl) {
    throw new Error("general rule PDF URL not found on page");
  }

  const pdfBuffer = await fetchBinary(pdfUrl);
  const text = await extractTextFromPdf(pdfBuffer);
  const chunks = splitIntoRuleChunks(text);

  saveGeneralRuleChunks(chunks);
  return chunks;
}

export async function ensureGeneralRuleFresh(): Promise<GeneralRuleChunk[]> {
  if (isGeneralRuleCacheFresh()) {
    return getAllCachedGeneralRuleChunks();
  }
  return crawlGeneralRule();
}
