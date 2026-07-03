// @ts-nocheck

// Serialized into the WhatsApp Web page; keep this function self-contained.
export function extractWhatsAppWebStorageInventory() {
  const MAX_SAMPLES = 3;
  const MAX_DEPTH = 2;
  const knownDatabaseNames = ["signal-storage", "model-storage", "wawc_db_enc"];

  function redactText(value) {
    return String(value || "")
      .replace(/[0-9]{4,}/g, (match) => `<digits:${match.length}>`)
      .replace(/[A-Za-z0-9+/=_-]{80,}/g, (match) => `<encoded:${match.length}>`);
  }

  function isBytes(value) {
    return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
  }

  function byteLength(value) {
    if (value instanceof ArrayBuffer) {
      return value.byteLength;
    }
    if (ArrayBuffer.isView(value)) {
      return value.byteLength;
    }
    return 0;
  }

  function describeValue(value, depth = 0) {
    if (value == null || typeof value === "number" || typeof value === "boolean") {
      return { type: String(value), value };
    }
    if (typeof value === "string") {
      return { type: "string", length: value.length, preview: redactText(value.slice(0, 120)) };
    }
    if (value instanceof Date) {
      return { type: "Date", value: value.toISOString() };
    }
    if (isBytes(value)) {
      return { type: value.constructor ? value.constructor.name : "Bytes", byteLength: byteLength(value) };
    }
    if (Array.isArray(value)) {
      return {
        type: "Array",
        length: value.length,
        items: depth >= MAX_DEPTH ? [] : value.slice(0, MAX_SAMPLES).map((item) => describeValue(item, depth + 1))
      };
    }
    if (typeof value === "object") {
      const keys = Object.keys(value);
      const fields = {};
      if (depth < MAX_DEPTH) {
        for (const key of keys.slice(0, 20)) {
          fields[key] = describeValue(value[key], depth + 1);
        }
      }
      return { type: value.constructor ? value.constructor.name : "Object", keys: keys.slice(0, 40), fields };
    }
    return { type: typeof value };
  }

  function openDatabase(name) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error(`Falha ao abrir ${name}`));
      request.onblocked = () => reject(new Error(`Abertura bloqueada: ${name}`));
    });
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
    });
  }

  async function listDatabaseNames() {
    const discovered = new Set(knownDatabaseNames);
    if (typeof indexedDB.databases === "function") {
      const databases = await indexedDB.databases();
      for (const db of databases || []) {
        if (db && db.name) {
          discovered.add(db.name);
        }
      }
    }
    return Array.from(discovered).sort();
  }

  async function inspectStore(db, storeName) {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const count = await requestToPromise(store.count()).catch(() => null);
    const samples = [];
    await new Promise((resolve, reject) => {
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || samples.length >= MAX_SAMPLES) {
          resolve();
          return;
        }
        samples.push({
          key: describeValue(cursor.key),
          primaryKey: describeValue(cursor.primaryKey),
          value: describeValue(cursor.value)
        });
        cursor.continue();
      };
      request.onerror = () => reject(request.error || new Error(`Falha ao ler ${storeName}`));
    }).catch((error) => {
      samples.push({ error: error.message || String(error) });
    });
    return {
      name: storeName,
      count,
      keyPath: store.keyPath || null,
      autoIncrement: Boolean(store.autoIncrement),
      indexes: Array.from(store.indexNames || []),
      samples
    };
  }

  async function inspectDatabase(name) {
    const db = await openDatabase(name);
    try {
      const stores = [];
      for (const storeName of Array.from(db.objectStoreNames || [])) {
        stores.push(await inspectStore(db, storeName));
      }
      return { name, version: db.version, stores };
    } finally {
      db.close();
    }
  }

  async function run() {
    const localStorageKeys = Object.keys(localStorage || {}).sort();
    const indexedDBResults = [];
    for (const name of await listDatabaseNames()) {
      try {
        indexedDBResults.push(await inspectDatabase(name));
      } catch (error) {
        indexedDBResults.push({ name, error: error.message || String(error) });
      }
    }
    return {
      capturedAt: new Date().toISOString(),
      url: location.href,
      localStorageKeys: localStorageKeys.map(redactText),
      indexedDB: indexedDBResults
    };
  }

  return run()
    .then((inventory) => ({ inventory }))
    .catch((error) => ({ error: error.message || "Falha ao diagnosticar armazenamento" }));
}
