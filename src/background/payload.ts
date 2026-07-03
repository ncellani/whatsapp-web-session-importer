export function importPayloadForOptions(payload: any, options: { includeHistory?: boolean } = {}): any {
  const skipsHistory = options.includeHistory === false;
  if (!skipsHistory) {
    return payload;
  }
  const copy = { ...payload };
  // Standard mode skips browser history/contact sidecar. Keep cheap
  // session-adjacent helpers such as privacy tokens and nctSalt.
  delete copy.history;
  delete copy.contacts;
  return copy;
}
