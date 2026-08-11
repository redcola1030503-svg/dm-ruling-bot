import { describe, expect, it } from "vitest";
import { bufferToFloat32Array, float32ArrayToBuffer } from "../src/embeddings/embeddingUtils";

describe("embeddingUtils のBuffer往復変換", () => {
  it("number[] → Buffer → Float32Array で値が保持される", () => {
    const values = [0.1, -0.5, 1.25, 0, 3.14159];
    const buffer = float32ArrayToBuffer(values);
    const restored = bufferToFloat32Array(buffer);

    expect(restored.length).toBe(values.length);
    for (let i = 0; i < values.length; i++) {
      expect(restored[i]).toBeCloseTo(values[i]!, 5);
    }
  });

  it("SQLiteのBLOB読み出しを模したbyteOffsetがずれたBufferでも正しく復元できる", () => {
    const values = [1, 2, 3, 4];
    const original = float32ArrayToBuffer(values);

    // 大きなバッファの一部をスライスした場合(byteOffsetが0でない)を模す。
    const padded = Buffer.concat([Buffer.alloc(3), original]);
    const sliced = padded.subarray(3);

    const restored = bufferToFloat32Array(sliced);
    expect(Array.from(restored)).toEqual(values);
  });

  it("空配列も往復できる", () => {
    const restored = bufferToFloat32Array(float32ArrayToBuffer([]));
    expect(restored.length).toBe(0);
  });
});
