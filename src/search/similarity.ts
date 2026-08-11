/**
 * 2つのembeddingベクトルのコサイン類似度(-1〜1、通常は0〜1)を計算する。
 * Voyage AIのembeddingは正規化済み(L2ノルム=1)である可能性が高く、その場合
 * dot productとcosine類似度は等しくなるが、正規化の保証に依存しない実装に
 * するためノルムで割る完全な計算を行う。
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error("Embedding dimensions mismatch");
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
