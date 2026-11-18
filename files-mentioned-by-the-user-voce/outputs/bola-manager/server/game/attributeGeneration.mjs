// Position-based attribute generation shared by the Brasfoot and API-Football importers:
// given a target overall (1-20) and a position, derives deterministic per-attribute values.

export function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const GOALKEEPER_ATTRIBUTES = ["reflexos", "posicionamentoGol", "saidaGol", "penaltis"];

function attributeProfile({ high = [], medium = [], low = [], veryLow = [] }) {
  return Object.freeze(Object.fromEntries([
    ...high.map((attribute) => [attribute, "high"]),
    ...medium.map((attribute) => [attribute, "medium"]),
    ...low.map((attribute) => [attribute, "low"]),
    ...veryLow.map((attribute) => [attribute, "veryLow"]),
  ]));
}

const fullbackProfile = attributeProfile({
  high: ["velocidade", "defesa", "passe", "resistencia"],
  medium: ["drible", "nocao", "peBom", "forca", "impulsao"],
  low: ["chute", "peRuim"],
  veryLow: GOALKEEPER_ATTRIBUTES,
});
const wingerProfile = attributeProfile({
  high: ["velocidade", "chute", "drible", "peBom"],
  medium: ["nocao", "passe", "forca", "resistencia", "impulsao"],
  low: ["defesa", "peRuim"],
  veryLow: GOALKEEPER_ATTRIBUTES,
});
const POSITION_ATTRIBUTE_TIERS = Object.freeze({
  GOL: attributeProfile({
    high: ["reflexos", "posicionamentoGol", "saidaGol"],
    medium: ["nocao", "passe", "peBom", "forca", "resistencia", "impulsao", "penaltis"],
    low: ["velocidade", "defesa", "peRuim"],
    veryLow: ["chute", "drible"],
  }),
  ZAG: attributeProfile({
    high: ["nocao", "defesa", "forca", "impulsao"],
    medium: ["velocidade", "passe", "peBom", "resistencia"],
    low: ["chute", "drible", "peRuim"],
    veryLow: GOALKEEPER_ATTRIBUTES,
  }),
  LD: fullbackProfile,
  LE: fullbackProfile,
  VOL: attributeProfile({
    high: ["nocao", "defesa", "passe", "forca", "resistencia"],
    medium: ["velocidade", "drible", "peBom", "impulsao"],
    low: ["chute", "peRuim"],
    veryLow: GOALKEEPER_ATTRIBUTES,
  }),
  MC: attributeProfile({
    high: ["nocao", "passe", "resistencia"],
    medium: ["velocidade", "chute", "drible", "defesa", "peBom", "forca", "impulsao"],
    low: ["peRuim"],
    veryLow: GOALKEEPER_ATTRIBUTES,
  }),
  MEI: attributeProfile({
    high: ["chute", "drible", "nocao", "passe", "peBom"],
    medium: ["velocidade", "forca", "resistencia", "impulsao"],
    low: ["defesa", "peRuim"],
    veryLow: GOALKEEPER_ATTRIBUTES,
  }),
  PD: wingerProfile,
  PE: wingerProfile,
  ATA: attributeProfile({
    high: ["chute", "drible", "nocao", "forca", "impulsao"],
    medium: ["velocidade", "passe", "peBom", "resistencia"],
    low: ["defesa", "peRuim"],
    veryLow: GOALKEEPER_ATTRIBUTES,
  }),
});

export const GENERATED_ATTRIBUTE_KEYS = Object.freeze([
  "velocidade", "chute", "drible", "nocao", "defesa", "passe", "peBom", "peRuim",
  "forca", "resistencia", "impulsao", "reflexos", "posicionamentoGol", "saidaGol", "penaltis",
]);

export function generatedAttribute(player, attributeName, overall) {
  const variance = (hashText(`${player.name}|${player.position}|${attributeName}`) % 3) - 1;
  const tier = POSITION_ATTRIBUTE_TIERS[player.position]?.[attributeName] ?? "medium";
  const target = tier === "high"
    ? overall + 1
    : tier === "low"
      ? Math.round(overall * 0.5)
      : tier === "veryLow"
        ? Math.round(overall * 0.25)
        : overall - 1;
  return Math.max(1, Math.min(20, target + variance));
}
