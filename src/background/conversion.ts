// @ts-nocheck
import { IMPORT_HISTORY_CHAT_LIMIT } from "../shared/config";

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

function mergeByKey(existing, incoming, keyFn) {
  const out = [];
  const seen = new Set();
  for (const item of [...(existing || []), ...(incoming || [])]) {
    const key = keyFn(item);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
  }
  return out;
}

function mergeContactsByJID(existing, incoming) {
  const byJID = new Map();
  for (const item of [...(existing || []), ...(incoming || [])]) {
    const jid = normalizeHistoryJID(item?.jid);
    if (!jid) {
      continue;
    }
    const previous = byJID.get(jid);
    if (!previous) {
      byJID.set(jid, { ...item, jid });
      continue;
    }
    const merged = { ...previous, jid };
    for (const [key, value] of Object.entries(item)) {
      if (key === "jid" || value === undefined || value === null || String(value).trim() === "") {
        continue;
      }
      merged[key] = value;
    }
    byJID.set(jid, merged);
  }
  return Array.from(byJID.values());
}

function normalizeHistoryTimestampMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return numeric < 100000000000 ? Math.floor(numeric * 1000) : Math.floor(numeric);
}

function normalizeHistoryJID(value) {
  if (!value) {
    return "";
  }
  let raw = "";
  if (typeof value === "string") {
    raw = value;
  } else if (typeof value === "object") {
    if (typeof value._serialized === "string") {
      raw = value._serialized;
    } else if (typeof value.user === "string" && typeof value.server === "string") {
      raw = `${value.user}@${value.server}`;
    } else if (typeof value.toString === "function" && value.toString !== Object.prototype.toString) {
      const serialized = value.toString();
      if (typeof serialized === "string" && serialized.includes("@")) {
        raw = serialized;
      }
    }
  }
  const trimmed = String(raw || "").trim();
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

function historyJIDIdentityKey(value) {
  const jid = normalizeHistoryJID(value);
  const at = jid.lastIndexOf("@");
  if (at < 0) {
    return jid;
  }
  const server = jid.slice(at + 1);
  const user = jid.slice(0, at).replace(/:.+$/, "");
  return `${user}@${server}`;
}

function historyJIDMatchesAny(value, candidates) {
  const key = historyJIDIdentityKey(value);
  if (!key) {
    return false;
  }
  return candidates.some((candidate) => key === historyJIDIdentityKey(candidate));
}

function isPrivateHistoryJID(value) {
  const jid = normalizeHistoryJID(value);
  return jid.endsWith("@s.whatsapp.net") || jid.endsWith("@c.us") || jid.endsWith("@lid");
}

function historyJIDUser(value) {
  const jid = normalizeHistoryJID(value);
  const at = jid.lastIndexOf("@");
  if (at < 0) {
    return "";
  }
  return jid.slice(0, at).replace(/:.+$/, "");
}

function isLIDHistoryJID(value) {
  return normalizeHistoryJID(value).endsWith("@lid");
}

function isPNHistoryJID(value) {
  return normalizeHistoryJID(value).endsWith("@s.whatsapp.net");
}

function buildHistoryLIDToPNMap(contacts) {
  const out = new Map();
  for (const contact of Array.isArray(contacts) ? contacts : []) {
    const lid = normalizeHistoryJID(contact?.lid || (isLIDHistoryJID(contact?.jid) ? contact?.jid : ""));
    const pn = normalizeHistoryJID(contact?.jid || contact?.phoneNumber);
    if (!isLIDHistoryJID(lid) || !isPNHistoryJID(pn)) {
      continue;
    }
    const lidUser = historyJIDUser(lid);
    if (lidUser && !out.has(lidUser)) {
      out.set(lidUser, pn);
    }
  }
  return out;
}

function mapHistoryJIDWithLIDMap(value, lidToPN) {
  const jid = normalizeHistoryJID(value);
  if (!isLIDHistoryJID(jid) || !(lidToPN instanceof Map)) {
    return jid;
  }
  return lidToPN.get(historyJIDUser(jid)) || jid;
}

export function normalizeHistoryJIDsWithContactLIDMap(history, contacts) {
  if (!history || typeof history !== "object") {
    return history;
  }
  const lidToPN = buildHistoryLIDToPNMap(contacts);
  if (lidToPN.size === 0) {
    return history;
  }
  const chats = (Array.isArray(history.chats) ? history.chats : []).map((chat) => {
    const rawJid = normalizeHistoryJID(chat?.jid);
    const rawLid = normalizeHistoryJID(chat?.lid);
    const mappedJid = mapHistoryJIDWithLIDMap(rawJid, lidToPN);
    const lid = rawLid || (isLIDHistoryJID(rawJid) ? rawJid : "");
    return {
      ...chat,
      ...(mappedJid ? { jid: mappedJid } : {}),
      ...(lid ? { lid } : {})
    };
  });
  const messages = (Array.isArray(history.messages) ? history.messages : []).map((message) => {
    const chatJid = mapHistoryJIDWithLIDMap(message?.chatJid, lidToPN);
    const senderJid = mapHistoryJIDWithLIDMap(message?.senderJid, lidToPN);
    return {
      ...message,
      ...(chatJid ? { chatJid } : {}),
      ...(senderJid ? { senderJid } : {})
    };
  });
  return { ...history, chats, messages };
}

function historyBoolean(value) {
  return value === true || value === "true" || value === 1;
}

function historyPeerJIDFromEndpoints({ fromMe, fromJid, toJid, ownerJids }) {
  const from = normalizeHistoryJID(fromJid);
  const to = normalizeHistoryJID(toJid);
  const owners = (Array.isArray(ownerJids) ? ownerJids : []).map(normalizeHistoryJID).filter(Boolean);
  if (owners.length > 0) {
    const fromIsOwner = historyJIDMatchesAny(from, owners);
    const toIsOwner = historyJIDMatchesAny(to, owners);
    if (fromIsOwner && to && !toIsOwner) {
      return to;
    }
    if (toIsOwner && from && !fromIsOwner) {
      return from;
    }
  }
  return historyBoolean(fromMe) ? (to || from) : (from || to);
}

function repairedHistoryWebMessage(message, chatJid, senderJid) {
  const webMessage = message?.webMessage;
  if (!webMessage || typeof webMessage !== "object" || Array.isArray(webMessage)) {
    return webMessage;
  }
  const output = { ...webMessage };
  const key = webMessage.key && typeof webMessage.key === "object" && !Array.isArray(webMessage.key)
    ? { ...webMessage.key }
    : {};
  if (Object.keys(key).length > 0) {
    key.remoteJID = chatJid;
    key.fromMe = historyBoolean(message.fromMe);
    if (message.id) {
      key.ID = message.id;
    }
    if (chatJid.endsWith("@g.us") && senderJid) {
      key.participant = senderJid;
    } else {
      delete key.participant;
    }
    output.key = key;
  }
  if (chatJid.endsWith("@g.us") && senderJid) {
    output.participant = senderJid;
  } else {
    delete output.participant;
  }
  return output;
}

function repairHistoryPeerJids(history, ownerJids) {
  if (!history || typeof history !== "object") {
    return history;
  }
  const owners = (Array.isArray(ownerJids) ? ownerJids : [ownerJids]).map(normalizeHistoryJID).filter(Boolean);
  if (owners.length === 0) {
    return history;
  }
  const messages = (Array.isArray(history.messages) ? history.messages : []).map((message) => {
    if (!message || typeof message !== "object") {
      return message;
    }
    const sourceFromJid = normalizeHistoryJID(message._sourceFromJid || message.sourceFromJid);
    const sourceToJid = normalizeHistoryJID(message._sourceToJid || message.sourceToJid);
    const fromMe = historyBoolean(message.fromMe);
    const peerJid = historyPeerJIDFromEndpoints({
      fromMe,
      fromJid: sourceFromJid,
      toJid: sourceToJid,
      ownerJids: owners
    });
    let chatJid = normalizeHistoryJID(message.chatJid);
    const shouldUsePeer = peerJid &&
      !historyJIDMatchesAny(peerJid, owners) &&
      (!chatJid || historyJIDMatchesAny(chatJid, owners));
    if (shouldUsePeer) {
      chatJid = peerJid;
    }

    let senderJid = normalizeHistoryJID(message.senderJid);
    if (!fromMe && isPrivateHistoryJID(chatJid) && (!senderJid || historyJIDMatchesAny(senderJid, owners))) {
      senderJid = chatJid;
    }

    const repaired = {
      ...message,
      chatJid,
      senderJid,
      fromMe,
      webMessage: repairedHistoryWebMessage({ ...message, chatJid, senderJid, fromMe }, chatJid, senderJid)
    };
    delete repaired._sourceFromJid;
    delete repaired._sourceToJid;
    delete repaired.sourceFromJid;
    delete repaired.sourceToJid;
    return repaired;
  });
  return { ...history, messages };
}

function limitHistoryAnchors(history, limit = IMPORT_HISTORY_CHAT_LIMIT) {
  // History exported from WhatsApp Web is not a reliable full backup. The page
  // may have only a window of messages loaded, fields change often, and media or
  // quoted payloads may be partial. We keep one latest message per chat as an
  // anchor so the backend can later ask its WhatsApp library to load history
  // from that point using its own "load before/after anchor" APIs.
  if (!history || typeof history !== "object") {
    return history;
  }
  const rawChats = Array.isArray(history.chats) ? history.chats : [];
  const rawMessages = Array.isArray(history.messages) ? history.messages : [];
  const latestMessageByChat = new Map();
  const messagesByChat = new Map();
  const seenMessages = new Set();

  for (const message of rawMessages) {
    const chatJid = String(message?.chatJid || "").trim();
    const id = String(message?.id || "").trim();
    if (!chatJid || !id) {
      continue;
    }
    const messageKey = `${chatJid}\u0000${id}`;
    if (seenMessages.has(messageKey)) {
      continue;
    }
    seenMessages.add(messageKey);
    const normalized = { ...message, id, chatJid, timestampMs: normalizeHistoryTimestampMs(message.timestampMs) };
    if (!messagesByChat.has(chatJid)) {
      messagesByChat.set(chatJid, []);
    }
    messagesByChat.get(chatJid).push(normalized);
    const existing = latestMessageByChat.get(chatJid);
    if (!existing || normalized.timestampMs > Number(existing.timestampMs || 0)) {
      latestMessageByChat.set(chatJid, normalized);
    }
  }

  const chatByJid = new Map();
  for (const chat of rawChats) {
    const jid = String(chat?.jid || "").trim();
    if (!jid) {
      continue;
    }
    const normalized = {
      ...chat,
      jid,
      lid: String(chat?.lid || "").trim(),
      lastMessageTimestampMs: normalizeHistoryTimestampMs(chat.lastMessageTimestampMs)
    };
    const existing = chatByJid.get(jid);
    if (!existing || normalized.lastMessageTimestampMs > normalizeHistoryTimestampMs(existing.lastMessageTimestampMs)) {
      chatByJid.set(jid, normalized);
    }
  }

  const hasChatForMessageJID = (jid) => {
    if (chatByJid.has(jid)) {
      return true;
    }
    for (const chat of chatByJid.values()) {
      if (String(chat?.lid || "").trim() === jid) {
        return true;
      }
    }
    return false;
  };

  for (const message of latestMessageByChat.values()) {
    if (!hasChatForMessageJID(message.chatJid)) {
      chatByJid.set(message.chatJid, {
        jid: message.chatJid,
        isGroup: message.chatJid.endsWith("@g.us"),
        lastMessageTimestampMs: normalizeHistoryTimestampMs(message.timestampMs)
      });
    }
  }

  const latestMessageForChat = (chat) => {
    let latest = null;
    for (const chatKey of [chat?.jid, chat?.lid].filter(Boolean)) {
      const candidate = latestMessageByChat.get(chatKey);
      if (!candidate) {
        continue;
      }
      if (!latest || Number(candidate.timestampMs || 0) > Number(latest.timestampMs || 0)) {
        latest = candidate;
      }
    }
    return latest;
  };

  const chats = Array.from(chatByJid.values()).filter((chat) =>
    [chat.jid, chat.lid].filter(Boolean).some((chatKey) => messagesByChat.has(chatKey))
  );
  chats.sort((left, right) => {
    const leftMessage = latestMessageForChat(left);
    const rightMessage = latestMessageForChat(right);
    const leftTimestamp = Math.max(
      normalizeHistoryTimestampMs(left.lastMessageTimestampMs),
      Number(leftMessage?.timestampMs || 0)
    );
    const rightTimestamp = Math.max(
      normalizeHistoryTimestampMs(right.lastMessageTimestampMs),
      Number(rightMessage?.timestampMs || 0)
    );
    return rightTimestamp - leftTimestamp;
  });

  const selectedChats = chats.slice(0, Math.max(0, limit));
  const selectedMessages = [];
  const selectedMessageKeys = new Set();
  for (const chat of selectedChats) {
    // Send only the latest message for each selected chat. Sending every message
    // found in the browser would look more complete, but it is less honest: the
    // browser cache is sparse and can create gaps. A single anchor is enough for
    // server-side libraries to page backward/forward from a known point.
    const message = latestMessageForChat(chat);
    if (!message) {
      continue;
    }
    const messageKey = `${message.chatJid}\u0000${message.id}`;
    if (!selectedMessageKeys.has(messageKey)) {
      selectedMessageKeys.add(messageKey);
      selectedMessages.push(message);
    }
  }
  selectedMessages.sort((left, right) => Number(right.timestampMs || 0) - Number(left.timestampMs || 0));

  return { chats: selectedChats, messages: selectedMessages };
}

function bytesToBase64Browser(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (value instanceof Uint8Array) {
    let binary = "";
    const step = 0x8000;
    for (let index = 0; index < value.length; index += step) {
      binary += String.fromCharCode.apply(null, value.subarray(index, index + step));
    }
    return btoa(binary);
  }
  if (Array.isArray(value)) {
    return bytesToBase64Browser(new Uint8Array(value));
  }
  if (value && value.type === "Buffer") {
    if (typeof value.data === "string") {
      return value.data.trim();
    }
    if (Array.isArray(value.data)) {
      return bytesToBase64Browser(new Uint8Array(value.data));
    }
  }
  return "";
}

function normalizeContactPhoneJID(value) {
  const jid = normalizeHistoryJID(value);
  if (!jid) {
    return "";
  }
  if (jid.endsWith("@s.whatsapp.net")) {
    return jid;
  }
  if (jid.includes("@")) {
    return "";
  }
  const digits = jid.replace(/\D/g, "");
  return digits ? `${digits}@s.whatsapp.net` : "";
}

export function normalizeContactForWhatsmeow(row) {
  const rawJid = normalizeHistoryJID(row?.jid || row?.id);
  const phoneJid = normalizeContactPhoneJID(row?.phoneNumber);
  const jid = phoneJid || rawJid;
  if (!jid) {
    return null;
  }
  const rawLid = normalizeHistoryJID(row?.lid || row?.accountLid);
  const lid = rawLid || (rawJid.endsWith("@lid") ? rawJid : "");
  return {
    jid,
    ...(lid ? { lid } : {}),
    ...((row.firstName || row.shortName || row.formattedShortName) ? { firstName: String(row.firstName || row.shortName || row.formattedShortName).trim() } : {}),
    ...((row.fullName || row.displayName || row.name || row.formattedName || row.formattedTitle) ? { fullName: String(row.fullName || row.displayName || row.name || row.formattedName || row.formattedTitle).trim() } : {}),
    ...((row.pushName || row.pushname || row.notifyName || row.notify || row.senderName) ? { pushName: String(row.pushName || row.pushname || row.notifyName || row.notify || row.senderName).trim() } : {}),
    ...((row.businessName || row.verifiedName || row.verifiedNameForDisplay || row.displayBusinessName) ? { businessName: String(row.businessName || row.verifiedName || row.verifiedNameForDisplay || row.displayBusinessName).trim() } : {}),
    ...(row.redactedPhone ? { redactedPhone: String(row.redactedPhone).trim() } : {})
  };
}

function normalizePrivacyTokenForWhatsmeow(row) {
  const userJid = String(row?.userJid || row?.jid || "").trim();
  const token = bytesToBase64Browser(row?.token);
  const timestampS = Number.isFinite(row?.timestampS)
    ? Math.floor(row.timestampS)
    : Math.floor(Number(row?.timestampMs || 0) / 1000);
  if (!userJid || !token || !timestampS) {
    return null;
  }
  const senderTimestampS = Number.isFinite(row?.senderTimestampS)
    ? Math.floor(row.senderTimestampS)
    : Number.isFinite(row?.senderTimestampMs)
      ? Math.floor(row.senderTimestampMs / 1000)
      : undefined;
  return {
    userJid,
    token,
    timestampS,
    ...(senderTimestampS ? { senderTimestampS } : {})
  };
}

function normalizeRows(source, key, mapper) {
  const rows = Array.isArray(source?.[key]) ? source[key] : [];
  return rows.map(mapper).filter(Boolean);
}

function attachSidecarPayload(whatsmeowPayload, sidecar, waWebDump) {
  const output = { ...whatsmeowPayload };
  const sources = [sidecar, waWebDump].filter(Boolean);

  const baseContacts = normalizeRows(output, "contacts", normalizeContactForWhatsmeow);
  const contacts = sources.flatMap((source) => normalizeRows(source, "contacts", normalizeContactForWhatsmeow));
  if (baseContacts.length > 0 || contacts.length > 0) {
    output.contacts = mergeContactsByJID(baseContacts, contacts);
  }

  const basePrivacyTokens = normalizeRows(output, "privacyTokens", normalizePrivacyTokenForWhatsmeow);
  const privacyTokens = sources.flatMap((source) => normalizeRows(source, "privacyTokens", normalizePrivacyTokenForWhatsmeow));
  if (basePrivacyTokens.length > 0 || privacyTokens.length > 0) {
    output.privacyTokens = mergeByKey(basePrivacyTokens, privacyTokens, (item) => item.userJid);
  }

  const history = firstDefined(...sources.map((source) => source.history));
  if (history && typeof history === "object") {
    const repairedHistory = limitHistoryAnchors(repairHistoryPeerJids(history, [
      output.device?.meJid,
      output.device?.meLid,
      ...sources.flatMap((source) => [source.device?.meJid, source.device?.meLid])
    ]));
    output.history = normalizeHistoryJIDsWithContactLIDMap(repairedHistory, output.contacts);
  }

  const nctSalt = firstDefined(...sources.map((source) => source.nctSalt));
  if (typeof nctSalt === "string" && nctSalt.trim()) {
    output.nctSalt = nctSalt.trim();
  }
  delete output.deviceLists;
  delete output.lidMappings;
  return output;
}

export function buildWhatsmeowPayload(mainDump, sidecar) {
  if (!globalThis.WAStoreMigrate) {
    throw new Error("Conversor wa-store-migrate não carregado");
  }
  const waWebDump = WAStoreMigrate.coerceBufferJson(mainDump);
  const migrated = WAStoreMigrate.migrate({
    from: "wa-web",
    to: "whatsmeow",
    data: waWebDump,
    validate: false
  });
  return {
    payload: attachSidecarPayload(WAStoreMigrate.snapshot.toJSON("whatsmeow", migrated.snapshot), sidecar, waWebDump),
    losses: migrated.losses
  };
}
