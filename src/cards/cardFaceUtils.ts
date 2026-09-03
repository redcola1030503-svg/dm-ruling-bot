import type { CardFace } from "./types";

/**
 * facesの2件目以降から、主要名(faces[0].name)と重複しない一意な別名一覧を導出する。
 * ツインパクト等、面ごとの表記が同一のカードでは空配列になる。
 * パース時(cardParser.ts)とキャッシュ復元時(cardRepository.ts)の両方で同じ
 * 導出ロジックを使うことで、経路によってalternateNamesの中身が食い違わないようにする。
 */
export function deriveAlternateNames(faces: CardFace[]): string[] {
  const primaryName = faces[0]?.name;
  return Array.from(new Set(faces.slice(1).map((f) => f.name))).filter((n) => n !== primaryName);
}
