import { FORMATION_ROLES } from "./tactics.mjs";
import { calculateTeamCohesion as calculate } from "../../shared/teamCohesion.mjs";

export { cohesionModifier } from "../../shared/teamCohesion.mjs";

export function calculateTeamCohesion(options = {}) {
  return calculate({ ...options, formationRoles: FORMATION_ROLES });
}
