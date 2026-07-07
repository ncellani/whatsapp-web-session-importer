import { AUTOFILL_PARAMS, CLIENT_BASE_DOMAIN, WHATSAPP_WEB_ORIGIN } from "./config";

export interface AutofillHash {
  client: string;
  token: string;
  hasClient: boolean;
  hasToken: boolean;
  includeHistory?: boolean;
  hideHistoryOption?: boolean;
  lockHistoryOption?: boolean;
  hideClientField?: boolean;
  hideTokenField?: boolean;
  lockClientField?: boolean;
  lockTokenField?: boolean;
  panelLayout?: "corner" | "center";
}

const AUTOFILL_PARAM_GROUPS = {
  client: [AUTOFILL_PARAMS.client],
  token: [AUTOFILL_PARAMS.token],
  includeHistory: [
    AUTOFILL_PARAMS.includeHistory,
    AUTOFILL_PARAMS.history,
    AUTOFILL_PARAMS.historico
  ],
  hideHistoryOption: [
    AUTOFILL_PARAMS.hideHistoryOption,
    AUTOFILL_PARAMS.hideHistory
  ],
  lockHistoryOption: [
    AUTOFILL_PARAMS.lockHistoryOption,
    AUTOFILL_PARAMS.lockHistory
  ],
  showClientField: [AUTOFILL_PARAMS.showClientField],
  hideClientField: [AUTOFILL_PARAMS.hideClientField],
  canEditClient: [AUTOFILL_PARAMS.canEditClient],
  lockClientField: [AUTOFILL_PARAMS.lockClientField],
  showTokenField: [AUTOFILL_PARAMS.showTokenField],
  hideTokenField: [AUTOFILL_PARAMS.hideTokenField],
  canEditToken: [AUTOFILL_PARAMS.canEditToken],
  lockTokenField: [AUTOFILL_PARAMS.lockTokenField],
  panelLayout: [
    AUTOFILL_PARAMS.panelLayout,
    AUTOFILL_PARAMS.layout
  ]
} as const;

const AUTOFILL_PARAM_NAMES = Array.from(new Set(Object.values(AUTOFILL_PARAM_GROUPS).flat()));

function hashParams(url: URL): URLSearchParams {
  const rawHash = url.hash ? url.hash.slice(1) : "";
  return new URLSearchParams(rawHash.startsWith("?") ? rawHash.slice(1) : rawHash);
}

function firstParam(sources: URLSearchParams[], names: readonly string[]): string {
  for (const source of sources) {
    for (const name of names) {
      const value = source.get(name);
      if (value !== null && value !== "") {
        return String(value).trim();
      }
    }
  }
  return "";
}

function hasParam(sources: URLSearchParams[], names: readonly string[]): boolean {
  return sources.some((source) => names.some((name) => source.has(name)));
}

function optionalBoolean(sources: URLSearchParams[], names: readonly string[]): boolean | undefined {
  const value = firstParam(sources, names).toLowerCase();
  if (!value) {
    return undefined;
  }
  if (["1", "true", "sim", "yes", "on"].includes(value)) {
    return true;
  }
  if (["0", "false", "nao", "no", "off"].includes(value)) {
    return false;
  }
  return undefined;
}

function applyFieldVisibilityOptions(result: AutofillHash, sources: URLSearchParams[]): void {
  const hideClientField = optionalBoolean(sources, AUTOFILL_PARAM_GROUPS.hideClientField);
  const showClientField = optionalBoolean(sources, AUTOFILL_PARAM_GROUPS.showClientField);
  const lockClientField = optionalBoolean(sources, AUTOFILL_PARAM_GROUPS.lockClientField);
  const canEditClient = optionalBoolean(sources, AUTOFILL_PARAM_GROUPS.canEditClient);
  const hideTokenField = optionalBoolean(sources, AUTOFILL_PARAM_GROUPS.hideTokenField);
  const showTokenField = optionalBoolean(sources, AUTOFILL_PARAM_GROUPS.showTokenField);
  const lockTokenField = optionalBoolean(sources, AUTOFILL_PARAM_GROUPS.lockTokenField);
  const canEditToken = optionalBoolean(sources, AUTOFILL_PARAM_GROUPS.canEditToken);

  if (hideClientField !== undefined) {
    result.hideClientField = hideClientField;
  } else if (showClientField !== undefined) {
    result.hideClientField = showClientField === false;
  }

  if (lockClientField !== undefined) {
    result.lockClientField = lockClientField;
  } else if (canEditClient !== undefined) {
    result.lockClientField = canEditClient === false;
  }

  if (hideTokenField !== undefined) {
    result.hideTokenField = hideTokenField;
  } else if (showTokenField !== undefined) {
    result.hideTokenField = showTokenField === false;
  }

  if (lockTokenField !== undefined) {
    result.lockTokenField = lockTokenField;
  } else if (canEditToken !== undefined) {
    result.lockTokenField = canEditToken === false;
  }
}

export function normalizeClientHost(value: unknown): string {
  const host = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/\/.*$/, "")
    .replace(/^\.+|\.+$/g, "");
  if (!host) {
    return "";
  }
  if (!/^[a-z0-9][a-z0-9.-]*(?::[0-9]{1,5})?$/.test(host)) {
    throw new Error("Nome da assinatura invalido. Use exatamente o nome da assinatura ou uma URL completa.");
  }
  return host;
}

export function isLocalHost(host: string): boolean {
  return host === "localhost" || host.startsWith("localhost:") || host.startsWith("127.");
}

export function normalizeBaseUrl(value: unknown): string {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) {
    return "";
  }
  if (/^https?:\/\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error("URL da instancia invalida.");
    }
    if (url.protocol !== "https:") {
      throw new Error("Use uma URL HTTPS do backend autorizado.");
    }
    if (isLocalHost(url.host)) {
      throw new Error("Use um backend autorizado publico com HTTPS.");
    }
    return raw;
  }
  const host = normalizeClientHost(raw);
  if (!host) {
    return "";
  }
  if (isLocalHost(host)) {
    throw new Error("Use um backend autorizado publico com HTTPS.");
  }
  if (host.includes(".")) {
    return `https://${host}`;
  }
  if (!CLIENT_BASE_DOMAIN) {
    throw new Error("Informe a URL HTTPS completa do backend autorizado.");
  }
  return `https://${host}.${CLIENT_BASE_DOMAIN}`;
}

export function parseAutofillHash(rawUrl: unknown): AutofillHash | null {
  let url: URL;
  try {
    url = new URL(String(rawUrl || ""));
  } catch {
    return null;
  }

  if (url.origin !== WHATSAPP_WEB_ORIGIN) {
    return null;
  }

  const sources = [hashParams(url), url.searchParams];
  const hasClient = hasParam(sources, AUTOFILL_PARAM_GROUPS.client);
  const hasToken = hasParam(sources, AUTOFILL_PARAM_GROUPS.token);
  if (!hasClient && !hasToken) {
    return null;
  }

  const result: AutofillHash = {
    client: firstParam(sources, AUTOFILL_PARAM_GROUPS.client),
    token: firstParam(sources, AUTOFILL_PARAM_GROUPS.token),
    hasClient,
    hasToken
  };

  const includeHistory = optionalBoolean(sources, AUTOFILL_PARAM_GROUPS.includeHistory);
  const hideHistoryOption = optionalBoolean(sources, AUTOFILL_PARAM_GROUPS.hideHistoryOption);
  const lockHistoryOption = optionalBoolean(sources, AUTOFILL_PARAM_GROUPS.lockHistoryOption);
  const panelLayout = firstParam(sources, AUTOFILL_PARAM_GROUPS.panelLayout);

  if (includeHistory !== undefined) {
    result.includeHistory = includeHistory;
  }
  if (hideHistoryOption !== undefined) {
    result.hideHistoryOption = hideHistoryOption;
  }
  if (lockHistoryOption !== undefined) {
    result.lockHistoryOption = lockHistoryOption;
  }
  applyFieldVisibilityOptions(result, sources);
  if (panelLayout === "center" || panelLayout === "corner") {
    result.panelLayout = panelLayout;
  }

  return result;
}

export function removeAutofillHashParams(rawUrl: unknown): string | null {
  let url: URL;
  try {
    url = new URL(String(rawUrl || ""));
  } catch {
    return null;
  }

  const params = hashParams(url);
  let changed = false;
  for (const key of AUTOFILL_PARAM_NAMES) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
    if (params.has(key)) {
      params.delete(key);
      changed = true;
    }
  }
  if (!changed) {
    return null;
  }

  const nextHash = params.toString();
  url.hash = nextHash ? nextHash : "";
  return url.toString();
}
