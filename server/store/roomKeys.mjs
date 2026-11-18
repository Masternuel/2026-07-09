// Canonical club key comparison shared by the room store and its services.
export function clubKey(value) {
  return String(value ?? "").trim().toLocaleUpperCase("pt-BR");
}
