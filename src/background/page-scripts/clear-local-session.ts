// @ts-nocheck

// Serialized into the WhatsApp Web page; keep this function self-contained.
export function clearWhatsAppWebLocalSessionData() {
  function deleteDatabase(name) {
    return new Promise((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve({ name, deleted: true });
      request.onerror = () => resolve({ name, deleted: false, error: request.error ? request.error.message : "delete failed" });
      request.onblocked = () => resolve({ name, deleted: false, blocked: true });
    });
  }

  async function run() {
    const localStorageKeys = Object.keys(localStorage || {});
    const sessionStorageKeys = Object.keys(sessionStorage || {});
    localStorage.clear();
    sessionStorage.clear();

    let databaseNames = [];
    if (indexedDB.databases) {
      const databases = await indexedDB.databases();
      databaseNames = databases.map((database) => database && database.name).filter(Boolean);
    }
    for (const name of ["signal-storage", "model-storage", "wawc_db_enc"]) {
      if (!databaseNames.includes(name)) {
        databaseNames.push(name);
      }
    }
    const deletedDatabases = await Promise.all(databaseNames.map(deleteDatabase));

    let deletedCaches = [];
    if ("caches" in globalThis) {
      const cacheNames = await caches.keys();
      deletedCaches = await Promise.all(cacheNames.map(async (name) => ({ name, deleted: await caches.delete(name) })));
    }

    return {
      method: "page",
      localStorageKeys: localStorageKeys.length,
      sessionStorageKeys: sessionStorageKeys.length,
      indexedDB: deletedDatabases,
      caches: deletedCaches
    };
  }

  return run()
    .then((summary) => ({ summary }))
    .catch((error) => ({ error: error.message || "Falha ao limpar dados locais" }));
}
