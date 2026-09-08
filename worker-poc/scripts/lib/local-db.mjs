import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const migrationSql = readdirSync(resolve(here, '../../migrations-formal'))
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(resolve(here, '../../migrations-formal', name), 'utf8'));

export class LocalFormalD1 {
  constructor(databasePath) {
    this.database = new DatabaseSync(databasePath);
    migrationSql.forEach((sql) => this.database.exec(sql));
    this.batchQueue = Promise.resolve();
  }

  prepare(sql) {
    const database = this.database;
    return {
      bind: (...params) => ({
        async first() { return database.prepare(sql).get(...params) ?? null; },
        async all() { return { results: database.prepare(sql).all(...params) }; },
        async run() { return database.prepare(sql).run(...params); }
      })
    };
  }

  async batch(statements) {
    const execute = this.batchQueue.then(async () => {
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
    });
    this.batchQueue = execute.catch(() => undefined);
    return execute;
  }

  close() {
    this.database.close();
  }
}

export const openLocalFormalDatabase = (databasePath) => new LocalFormalD1(databasePath);
