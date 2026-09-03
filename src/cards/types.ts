/** サイキック・ドラグハート・ツインパクト等、1枚のカードが持ちうる面ごとの名前・属性。 */
export type CardFace = {
  name: string;
  cardType: string;
  civilization: string;
  rarity: string;
  power: string;
  cost: string;
  mana: string;
  race: string;
};

export type CardInfo = {
  id: string;
  url: string;
  /** 主要面(faces[0])の名前。後方互換のため維持。 */
  name: string;
  /** nameに採用されなかった面の名前一覧(faces[1:]のname、後方互換用)。 */
  alternateNames: string[];
  /** 主要面(faces[0])の属性。後方互換のため維持。 */
  cardType: string;
  civilization: string;
  rarity: string;
  power: string;
  cost: string;
  mana: string;
  race: string;
  /** 全面ぶん連結された能力テキスト(既存仕様、面ごとには分離しない)。 */
  cardText: string;
  flavorText: string;
  illustrator: string;
  qaListUrl: string | null;
  /** 全ての面(表/裏)の名前+属性。1件以上、faces[0]が主要面。 */
  faces: CardFace[];
};

export type CardSearchHit = {
  id: string;
  url: string;
};
