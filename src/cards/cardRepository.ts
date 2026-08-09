import { db } from "../config/db";
import type { CardInfo } from "./types";

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
  updated_at: number;
};

function rowToCard(row: CardRow): CardInfo {
  return {
    id: row.id,
    url: row.url,
    name: row.name,
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
    `INSERT INTO card_cache (id, name, url, card_type, civilization, rarity, power, cost, mana, race, card_text, flavor_text, illustrator, qa_list_url, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, url=excluded.url, card_type=excluded.card_type, civilization=excluded.civilization,
       rarity=excluded.rarity, power=excluded.power, cost=excluded.cost, mana=excluded.mana, race=excluded.race,
       card_text=excluded.card_text, flavor_text=excluded.flavor_text, illustrator=excluded.illustrator,
       qa_list_url=excluded.qa_list_url, updated_at=excluded.updated_at`,
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
    Date.now(),
  );
}
