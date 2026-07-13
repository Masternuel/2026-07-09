function validPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function yearFrom(value, fallback) {
  const date = new Date(value ?? "");
  return Number.isFinite(date.getTime()) ? date.getUTCFullYear() : fallback.getUTCFullYear();
}

export function ensureCareerState(room, now = new Date()) {
  let changed = false;
  const set = (key, value) => {
    if (room[key] === value) return;
    room[key] = value;
    changed = true;
  };

  if (!validPositiveInteger(room.seasonLength)) set("seasonLength", 1);
  if (typeof room.unlimitedSeasons !== "boolean") set("unlimitedSeasons", false);
  if (!validPositiveInteger(room.currentSeason)) set("currentSeason", 1);
  if (!validPositiveInteger(room.seasonYear)) {
    const firstYear = yearFrom(room.startedAt ?? room.createdAt, now);
    set("seasonYear", firstYear + room.currentSeason - 1);
  }
  if (typeof room.seasonStartedAt !== "string" || !room.seasonStartedAt) {
    set("seasonStartedAt", room.startedAt ?? room.createdAt ?? now.toISOString());
  }
  if (!Array.isArray(room.seasonHistory)) set("seasonHistory", []);
  if (typeof room.careerCompleted !== "boolean") set("careerCompleted", false);
  if (!(typeof room.careerCompletedAt === "string" || room.careerCompletedAt === null)) {
    set("careerCompletedAt", null);
  }
  return changed;
}

export function careerHasNextSeason(room) {
  return room.unlimitedSeasons === true || room.currentSeason < room.seasonLength;
}
