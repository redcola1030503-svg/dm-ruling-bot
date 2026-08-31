import { z } from "zod";

// ルートハンドラーから切り離して単体テストする(他モジュールと同じ方針)。
// deviceIdは必須(PR #1レビュー指摘P0対応: 省略すると無料枠・課金チェックを
// 丸ごとバイパスできたため、モバイルアプリは常にdeviceIdを生成済みで送信する
// 前提に合わせて必須化した)。
export const createJobSchema = z.object({
  question: z.string().min(1).max(1000),
  deviceId: z.string().min(1).max(200),
  threadId: z.string().min(1).max(200).optional(),
});
