import assert from "node:assert/strict";
import test from "node:test";
import { JavaSerializationError, parseJavaSerialization } from "../../scripts/lib/java-serialization.mjs";

function utf(value) {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.alloc(2);
  length.writeUInt16BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function serializedSimpleObject() {
  const integer = Buffer.alloc(4);
  integer.writeInt32BE(42);
  return Buffer.concat([
    Buffer.from([0xac, 0xed, 0x00, 0x05, 0x73, 0x72]),
    utf("test.Simple"),
    Buffer.from("0000000000000001", "hex"),
    Buffer.from([0x02, 0x00, 0x02]),
    Buffer.from([0x49]), utf("age"),
    Buffer.from([0x4c]), utf("name"), Buffer.from([0x74]), utf("Ljava/lang/String;"),
    Buffer.from([0x78, 0x70]),
    integer,
    Buffer.from([0x74]), utf("Emanuel"),
  ]);
}

function serializedCyclicClassDescriptor() {
  return Buffer.concat([
    Buffer.from([0xac, 0xed, 0x00, 0x05, 0x73, 0x72]),
    utf("test.Cycle"),
    Buffer.from("0000000000000001", "hex"),
    Buffer.from([0x02, 0x00, 0x00, 0x78, 0x71, 0x00, 0x7e, 0x00, 0x00]),
  ]);
}

test("decodifica objeto Java serializado sem carregar classes Java", () => {
  const result = parseJavaSerialization(serializedSimpleObject());

  assert.equal(result.$class, "test.Simple");
  assert.equal(result.$fields.age, 42);
  assert.equal(result.$fields.name, "Emanuel");
  assert.deepEqual(result.$classData.map((entry) => entry.className), ["test.Simple"]);
});

test("rejeita header, truncamento e streams acima do limite", () => {
  assert.throws(
    () => parseJavaSerialization(Buffer.alloc(16)),
    (error) => error instanceof JavaSerializationError && error.code === "JAVA_SERIALIZATION_INVALID",
  );
  assert.throws(() => parseJavaSerialization(serializedSimpleObject().subarray(0, -2)), /truncado/);
  assert.throws(
    () => parseJavaSerialization(serializedSimpleObject(), { maxBytes: 8 }),
    (error) => error instanceof JavaSerializationError && error.code === "JAVA_SERIALIZATION_LIMIT",
  );
});

test("rejeita hierarquia ciclica de class descriptors", () => {
  assert.throws(
    () => parseJavaSerialization(serializedCyclicClassDescriptor()),
    (error) => error instanceof JavaSerializationError
      && error.code === "JAVA_SERIALIZATION_INVALID"
      && /ciclica/.test(error.message),
  );
});
