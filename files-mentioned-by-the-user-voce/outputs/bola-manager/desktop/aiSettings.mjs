import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const failure = (code) => Object.assign(new Error("Configuracao Gemini indisponivel. Nenhuma chave foi exibida."), { code });
const empty = () => ({ apiKey: "", enabled: false });
const validKey = (key) => typeof key === "string" && /^[A-Za-z0-9_.-]{20,512}$/.test(key);

// Credentials live outside career exports and are encrypted by the current OS user.
export function createAiSettingsStore({ directory, encryption, platform = process.platform }) {
  const path = join(directory, "ai-settings.json");
  let queue = Promise.resolve();
  const enqueue = (task) => {
    const pending = queue.then(task);
    queue = pending.catch(() => undefined);
    return pending;
  };
  async function available() {
    return platform !== "linux" || encryption.backend?.() !== "basic_text"
      ? Boolean(await encryption.available()) : false;
  }
  async function load() {
    let bytes;
    try { bytes = await readFile(path); }
    catch (error) { if (error.code === "ENOENT") return empty(); throw failure("LOCAL_AI_SETTINGS_UNREADABLE"); }
    if (!await available()) throw failure("LOCAL_AI_ENCRYPTION_UNAVAILABLE");
    try {
      if (bytes.length > 8192) throw new Error();
      const envelope = JSON.parse(bytes.toString("utf8"));
      if (envelope.version !== 1 || typeof envelope.data !== "string" || !/^[A-Za-z0-9+/=]+$/.test(envelope.data)) throw new Error();
      const value = JSON.parse(await encryption.decrypt(Buffer.from(envelope.data, "base64")));
      if (typeof value.enabled !== "boolean" || !(value.apiKey === "" || validKey(value.apiKey)) || (value.enabled && !value.apiKey)) throw new Error();
      return { apiKey: value.apiKey, enabled: value.enabled };
    } catch { throw failure("LOCAL_AI_SETTINGS_UNREADABLE"); }
  }
  return {
    available,
    read: () => enqueue(load),
    write: (patch) => enqueue(async () => {
      if (!patch || typeof patch !== "object" || Array.isArray(patch)
        || Object.keys(patch).some((key) => !["apiKey", "enabled", "removeKey"].includes(key))
        || typeof patch.enabled !== "boolean" || (patch.removeKey !== undefined && typeof patch.removeKey !== "boolean")) {
        throw failure("LOCAL_AI_SETTINGS_INVALID");
      }
      if (!await available()) throw failure("LOCAL_AI_ENCRYPTION_UNAVAILABLE");
      if (patch.apiKey !== undefined && (typeof patch.apiKey !== "string" || (patch.apiKey.trim() && !validKey(patch.apiKey.trim())))) throw failure("LOCAL_AI_KEY_INVALID");
      if (patch.removeKey && (patch.enabled || patch.apiKey)) throw failure("LOCAL_AI_SETTINGS_INVALID");
      const previous = patch.removeKey || patch.apiKey?.trim() ? empty() : await load();
      const apiKey = patch.removeKey ? "" : patch.apiKey?.trim() || previous.apiKey;
      if (patch.enabled && !apiKey) throw failure("LOCAL_AI_KEY_REQUIRED");
      const value = { apiKey, enabled: patch.enabled };
      let encrypted;
      try { encrypted = await encryption.encrypt(JSON.stringify(value)); }
      catch { throw failure("LOCAL_AI_ENCRYPTION_UNAVAILABLE"); }
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = join(directory, `ai-settings-${randomUUID()}.pending`);
      let handle;
      try {
        handle = await open(temporary, "wx", 0o600);
        await handle.writeFile(JSON.stringify({ version: 1, data: encrypted.toString("base64") }));
        await handle.sync(); await handle.close(); handle = null;
        await rename(temporary, path);
      } catch { throw failure("LOCAL_AI_SETTINGS_WRITE_FAILED"); }
      finally {
        await handle?.close();
        await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw failure("LOCAL_AI_SETTINGS_WRITE_FAILED"); });
      }
      return value;
    }),
  };
}
