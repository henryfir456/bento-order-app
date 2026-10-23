// Counts D1 rows_read per request so the heaviest endpoints can be found.
// Statements stay the real D1 objects (batch() needs them); only their run /
// all / raw methods are wrapped to read meta.rows_read. first() returns no
// meta in D1, so its rows are not counted (the query still is).
const rowsOf = (result) => {
  const value = Number(result?.meta?.rows_read);
  return Number.isFinite(value) ? value : 0;
};

export const createReadMeter = () => ({ rows: 0, queries: 0 });

const instrument = (statement, meter) => {
  if (!statement || typeof statement !== 'object') return statement;
  for (const method of ['run', 'all', 'raw', 'first']) {
    const original = statement[method];
    if (typeof original !== 'function') continue;
    statement[method] = async (...args) => {
      meter.queries += 1;
      const result = await original.apply(statement, args);
      if (method === 'run' || method === 'all') meter.rows += rowsOf(result);
      return result;
    };
  }
  const bind = statement.bind;
  if (typeof bind === 'function') {
    statement.bind = (...args) => instrument(bind.apply(statement, args), meter);
  }
  return statement;
};

export const meterDatabase = (database, meter) => {
  if (!database || typeof database.prepare !== 'function') return database;
  return new Proxy(database, {
    get(target, property) {
      if (property === 'prepare') {
        return (...args) => instrument(target.prepare(...args), meter);
      }
      if (property === 'batch') {
        return async (statements, ...rest) => {
          const results = await target.batch(statements, ...rest);
          meter.queries += Array.isArray(statements) ? statements.length : 0;
          if (Array.isArray(results)) results.forEach((result) => { meter.rows += rowsOf(result); });
          return results;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
};
