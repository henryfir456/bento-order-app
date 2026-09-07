export const runAtomicBatch = async (database, statements) => {
  if (!database || typeof database.batch !== 'function') {
    throw new Error('D1 batch is required for an atomic mutation.');
  }
  return database.batch(statements);
};

export const randomId = (prefix) => {
  const suffix = globalThis.crypto?.randomUUID?.()
    || Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix + '_' + suffix;
};
