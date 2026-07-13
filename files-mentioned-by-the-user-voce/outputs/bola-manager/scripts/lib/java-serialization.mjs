const STREAM_MAGIC = 0xaced;
const STREAM_VERSION = 5;
const BASE_HANDLE = 0x7e0000;

const TC = Object.freeze({
  NULL: 0x70,
  REFERENCE: 0x71,
  CLASSDESC: 0x72,
  OBJECT: 0x73,
  STRING: 0x74,
  ARRAY: 0x75,
  CLASS: 0x76,
  BLOCKDATA: 0x77,
  ENDBLOCKDATA: 0x78,
  RESET: 0x79,
  BLOCKDATALONG: 0x7a,
  EXCEPTION: 0x7b,
  LONGSTRING: 0x7c,
  PROXYCLASSDESC: 0x7d,
  ENUM: 0x7e,
});

const FLAGS = Object.freeze({
  WRITE_METHOD: 0x01,
  SERIALIZABLE: 0x02,
  EXTERNALIZABLE: 0x04,
  BLOCK_DATA: 0x08,
  ENUM: 0x10,
});

export class JavaSerializationError extends Error {
  constructor(message, code = "JAVA_SERIALIZATION_INVALID", offset = null) {
    super(offset == null ? message : `${message} (offset ${offset})`);
    this.name = "JavaSerializationError";
    this.code = code;
    this.offset = offset;
  }
}

function decodeModifiedUtf8(bytes) {
  const units = [];
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index++];
    if ((first & 0x80) === 0) {
      units.push(first);
      continue;
    }
    if ((first & 0xe0) === 0xc0) {
      if (index >= bytes.length) throw new JavaSerializationError("UTF modificado truncado");
      const second = bytes[index++];
      if ((second & 0xc0) !== 0x80) throw new JavaSerializationError("UTF modificado invalido");
      units.push(((first & 0x1f) << 6) | (second & 0x3f));
      continue;
    }
    if ((first & 0xf0) === 0xe0) {
      if (index + 1 >= bytes.length) throw new JavaSerializationError("UTF modificado truncado");
      const second = bytes[index++];
      const third = bytes[index++];
      if ((second & 0xc0) !== 0x80 || (third & 0xc0) !== 0x80) {
        throw new JavaSerializationError("UTF modificado invalido");
      }
      units.push(((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f));
      continue;
    }
    throw new JavaSerializationError("Sequencia UTF modificada nao suportada");
  }
  let value = "";
  for (let index = 0; index < units.length; index += 8_192) {
    value += String.fromCharCode(...units.slice(index, index + 8_192));
  }
  return value;
}

function defaultLimits(options = {}) {
  return {
    maxBytes: options.maxBytes ?? 16 * 1024 * 1024,
    maxDepth: options.maxDepth ?? 128,
    maxHandles: options.maxHandles ?? 250_000,
    maxArrayLength: options.maxArrayLength ?? 250_000,
    maxStringBytes: options.maxStringBytes ?? 4 * 1024 * 1024,
    maxBlockBytes: options.maxBlockBytes ?? 8 * 1024 * 1024,
  };
}

class Parser {
  constructor(input, options) {
    this.buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
    this.offset = 0;
    this.handles = new Map();
    this.nextHandle = BASE_HANDLE;
    this.limits = defaultLimits(options);
    if (this.buffer.length > this.limits.maxBytes) {
      throw new JavaSerializationError("Stream excede o limite de bytes", "JAVA_SERIALIZATION_LIMIT");
    }
  }

  parse() {
    if (this.u16() !== STREAM_MAGIC || this.u16() !== STREAM_VERSION) {
      throw this.error("Header Java Serialization invalido");
    }
    const root = this.content(0);
    if (this.offset !== this.buffer.length) throw this.error("Bytes extras apos o objeto raiz");
    return root;
  }

  error(message, code) {
    return new JavaSerializationError(message, code, this.offset);
  }

  ensure(size) {
    if (!Number.isSafeInteger(size) || size < 0 || this.offset + size > this.buffer.length) {
      throw this.error("Stream Java truncado");
    }
  }

  bytes(size) {
    this.ensure(size);
    const value = this.buffer.subarray(this.offset, this.offset + size);
    this.offset += size;
    return value;
  }

  u8() { this.ensure(1); return this.buffer[this.offset++]; }
  i8() { this.ensure(1); return this.buffer.readInt8(this.offset++); }
  u16() { this.ensure(2); const v = this.buffer.readUInt16BE(this.offset); this.offset += 2; return v; }
  i16() { this.ensure(2); const v = this.buffer.readInt16BE(this.offset); this.offset += 2; return v; }
  i32() { this.ensure(4); const v = this.buffer.readInt32BE(this.offset); this.offset += 4; return v; }
  u32() { this.ensure(4); const v = this.buffer.readUInt32BE(this.offset); this.offset += 4; return v; }
  f32() { this.ensure(4); const v = this.buffer.readFloatBE(this.offset); this.offset += 4; return v; }
  f64() { this.ensure(8); const v = this.buffer.readDoubleBE(this.offset); this.offset += 8; return v; }
  i64() { this.ensure(8); const v = this.buffer.readBigInt64BE(this.offset); this.offset += 8; return v; }

  utf(length = this.u16()) {
    if (length > this.limits.maxStringBytes) throw this.error("String excede limite", "JAVA_SERIALIZATION_LIMIT");
    return decodeModifiedUtf8(this.bytes(length));
  }

  addHandle(value) {
    if (this.handles.size >= this.limits.maxHandles) {
      throw this.error("Quantidade de handles excede limite", "JAVA_SERIALIZATION_LIMIT");
    }
    this.handles.set(this.nextHandle, value);
    this.nextHandle += 1;
    return value;
  }

  reference() {
    const handle = this.u32();
    if (!this.handles.has(handle)) throw this.error(`Referencia Java desconhecida: 0x${handle.toString(16)}`);
    return this.handles.get(handle);
  }

  content(depth, token = this.u8()) {
    if (depth > this.limits.maxDepth) throw this.error("Profundidade excede limite", "JAVA_SERIALIZATION_LIMIT");
    switch (token) {
      case TC.NULL: return null;
      case TC.REFERENCE: return this.reference();
      case TC.CLASSDESC: return this.classDesc(depth + 1);
      case TC.OBJECT: return this.object(depth + 1);
      case TC.STRING: return this.string(false);
      case TC.LONGSTRING: return this.string(true);
      case TC.ARRAY: return this.array(depth + 1);
      case TC.CLASS: return this.classObject(depth + 1);
      case TC.ENUM: return this.enumObject(depth + 1);
      case TC.BLOCKDATA: return this.blockData(this.u8());
      case TC.BLOCKDATALONG: return this.blockData(this.u32());
      case TC.RESET:
        this.handles.clear();
        this.nextHandle = BASE_HANDLE;
        return this.content(depth + 1);
      case TC.PROXYCLASSDESC: throw this.error("Proxy class descriptor nao suportado");
      case TC.EXCEPTION: throw this.error("Stream contem excecao serializada");
      case TC.ENDBLOCKDATA: throw this.error("Fim de bloco inesperado");
      default: throw this.error(`Token Java desconhecido: 0x${token.toString(16)}`);
    }
  }

  string(longString) {
    const length = longString ? this.i64() : BigInt(this.u16());
    if (length < 0 || length > BigInt(this.limits.maxStringBytes)) {
      throw this.error("String excede limite", "JAVA_SERIALIZATION_LIMIT");
    }
    const value = decodeModifiedUtf8(this.bytes(Number(length)));
    this.addHandle(value);
    return value;
  }

  blockData(length) {
    if (length > this.limits.maxBlockBytes) throw this.error("Bloco excede limite", "JAVA_SERIALIZATION_LIMIT");
    return { $blockData: Buffer.from(this.bytes(length)) };
  }

  classDesc(depth) {
    const descriptor = {
      $java: "classDesc",
      name: this.utf(),
      serialVersionUid: this.i64().toString(),
      flags: 0,
      fields: [],
      annotations: [],
      superClass: null,
    };
    this.addHandle(descriptor);
    descriptor.flags = this.u8();
    const fieldCount = this.u16();
    if (fieldCount > 10_000) throw this.error("Classe com campos demais", "JAVA_SERIALIZATION_LIMIT");
    for (let index = 0; index < fieldCount; index += 1) {
      const typeCode = String.fromCharCode(this.u8());
      const field = { typeCode, name: this.utf(), className: null };
      if (typeCode === "L" || typeCode === "[") {
        const typeName = this.content(depth + 1);
        if (typeof typeName !== "string") throw this.error("Tipo de campo Java invalido");
        field.className = typeName;
      }
      descriptor.fields.push(field);
    }
    descriptor.annotations = this.annotations(depth + 1);
    descriptor.superClass = this.classDescValue(depth + 1);
    return descriptor;
  }

  classDescValue(depth) {
    const token = this.u8();
    if (token === TC.NULL) return null;
    if (token === TC.REFERENCE) {
      const value = this.reference();
      if (value?.$java !== "classDesc") throw this.error("Referencia nao e class descriptor");
      return value;
    }
    if (token === TC.CLASSDESC) return this.classDesc(depth + 1);
    throw this.error(`Class descriptor inesperado: 0x${token.toString(16)}`);
  }

  annotations(depth) {
    const values = [];
    while (true) {
      const token = this.u8();
      if (token === TC.ENDBLOCKDATA) return values;
      values.push(this.content(depth + 1, token));
    }
  }

  hierarchy(descriptor) {
    const values = [];
    const visited = new Set();
    for (let current = descriptor; current; current = current.superClass) {
      if (visited.has(current)) throw this.error("Hierarquia de classes Java ciclica", "JAVA_SERIALIZATION_INVALID");
      visited.add(current);
      values.unshift(current);
    }
    return values;
  }

  fieldValue(typeCode, depth) {
    switch (typeCode) {
      case "B": return this.i8();
      case "C": return String.fromCharCode(this.u16());
      case "D": return this.f64();
      case "F": return this.f32();
      case "I": return this.i32();
      case "J": {
        const value = this.i64();
        return value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER ? Number(value) : value.toString();
      }
      case "S": return this.i16();
      case "Z": return this.u8() !== 0;
      case "[":
      case "L": return this.content(depth + 1);
      default: throw this.error(`Tipo primitivo Java desconhecido: ${typeCode}`);
    }
  }

  object(depth) {
    const descriptor = this.classDescValue(depth + 1);
    if (!descriptor) throw this.error("Objeto Java sem classe");
    const object = { $java: "object", $class: descriptor.name, $fields: {}, $classData: [] };
    this.addHandle(object);
    for (const classDescriptor of this.hierarchy(descriptor)) {
      const fields = {};
      for (const field of classDescriptor.fields) {
        const value = this.fieldValue(field.typeCode, depth + 1);
        fields[field.name] = value;
        object.$fields[field.name] = value;
      }
      const classData = { className: classDescriptor.name, fields, annotations: [] };
      if ((classDescriptor.flags & FLAGS.SERIALIZABLE) !== 0
        && (classDescriptor.flags & FLAGS.WRITE_METHOD) !== 0) {
        classData.annotations = this.annotations(depth + 1);
      } else if ((classDescriptor.flags & FLAGS.EXTERNALIZABLE) !== 0) {
        if ((classDescriptor.flags & FLAGS.BLOCK_DATA) === 0) {
          throw this.error("Externalizable sem block data nao suportado");
        }
        classData.annotations = this.annotations(depth + 1);
      }
      object.$classData.push(classData);
    }
    this.decorateKnownCollection(object);
    return object;
  }

  decorateKnownCollection(object) {
    if (object.$class === "java.util.ArrayList") {
      const data = object.$classData.find((entry) => entry.className === "java.util.ArrayList");
      object.$values = data?.annotations.filter((value) => !value?.$blockData) ?? [];
    }
  }

  array(depth) {
    const descriptor = this.classDescValue(depth + 1);
    if (!descriptor?.name?.startsWith("[")) throw this.error("Array Java sem descriptor valido");
    const array = { $java: "array", $class: descriptor.name, $values: [] };
    this.addHandle(array);
    const length = this.i32();
    if (length < 0 || length > this.limits.maxArrayLength) {
      throw this.error("Array excede limite", "JAVA_SERIALIZATION_LIMIT");
    }
    const typeCode = descriptor.name[1];
    for (let index = 0; index < length; index += 1) {
      array.$values.push(typeCode === "L" || typeCode === "["
        ? this.content(depth + 1)
        : this.fieldValue(typeCode, depth + 1));
    }
    return array;
  }

  classObject(depth) {
    const value = { $java: "class", descriptor: this.classDescValue(depth + 1) };
    return this.addHandle(value);
  }

  enumObject(depth) {
    const descriptor = this.classDescValue(depth + 1);
    const value = { $java: "enum", $class: descriptor?.name ?? null, name: null };
    this.addHandle(value);
    const name = this.content(depth + 1);
    if (typeof name !== "string") throw this.error("Nome de enum invalido");
    value.name = name;
    return value;
  }
}

export function parseJavaSerialization(input, options = {}) {
  return new Parser(input, options).parse();
}
