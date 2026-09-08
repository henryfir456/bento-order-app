const serializeFingerprint = (value) => JSON.stringify(value);

export const createClientRequestKey = (prefix) => {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid
    ? `${prefix}-${uuid}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const getStableClientRequestKey = (requestRef, prefix, fingerprint) => {
  const serializedFingerprint = serializeFingerprint(fingerprint);
  if (
    requestRef?.current?.key
    && requestRef.current.fingerprint === serializedFingerprint
  ) {
    return requestRef.current.key;
  }

  const key = createClientRequestKey(prefix);
  requestRef.current = { fingerprint: serializedFingerprint, key };
  return key;
};

export const clearClientRequestKey = (requestRef) => {
  if (requestRef) requestRef.current = null;
};
