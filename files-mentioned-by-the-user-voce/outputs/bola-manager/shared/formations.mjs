// Single source of truth for formation ids and slot roles (audit Q-04).
// Server rules (tactics, cohesion, opponent study, lineups) and the client read the
// same table; the client only adds visual metadata (slot ids, pitch coordinates, labels).
export const FORMATION_ROLES = Object.freeze({
  "4-3-3": Object.freeze(["GOL", "LE", "ZAG", "ZAG", "LD", "VOL", "MC", "MC", "PE", "ATA", "PD"]),
  "4-4-2": Object.freeze(["GOL", "LE", "ZAG", "ZAG", "LD", "PE", "MC", "MC", "PD", "ATA", "ATA"]),
  "3-5-2": Object.freeze(["GOL", "ZAG", "ZAG", "ZAG", "LE", "VOL", "MC", "MC", "LD", "ATA", "ATA"]),
  "4-2-3-1": Object.freeze(["GOL", "LE", "ZAG", "ZAG", "LD", "VOL", "VOL", "PE", "MEI", "PD", "ATA"]),
  "5-3-2": Object.freeze(["GOL", "LE", "ZAG", "ZAG", "ZAG", "LD", "VOL", "MC", "MC", "ATA", "ATA"]),
  "3-4-3": Object.freeze(["GOL", "ZAG", "ZAG", "ZAG", "PE", "MC", "MC", "PD", "PE", "ATA", "PD"]),
  "4-1-4-1": Object.freeze(["GOL", "LE", "ZAG", "ZAG", "LD", "VOL", "PE", "MC", "MC", "PD", "ATA"]),
  "5-4-1": Object.freeze(["GOL", "LE", "ZAG", "ZAG", "ZAG", "LD", "PE", "MC", "MC", "PD", "ATA"]),
  "4-3-2-1": Object.freeze(["GOL", "LE", "ZAG", "ZAG", "LD", "VOL", "MC", "MC", "MEI", "MEI", "ATA"]),
});

export const FORMATION_IDS = Object.freeze(Object.keys(FORMATION_ROLES));

export const DEFAULT_FORMATION_ID = "4-3-3";
