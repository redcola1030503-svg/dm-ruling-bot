import axios, { type AxiosRequestConfig, type ResponseType } from "axios";
import { logger } from "./logger";

const USER_AGENT = "dm-ruling-bot/0.1 (+contact: LINE bot for rule ruling lookup)";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const MIN_INTERVAL_MS = 500;

// ホストごとに「次にリクエストしてよい時刻」を予約する。並列呼び出しがあっても
// 同期的に予約枠を確保するため、複数リクエストが同時に許可されてしまう競合状態
// (race condition)が起きない。これにより同一ホストへのアクセスは常に
// MIN_INTERVAL_MSずつ間隔が空く(公式サイトへの配慮)。
const nextAvailableTimeByHost = new Map<string, number>();

async function throttle(url: string): Promise<void> {
  const host = new URL(url).host;
  const now = Date.now();
  const scheduledTime = Math.max(now, nextAvailableTimeByHost.get(host) ?? 0);
  nextAvailableTimeByHost.set(host, scheduledTime + MIN_INTERVAL_MS);

  const waitMs = scheduledTime - now;
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

async function requestWithRetry<T>(config: AxiosRequestConfig): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await throttle(config.url ?? "");
      const response = await axios.request<T>({
        ...config,
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          "User-Agent": USER_AGENT,
          ...config.headers,
        },
        validateStatus: (status) => status >= 200 && status < 400,
      });
      return response.data;
    } catch (error) {
      lastError = error;
      logger.warn("http_request_retry", {
        url: config.url,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  throw lastError instanceof Error ? lastError : new Error("http_request_failed");
}

export async function fetchHtml(url: string): Promise<string> {
  return requestWithRetry<string>({ method: "GET", url, responseType: "text" as ResponseType });
}

export async function fetchBinary(url: string): Promise<Buffer> {
  const data = await requestWithRetry<ArrayBuffer>({
    method: "GET",
    url,
    responseType: "arraybuffer" as ResponseType,
  });
  return Buffer.from(data);
}

export async function postForm(url: string, form: URLSearchParams): Promise<string> {
  return requestWithRetry<string>({
    method: "POST",
    url,
    data: form.toString(),
    responseType: "text" as ResponseType,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}
