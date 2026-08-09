import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyLineSignature } from "../src/line/verifySignature";

const CHANNEL_SECRET = "test-channel-secret";

function sign(body: Buffer, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64");
}

describe("verifyLineSignature", () => {
  it("正しい署名の場合はtrueを返す", () => {
    const body = Buffer.from(JSON.stringify({ events: [] }));
    const signature = sign(body, CHANNEL_SECRET);
    expect(verifyLineSignature(body, signature, CHANNEL_SECRET)).toBe(true);
  });

  it("誤った署名の場合はfalseを返す", () => {
    const body = Buffer.from(JSON.stringify({ events: [] }));
    expect(verifyLineSignature(body, "invalid-signature", CHANNEL_SECRET)).toBe(false);
  });

  it("署名が改ざんされたボディに対してはfalseを返す", () => {
    const originalBody = Buffer.from(JSON.stringify({ events: [] }));
    const signature = sign(originalBody, CHANNEL_SECRET);
    const tamperedBody = Buffer.from(JSON.stringify({ events: [{ tampered: true }] }));
    expect(verifyLineSignature(tamperedBody, signature, CHANNEL_SECRET)).toBe(false);
  });

  it("rawBodyまたはsignatureが欠けている場合はfalseを返す", () => {
    expect(verifyLineSignature(undefined, "sig", CHANNEL_SECRET)).toBe(false);
    expect(verifyLineSignature(Buffer.from("{}"), undefined, CHANNEL_SECRET)).toBe(false);
  });
});
