import { validateSignature } from "@line/bot-sdk";

export function verifyLineSignature(
  rawBody: Buffer | undefined,
  signature: string | undefined,
  channelSecret: string,
): boolean {
  if (!rawBody || !signature) return false;
  return validateSignature(rawBody, channelSecret, signature);
}
