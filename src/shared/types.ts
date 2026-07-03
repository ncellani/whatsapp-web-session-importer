export type JsonRecord = Record<string, any>;

export interface ImportChunk {
  section: string;
  count: number;
  payload: JsonRecord;
}

export interface ExpectedImportRows {
  preKeys: number;
  identityKeys: number;
  sessions: number;
  senderKeys: number;
  appStateSyncKeys: number;
  appStateVersions: number;
  appStateMutationMACs: number;
  contacts: number;
  privacyTokens: number;
  nctSalt: number;
  validatedHistoryChats: number;
  validatedHistoryMessages: number;
}

export interface ImportUploadOptions {
  onProgress?: (done: number, total: number, section: string) => void;
}
