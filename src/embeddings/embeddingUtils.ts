/**
 * embeddingベクトル(number[])をSQLiteのBLOB列に保存できるBufferへ変換する。
 * JSON文字列化より容量・パース速度の両面で有利。
 */
export function float32ArrayToBuffer(values: number[] | Float32Array): Buffer {
  const array = values instanceof Float32Array ? values : Float32Array.from(values);
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

/**
 * SQLiteから読み出したBLOB(Buffer)をFloat32Arrayへ復元する。
 * `node:sqlite`が返すBufferはbyteOffsetが4(Float32の要素サイズ)の倍数に
 * 揃っている保証がなく、そのままFloat32Arrayのビューを張るとRangeErrorに
 * なりうるため、独立したBufferへコピーしてから復元する。
 */
export function bufferToFloat32Array(buffer: Buffer): Float32Array {
  const aligned = Buffer.from(buffer);
  return new Float32Array(
    aligned.buffer,
    aligned.byteOffset,
    aligned.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
}
