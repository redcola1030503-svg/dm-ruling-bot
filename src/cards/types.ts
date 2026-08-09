export type CardInfo = {
  id: string;
  url: string;
  name: string;
  cardType: string;
  civilization: string;
  rarity: string;
  power: string;
  cost: string;
  mana: string;
  race: string;
  cardText: string;
  flavorText: string;
  illustrator: string;
  qaListUrl: string | null;
};

export type CardSearchHit = {
  id: string;
  url: string;
};
