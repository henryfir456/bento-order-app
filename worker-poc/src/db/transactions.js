const queryFragment = (text, bindings) => Object.freeze({
  kind: 'prepared-query',
  text,
  bindings: Object.freeze(bindings)
});

/**
 * Values interpolated through this tag become bind parameters.  Mutation
 * code uses this for fragments that need to combine trusted SQL with values;
 * user input is never concatenated into the SQL text.
 */
export const sql = (strings, ...values) => {
  if (!Array.isArray(strings) || !Array.isArray(strings.raw)) {
    throw new TypeError('sql must be called as a tagged template.');
  }
  let text = '';
  for (let index = 0; index < strings.raw.length; index += 1) {
    text += strings.raw[index];
    if (index < values.length) text += '?';
  }
  return queryFragment(text, values);
};

const validateSqlText = (text) => {
  if (typeof text !== 'string' || !text.trim()) {
    throw new TypeError('A non-empty SQL statement is required.');
  }
  if (text.includes('\u0000') || text.includes('${') || text.includes('{{')) {
    throw new TypeError('SQL text contains an interpolation marker. Use bound parameters.');
  }
};

export const prepareStatement = (database, query, bindings) => {
  if (!database || typeof database.prepare !== 'function') {
    throw new Error('D1 prepare is required.');
  }

  let text;
  let params;
  if (query?.kind === 'prepared-query') {
    if (bindings !== undefined) {
      throw new TypeError('Tagged SQL already owns its bound parameters.');
    }
    text = query.text;
    params = query.bindings;
  } else {
    if (!Array.isArray(bindings)) {
      throw new TypeError('Raw SQL requires an explicit bindings array.');
    }
    text = query;
    params = bindings;
  }
  validateSqlText(text);
  const statement = database.prepare(text);
  if (!statement || typeof statement.bind !== 'function') {
    throw new Error('D1 prepare did not return a bindable statement.');
  }
  return statement.bind(...params);
};

export const runMutationBatch = async (database, statements) => {
  if (!database || typeof database.batch !== 'function') {
    throw new Error('D1 batch is required for an atomic mutation.');
  }
  if (!Array.isArray(statements) || statements.length === 0) {
    throw new TypeError('An atomic mutation requires at least one statement.');
  }
  if (statements.some((statement) => !statement || typeof statement.run !== 'function')) {
    throw new TypeError('Every mutation statement must be executable.');
  }
  try {
    return await database.batch(statements);
  } catch (cause) {
    const error = new Error('D1 mutation transaction failed.');
    error.name = 'TransactionError';
    error.code = 'TRANSACTION_FAILED';
    error.cause = cause;
    throw error;
  }
};

export const runAtomicBatch = runMutationBatch;

export const resolveClock = (clock = new Date()) => {
  const value = typeof clock === 'function' ? clock() : clock;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('An invalid clock value was supplied.');
  return date;
};

export const randomId = (prefix = 'ID') => {
  const suffix = globalThis.crypto?.randomUUID?.()
    || Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix ? prefix + '_' + suffix : suffix;
};
