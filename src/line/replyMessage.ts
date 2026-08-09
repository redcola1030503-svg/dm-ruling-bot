import { getLineClient } from "./client";

export async function replyText(replyToken: string, text: string): Promise<void> {
  const client = getLineClient();
  await client.replyMessage({
    replyToken,
    messages: [{ type: "text", text }],
  });
}
