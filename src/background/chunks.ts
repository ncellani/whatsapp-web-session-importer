import { IMPORT_CHUNK_ITEMS } from "../shared/config";
import type { ExpectedImportRows, ImportChunk } from "../shared/types";

export function countRows(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

export function appStateCollectionVersionKey(value: any): string {
  const collection = String(value?.collection || "").trim();
  const version = Number(value?.version || 0);
  if (!collection || !Number.isFinite(version) || version <= 0) {
    return "";
  }
  return `${collection}\u0000${Math.floor(version)}`;
}

export function countAppStateMutationMacsWithVersions(payload: any): number {
  const versionKeys = new Set(
    (Array.isArray(payload?.appStateVersions) ? payload.appStateVersions : [])
      .map(appStateCollectionVersionKey)
      .filter(Boolean)
  );
  if (versionKeys.size === 0) {
    return 0;
  }
  return (Array.isArray(payload?.appStateMutationMacs) ? payload.appStateMutationMacs : [])
    .filter((mac) => versionKeys.has(appStateCollectionVersionKey(mac))).length;
}

export function countExpectedRows(payload: any): ExpectedImportRows {
  // These counts are sent in /start before chunks. The backend uses them as a
  // cheap contract check: it knows what it should receive before /finish.
  return {
    preKeys: countRows(payload.preKeys),
    identityKeys: countRows(payload.identities),
    sessions: countRows(payload.sessions),
    senderKeys: countRows(payload.senderKeys),
    appStateSyncKeys: countRows(payload.appStateSyncKeys),
    appStateVersions: countRows(payload.appStateVersions),
    appStateMutationMACs: countAppStateMutationMacsWithVersions(payload),
    contacts: countRows(payload.contacts),
    privacyTokens: countRows(payload.privacyTokens),
    nctSalt: payload.nctSalt ? 1 : 0,
    validatedHistoryChats: countRows(payload.history?.chats),
    validatedHistoryMessages: countRows(payload.history?.messages)
  };
}

export function pushArrayChunks(
  chunks: ImportChunk[],
  section: string,
  key: string,
  rows: any[],
  limit: number = IMPORT_CHUNK_ITEMS
): void {
  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }
  for (let index = 0; index < rows.length; index += limit) {
    const slice = rows.slice(index, index + limit);
    chunks.push({ section, count: slice.length, payload: { [key]: slice } });
  }
}

export function pushHistoryChunks(
  chunks: ImportChunk[],
  section: string,
  key: string,
  rows: any[],
  limit: number = IMPORT_CHUNK_ITEMS
): void {
  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }
  for (let index = 0; index < rows.length; index += limit) {
    const slice = rows.slice(index, index + limit);
    chunks.push({ section, count: slice.length, payload: { history: { [key]: slice } } });
  }
}

export function buildAppStateChunks(payload: any): ImportChunk[] {
  // App-state MACs are only meaningful with their matching collection version.
  // Send them together so the backend can persist an internally consistent state.
  const versions = Array.isArray(payload.appStateVersions) ? payload.appStateVersions : [];
  const macs = Array.isArray(payload.appStateMutationMacs) ? payload.appStateMutationMacs : [];
  if (versions.length === 0 && macs.length === 0) {
    return [];
  }
  const macsByVersion = new Map<string, any[]>();
  for (const mac of macs) {
    const key = appStateCollectionVersionKey(mac);
    if (!key) {
      continue;
    }
    if (!macsByVersion.has(key)) {
      macsByVersion.set(key, []);
    }
    macsByVersion.get(key)?.push(mac);
  }
  if (versions.length === 0) {
    return [];
  }
  return versions.map((version) => {
    const key = appStateCollectionVersionKey(version);
    const versionMacs = macsByVersion.get(key) || [];
    return {
      section: "appState",
      count: 1 + versionMacs.length,
      payload: { appStateVersions: [version], appStateMutationMacs: versionMacs }
    };
  });
}

export function buildImportChunks(payload: any): ImportChunk[] {
  // Chunk order is intentional: identity/session material first, then app-state,
  // contacts, optional tokens, and finally history anchors.
  const chunks: ImportChunk[] = [];
  pushArrayChunks(chunks, "sessions", "sessions", payload.sessions);
  pushArrayChunks(chunks, "identities", "identities", payload.identities);
  pushArrayChunks(chunks, "senderKeys", "senderKeys", payload.senderKeys);
  pushArrayChunks(chunks, "preKeys", "preKeys", payload.preKeys);
  pushArrayChunks(chunks, "appStateSyncKeys", "appStateSyncKeys", payload.appStateSyncKeys);
  chunks.push(...buildAppStateChunks(payload));
  pushArrayChunks(chunks, "contacts", "contacts", payload.contacts);
  pushArrayChunks(chunks, "privacyTokens", "privacyTokens", payload.privacyTokens);
  if (payload.nctSalt) {
    chunks.push({ section: "nctSalt", count: 1, payload: { nctSalt: payload.nctSalt } });
  }
  pushHistoryChunks(chunks, "historyChats", "chats", payload.history?.chats);
  pushHistoryChunks(chunks, "historyMessages", "messages", payload.history?.messages);
  return chunks;
}
