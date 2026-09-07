import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = fileURLToPath(new URL('.', import.meta.url));
const migrationSql = readFileSync(
  join(here, '..', '..', 'migrations-formal', '0000_formal_initial_schema.sql'),
  'utf8'
);

export class SqliteD1 {
  constructor() {
    this.database = new DatabaseSync(':memory:');
    this.database.exec(migrationSql);
  }

  exec(sql) {
    return this.database.exec(sql);
  }

  run(sql, ...params) {
    return this.database.prepare(sql).run(...params);
  }

  get(sql, ...params) {
    return this.database.prepare(sql).get(...params);
  }

  prepare(sql) {
    const database = this.database;
    const bound = (...params) => ({
      async first() {
        return database.prepare(sql).get(...params) ?? null;
      },
      async all() {
        return { results: database.prepare(sql).all(...params) };
      },
      async run() {
        return database.prepare(sql).run(...params);
      }
    });
    return {
      bind: (...params) => bound(...params),
      first: () => bound().first(),
      all: () => bound().all(),
      run: () => bound().run()
    };
  }

  async batch(statements) {
    this.database.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}
