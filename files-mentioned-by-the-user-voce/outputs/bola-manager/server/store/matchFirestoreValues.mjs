function invalidValue() {
  return Object.assign(new Error("Tipo de dado invalido no snapshot da partida"), {
    code: "MATCH_PERSISTENCE_DATA_INVALID",
  });
}

// Match snapshots are plain data (dates are ISO strings), not SDK references or
// FieldValue transforms. Reject unsupported types instead of changing their meaning.
export function encodeMatchValue(value, insideArray = false) {
  if (value === null) return { nullValue: "NULL_VALUE" };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    // Canonicalize only the wire value; never mutate the caller's snapshot.
    if (Object.is(value, -0)) value = 0;
    return Number.isSafeInteger(value)
      ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === "bigint") {
    if (value < -(2n ** 63n) || value > 2n ** 63n - 1n) throw invalidValue();
    return { integerValue: String(value) };
  }
  if (Array.isArray(value)) {
    if (insideArray) throw invalidValue();
    return { arrayValue: { values: value.map((item) => encodeMatchValue(item ?? null, true)) } };
  }
  if (value && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return { mapValue: { fields: encodeMatchFields(value) } };
  }
  throw invalidValue();
}

export function encodeMatchFields(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, encodeMatchValue(value)]));
}

export function decodeMatchValue(value) {
  if (Object.hasOwn(value, "nullValue")) return null;
  if (Object.hasOwn(value, "stringValue")) return value.stringValue;
  if (Object.hasOwn(value, "booleanValue")) return value.booleanValue;
  if (Object.hasOwn(value, "integerValue")) return Number(value.integerValue.toString());
  if (Object.hasOwn(value, "doubleValue")) return Number(value.doubleValue);
  if (Object.hasOwn(value, "arrayValue")) return (value.arrayValue.values ?? []).map(decodeMatchValue);
  if (Object.hasOwn(value, "mapValue")) return decodeMatchFields(value.mapValue.fields ?? {});
  throw invalidValue();
}

export function decodeMatchFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeMatchValue(value)]));
}
