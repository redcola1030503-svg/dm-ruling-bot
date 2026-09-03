import { db } from "../config/db";
import { deriveAlternateNames } from "./cardFaceUtils";
import type { CardFace, CardInfo } from "./types";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24時間

type CardRow = {
  id: string;
  name: string;
  url: string;
  card_type: string;
  civilization: string;
  rarity: string;
  power: string;
  cost: string;
  mana: string;
  race: string;
  card_text: string;
  flavor_text: string;
  illustrator: string;
  qa_list_url: string | null;
  faces: string | null;
  updated_at: number;
};

function isCardFace(value: unknown): value is CardFace {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === "string" &&
    typeof v.cardType === "string" &&
    typeof v.civilization === "string" &&
    typeof v.rarity === "string" &&
    typeof v.power === "string" &&
    typeof v.cost === "string" &&
    typeof v.mana === "string" &&
    typeof v.race === "string"
  );
}

/**
 * facesのJSON文字列を復元する。旧スキーマ(facesカラム導入前)の行や、
 * パース失敗時は空配列を返し、呼び出し側でrowの主要面フィールドから
 * フォールバックのfaces配列を組み立てる。
 */
function parseFaces(value: string | null): CardFace[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isCardFace) : [];
  } catch {
    return [];
  }
}

function rowToCard(row: CardRow): CardInfo {
  const parsedFaces = parseFaces(row.faces);
  // 旧スキーマ(facesカラムがまだ無かった時点)でキャッシュされた行は、
  // 主要面の情報しか復元できない(alternateNamesは失われる)。
  const faces: CardFace[] =
    parsedFaces.length > 0
      ? parsedFaces
      : [
          {
            name: row.name,
            cardType: row.card_type,
            civilization: row.civilization,
            rarity: row.rarity,
            power: row.power,
            cost: row.cost,
            mana: row.mana,
            race: row.race,
          },
        ];

  return {
    id: row.id,
    url: row.url,
    name: row.name,
    alternateNames: deriveAlternateNames(faces),
    cardType: row.card_type,
    civilization: row.civilization,
    rarity: row.rarity,
    power: row.power,
    cost: row.cost,
    mana: row.mana,
    race: row.race,
    cardText: row.card_text,
    flavorText: row.flavor_text,
    illustrator: row.illustrator,
    qaListUrl: row.qa_list_url,
    faces,
  };
}

export function getCachedCard(id: string): CardInfo | null {
  const row = db
    .prepare("SELECT * FROM card_cache WHERE id = ?")
    .get(id) as CardRow | undefined;
  if (!row) return null;
  if (Date.now() - row.updated_at > CACHE_TTL_MS) return null;
  return rowToCard(row);
}

export function saveCardToCache(card: CardInfo): void {
  db.prepare(
    `INSERT INTO card_cache (id, name, url, card_type, civilization, rarity, power, cost, mana, race, card_text, flavor_text, illustrator, qa_list_url, faces, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, url=excluded.url, card_type=excluded.card_type, civilization=excluded.civilization,
       rarity=excluded.rarity, power=excluded.power, cost=excluded.cost, mana=excluded.mana, race=excluded.race,
       card_text=excluded.card_text, flavor_text=excluded.flavor_text, illustrator=excluded.illustrator,
       qa_list_url=excluded.qa_list_url, faces=excluded.faces, updated_at=excluded.updated_at`,
  ).run(
    card.id,
    card.name,
    card.url,
    card.cardType,
    card.civilization,
    card.rarity,
    card.power,
    card.cost,
    card.mana,
    card.race,
    card.cardText,
    card.flavorText,
    card.illustrator,
    card.qaListUrl,
    JSON.stringify(card.faces),
    Date.now(),
  );
}
