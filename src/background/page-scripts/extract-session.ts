// @ts-nocheck

// Serialized into the WhatsApp Web page; keep this function self-contained.
export function extractWhatsAppWebMainDump(options = {}) {
  function bytesToB64(bytes) {
    if (!bytes) {
      return null;
    }
    let u;
    if (bytes instanceof Uint8Array) {
      u = bytes;
    } else if (bytes instanceof ArrayBuffer) {
      u = new Uint8Array(bytes);
    } else if (typeof bytes === "string") {
      u = Uint8Array.from(bytes, (c) => c.charCodeAt(0));
    } else {
      return null;
    }
    const chunks = [];
    const step = 0x8000;
    for (let i = 0; i < u.length; i += step) {
      chunks.push(String.fromCharCode.apply(null, u.subarray(i, i + step)));
    }
    return btoa(chunks.join(""));
  }

  function bufWrap(bytes) {
    const data = bytesToB64(bytes);
    return data == null ? null : { type: "Buffer", data };
  }

  function deepBufWrap(value) {
    if (value == null) {
      return value;
    }
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
      return bufWrap(value);
    }
    if (Array.isArray(value)) {
      return value.map(deepBufWrap);
    }
    if (typeof value === "object") {
      const out = {};
      for (const key of Object.keys(value)) {
        if (key !== "$$unknownFieldCount") {
          out[key] = deepBufWrap(value[key]);
        }
      }
      return out;
    }
    return value;
  }

  function openDatabase(name) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error(`Falha ao abrir ${name}`));
      request.onblocked = () => reject(new Error(`Abertura bloqueada: ${name}`));
    });
  }

  function getAll(db, storeName) {
    return new Promise((resolve, reject) => {
      if (!Array.from(db.objectStoreNames || []).includes(storeName)) {
        resolve([]);
        return;
      }
      const tx = db.transaction(storeName, "readonly");
      const request = tx.objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error(`Falha ao ler ${storeName}`));
    });
  }

  async function decryptRegMaterial(value) {
    if (!value || !value.encKey || !value.value) {
      return null;
    }
    const counter = new Uint8Array(16);
    const cipher = value.value instanceof Uint8Array ? value.value : new Uint8Array(value.value);
    const plain = await crypto.subtle.decrypt({ name: "AES-CTR", length: 128, counter }, value.encKey, cipher);
    return new Uint8Array(plain);
  }

  function getWaModule(name) {
    try {
      if (typeof globalThis.require === "function") {
        return globalThis.require(name);
      }
    } catch {}
    try {
      if (typeof __d === "function") {
        let captured;
        const sentinel = `__waDumpProbe_${Math.random().toString(36).slice(2)}`;
        __d(sentinel, [name], function (_target, _namespace, _require, moduleRequire) {
          captured = moduleRequire(name);
        });
        if (!captured && typeof __d.require === "function") {
          captured = __d.require(name);
        }
        if (captured) {
          return captured;
        }
      }
    } catch {}
    return null;
  }

  async function getNoiseInfoViaInternalModule() {
    const infoStore = getWaModule("WAWebUserPrefsInfoStore");
    if (!infoStore || !infoStore.waNoiseInfo || typeof infoStore.waNoiseInfo.get !== "function") {
      return null;
    }
    try {
      const decrypted = await infoStore.waNoiseInfo.get();
      if (!decrypted || !decrypted.staticKeyPair) {
        return null;
      }
      return {
        pubKey: new Uint8Array(decrypted.staticKeyPair.pubKey),
        privKey: new Uint8Array(decrypted.staticKeyPair.privKey)
      };
    } catch (error) {
      console.warn("[wa-web-dump] internal noise lookup failed", error);
      return null;
    }
  }

  async function getNoiseInfoFallback() {
    const saltJson = localStorage.getItem("WAWebEncKeySalt");
    const noiseJson = localStorage.getItem("WANoiseInfo");
    const ivJson = localStorage.getItem("WANoiseInfoIv");
    if (!saltJson || !noiseJson || !ivJson) {
      return null;
    }

    const saltBytes = Uint8Array.from(atob(JSON.parse(saltJson)), (c) => c.charCodeAt(0));
    const noiseObj = JSON.parse(noiseJson);
    const ivs = JSON.parse(ivJson).map((value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0)));
    const encPub = Uint8Array.from(atob(noiseObj.pubKey), (c) => c.charCodeAt(0));
    const encPriv = Uint8Array.from(atob(noiseObj.privKey), (c) => c.charCodeAt(0));
    const db = await openDatabase("wawc_db_enc");
    const baseRows = await getAll(db, "keys");
    db.close();

    for (const row of baseRows || []) {
      try {
        const aesKey = await crypto.subtle.deriveKey(
          { name: "HKDF", hash: "SHA-256", salt: saltBytes, info: new Uint8Array(1) },
          row.key,
          { name: "AES-CBC", length: 128 },
          false,
          ["decrypt"]
        );
        const pub = await crypto.subtle.decrypt({ name: "AES-CBC", iv: ivs[1] }, aesKey, encPub);
        const priv = await crypto.subtle.decrypt({ name: "AES-CBC", iv: ivs[2] }, aesKey, encPriv);
        return { pubKey: new Uint8Array(pub), privKey: new Uint8Array(priv) };
      } catch {}
    }
    return null;
  }

  async function getNoiseKey() {
    return (await getNoiseInfoViaInternalModule()) || (await getNoiseInfoFallback());
  }

  function parseAddress(addr) {
    const raw = String(addr || "");
    const dot = raw.lastIndexOf(".");
    const head = dot >= 0 ? raw.slice(0, dot) : raw;
    const parsedDevice = dot >= 0 ? Number(raw.slice(dot + 1)) : 0;
    const jid = head.includes("@") ? head : `${head}@s.whatsapp.net`;
    return { jid, device: Number.isFinite(parsedDevice) ? parsedDevice : 0 };
  }

  function parseSenderKeyName(name) {
    const raw = String(name || "");
    const sep = raw.indexOf("::");
    if (sep < 0) {
      return null;
    }
    const groupId = raw.slice(0, sep);
    const senderPart = raw.slice(sep + 2);
    const parsed = parseAddress(senderPart);
    return { groupId, senderJid: parsed.jid, senderDevice: parsed.device };
  }

  async function getModelTable(schemaModuleName, tableGetterName) {
    const mod = getWaModule(schemaModuleName);
    const getter = mod && mod[tableGetterName];
    if (typeof getter !== "function") {
      return [];
    }
    try {
      const rows = await getter().all();
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      console.warn(`[wa-web-dump] ${schemaModuleName}.${tableGetterName}().all() failed`, error);
      return [];
    }
  }

  function toUint8(value) {
    if (value == null) {
      return null;
    }
    if (value instanceof Uint8Array) {
      return value;
    }
    if (value instanceof ArrayBuffer) {
      return new Uint8Array(value);
    }
    if (typeof value === "object" && value.buffer instanceof ArrayBuffer) {
      return new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength || value.buffer.byteLength);
    }
    if (typeof value === "string") {
      return Uint8Array.from(value, (c) => c.charCodeAt(0));
    }
    return null;
  }

  function timestampMs(value) {
    if (!Number.isFinite(value) || value <= 0) {
      return 0;
    }
    return value < 100000000000 ? Math.floor(value * 1000) : Math.floor(value);
  }

  function normalizeWhatsAppUserJID(value) {
    const trimmed = String(value || "").trim();
    const at = trimmed.lastIndexOf("@");
    if (at < 0) {
      return trimmed;
    }
    const server = trimmed.slice(at + 1);
    if (server === "c.us") {
      return `${trimmed.slice(0, at)}@s.whatsapp.net`;
    }
    return trimmed;
  }

  function jidToString(value) {
    if (!value) {
      return "";
    }
    if (typeof value === "string") {
      return normalizeWhatsAppUserJID(value);
    }
    if (typeof value === "object") {
      if (typeof value._serialized === "string") {
        return normalizeWhatsAppUserJID(value._serialized);
      }
      if (typeof value.user === "string" && typeof value.server === "string") {
        return normalizeWhatsAppUserJID(`${value.user}@${value.server}`);
      }
    }
    return "";
  }

  function widToJid(wid) {
    if (!wid || typeof wid !== "string") {
      return null;
    }
    const at = wid.lastIndexOf("@");
    const head = at >= 0 ? wid.slice(0, at) : wid;
    const server = at >= 0 ? wid.slice(at + 1) : "s.whatsapp.net";
    const colon = head.indexOf(":");
    const userAndAgent = colon >= 0 ? head.slice(0, colon) : head;
    const device = colon >= 0 ? Number(head.slice(colon + 1)) : 0;
    const dot = userAndAgent.indexOf(".");
    const user = dot >= 0 ? userAndAgent.slice(0, dot) : userAndAgent;
    return `${user}:${Number.isFinite(device) ? device : 0}@${server}`;
  }

  function readJSONLocalStorage(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch {
      return null;
    }
  }

  function downloadInPage(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function run() {
    const includeContacts = options.includeContacts !== false;
    const signalDB = await openDatabase("signal-storage");
    const [meta, identity, prekey, signedPrekey, session, senderkey] = await Promise.all([
      getAll(signalDB, "signal-meta-store"),
      getAll(signalDB, "identity-store"),
      getAll(signalDB, "prekey-store"),
      getAll(signalDB, "signed-prekey-store"),
      getAll(signalDB, "session-store"),
      getAll(signalDB, "senderkey-store")
    ]);
    signalDB.close();

    const metaMap = {};
    for (const row of meta) {
      metaMap[row.key] = row.value;
    }

    const staticPub = await decryptRegMaterial(metaMap.signal_static_pubkey);
    const staticPriv = await decryptRegMaterial(metaMap.signal_static_privkey);
    const noise = await getNoiseKey();
    const advSignedIdentity = metaMap.adv_signed_identity ? deepBufWrap(metaMap.adv_signed_identity) : null;

    const [
      syncKeysRows,
      collectionVersionRows,
      syncActionsRows,
      contactRows,
      tcTokenRows,
      userPrefsRows
    ] = await Promise.all([
      getModelTable("WAWebSchemaSyncKeys", "getSyncKeysTable"),
      getModelTable("WAWebSchemaCollectionVersion", "getCollectionVersionTable"),
      getModelTable("WAWebSchemaSyncActions", "getSyncActionsTable"),
      includeContacts ? getModelTable("WAWebSchemaContact_DO_NOT_USE_DIRECTLY", "getContactTable") : Promise.resolve([]),
      getModelTable("WAWebSchemaOrphanTcToken", "getOrphanTcTokenTable"),
      getModelTable("WAWebSchemaUserPrefs", "getUserPrefsTable")
    ]);

    const userPrefs = {};
    for (const row of userPrefsRows) {
      if (row && row.key) {
        userPrefs[String(row.key)] = row.value;
      }
    }
    if (userPrefsRows.length === 0) {
      try {
        const modelDB = await openDatabase("model-storage");
        const rows = await getAll(modelDB, "user-prefs");
        for (const row of rows) {
          if (row && row.key) {
            userPrefs[String(row.key)] = row.value;
          }
        }
        modelDB.close();
      } catch (error) {
        console.warn("[wa-web-dump] user-prefs raw fallback failed", error);
      }
    }

    let advSecretKey = null;
    try {
      const value = await (getWaModule("WAWebUserPrefsMultiDevice") || {}).getADVSecretKey?.();
      if (typeof value === "string") {
        advSecretKey = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
      } else if (value) {
        advSecretKey = toUint8(value);
      }
    } catch {}

    const appStateSyncKeys = syncKeysRows
      .map((row) => {
        const keyId = toUint8(row.keyId);
        const keyData = toUint8(row.keyData);
        if (!keyId || !keyData) {
          return null;
        }
        return {
          keyId: bufWrap(keyId),
          keyData: bufWrap(keyData),
          timestamp: row.timestamp || 0,
          ...(row.fingerprint ? { fingerprint: row.fingerprint } : {}),
          ...(row.keyEpoch !== undefined ? { keyEpoch: row.keyEpoch } : {})
        };
      })
      .filter(Boolean);

    const indexValueByCollection = new Map();
    for (const action of syncActionsRows) {
      const indexMac = toUint8(action.indexMac);
      const valueMac = toUint8(action.valueMac);
      if (!action.collection || !indexMac || !valueMac) {
        continue;
      }
      const map = indexValueByCollection.get(action.collection) || {};
      map[bytesToB64(indexMac)] = bufWrap(valueMac);
      indexValueByCollection.set(action.collection, map);
    }

    const appStateVersions = collectionVersionRows
      .map((row) => {
        const hash = toUint8(row.ltHash);
        if (!row.collection || !hash) {
          return null;
        }
        return {
          collection: row.collection,
          version: row.version || 0,
          hash: bufWrap(hash),
          indexValueMap: indexValueByCollection.get(row.collection) || {}
        };
      })
      .filter(Boolean);

    const contacts = contactRows
      .map((row) => {
        const jid = jidToString(row.id);
        if (!jid) {
          return null;
        }
        const lid = jidToString(row.lid || row.accountLid);
        return {
          jid,
          ...(lid ? { lid } : {}),
          ...(row.name ? { displayName: String(row.name) } : {}),
          ...(row.pushname ? { pushName: String(row.pushname) } : {}),
          ...(row.verifiedName ? { verifiedName: String(row.verifiedName) } : {}),
          ...(row.phoneNumber ? { phoneNumber: jidToString(row.phoneNumber) || String(row.phoneNumber) } : {})
        };
      })
      .filter(Boolean);

    const privacyTokens = tcTokenRows
      .map((row) => {
        const token = toUint8(row.tcToken);
        const jid = jidToString(row.chatId || row.id);
        if (!jid || !token) {
          return null;
        }
        return {
          jid,
          token: bufWrap(token),
          timestampMs: timestampMs(row.tcTokenTimestamp || row.timestampMs || row.timestamp)
        };
      })
      .filter(Boolean);

    const signedPreKeyRow = signedPrekey[signedPrekey.length - 1] || null;
    const dump = {
      device: {
        registrationId: metaMap.signal_reg_id || null,
        noiseKey: noise ? { pubKey: bufWrap(noise.pubKey), privKey: bufWrap(noise.privKey) } : null,
        identityKey:
          staticPub && staticPriv ? { pubKey: bufWrap(staticPub), privKey: bufWrap(staticPriv) } : null,
        signedPreKey: signedPreKeyRow
          ? {
              keyId: signedPreKeyRow.keyId,
              keyPair: {
                pubKey: bufWrap(signedPreKeyRow.keyPair.pubKey),
                privKey: bufWrap(signedPreKeyRow.keyPair.privKey)
              },
              signature: bufWrap(signedPreKeyRow.signature)
            }
          : null,
        advSecretKey: advSecretKey ? bufWrap(advSecretKey) : bufWrap(new Uint8Array(0)),
        account: advSignedIdentity,
        meJid: widToJid(readJSONLocalStorage("last-wid-md")),
        meLid: widToJid(readJSONLocalStorage("WALid")),
        pushName: readJSONLocalStorage("me-display-name") || "",
        platform: "web"
      },
      preKeys: prekey.map((row) => ({
        keyId: row.keyId,
        keyPair: { pubKey: bufWrap(row.keyPair.pubKey), privKey: bufWrap(row.keyPair.privKey) },
        uploaded: Boolean(row.uploaded)
      })),
      identities: identity.map((row) => {
        const parsed = parseAddress(row.identifier);
        return { jid: parsed.jid, device: parsed.device, identityKey: bufWrap(row.identityKey) };
      }),
      sessions: session.map((row) => {
        const parsed = parseAddress(row.address);
        return { jid: parsed.jid, device: parsed.device, session: deepBufWrap(row.session) };
      }),
      senderKeys: senderkey
        .map((row) => {
          const parsed = parseSenderKeyName(row.senderKeyName);
          if (!parsed) {
            return null;
          }
          return {
            groupId: parsed.groupId,
            senderJid: parsed.senderJid,
            senderDevice: parsed.senderDevice,
            record: deepBufWrap(row.senderKey)
          };
        })
        .filter(Boolean),
      appStateSyncKeys,
      appStateVersions,
      privacyTokens,
      contacts
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `wa-web-dump-${timestamp}.json`;
    if (options.download !== false) {
      downloadInPage(filename, dump);
    }
    window.__waWebDumpResult = dump;

    const result = {
      filename,
      meJid: dump.device.meJid,
      meLid: dump.device.meLid,
      hasNoiseKey: Boolean(dump.device.noiseKey),
      hasIdentityKey: Boolean(dump.device.identityKey),
      hasSignedPreKey: Boolean(dump.device.signedPreKey),
      preKeys: dump.preKeys.length,
      identities: dump.identities.length,
      sessions: dump.sessions.length,
      senderKeys: dump.senderKeys.length,
      appStateSyncKeys: dump.appStateSyncKeys.length,
      appStateVersions: dump.appStateVersions.length,
      privacyTokens: dump.privacyTokens.length,
      contacts: dump.contacts.length
    };
    if (options.includeDump) {
      result.dump = dump;
    }
    return result;
  }

  return run()
    .then((dump) => ({ dump }))
    .catch((error) => ({ error: error.message || "Falha ao capturar sessão" }));
}
