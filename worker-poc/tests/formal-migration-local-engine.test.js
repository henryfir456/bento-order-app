import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const workerDirectory = join(here, '..');
const migrationsDirectory = join(workerDirectory, 'migrations-formal');
const migrationNames = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith('.sql'))
  .sort();
const migrationFiveName = '0005_nullable_user_pickup_floor.sql';
const migrationChainNames = migrationNames.slice(
  0,
  migrationNames.indexOf(migrationFiveName) + 1
);
const migrationFiveSource = readFileSync(
  join(migrationsDirectory, migrationFiveName),
  'utf8'
);

const wranglerEntrypoint = join(
  workerDirectory,
  'node_modules',
  'wrangler',
  'bin',
  'wrangler.js'
);

const createLocalProject = (migrationCount) => {
  const root = mkdtempSync(join(tmpdir(), 'bento-0005-local-'));
  const migrationTarget = join(root, 'migrations-formal');
  const persistTarget = join(root, 'd1');
  mkdirSync(migrationTarget, { recursive: true });
  mkdirSync(persistTarget, { recursive: true });

  migrationNames.slice(0, migrationCount).forEach((name) => {
    copyFileSync(join(migrationsDirectory, name), join(migrationTarget, name));
  });

  const databaseName = `bento-0005-local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const configPath = join(root, 'wrangler.jsonc');
  writeFileSync(configPath, JSON.stringify({
    name: databaseName,
    d1_databases: [{
      binding: 'DB',
      database_name: databaseName,
      migrations_dir: 'migrations-formal'
    }]
  }, null, 2));

  return {
    root,
    migrationTarget,
    persistTarget,
    configPath,
    databaseName
  };
};

const runWrangler = (project, args) => {
  try {
    return execFileSync(
      process.execPath,
      [wranglerEntrypoint, ...args],
      {
        cwd: workerDirectory,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          CI: '1',
          NO_COLOR: '1',
          WRANGLER_LOG_PATH: join(project.root, 'wrangler.log'),
          XDG_CONFIG_HOME: join(project.root, 'xdg-config')
        }
      }
    );
  } catch (error) {
    const stdout = error.stdout?.toString() || '';
    const stderr = error.stderr?.toString() || '';
    throw new Error(
      `Wrangler failed: ${args.join(' ')}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      { cause: error }
    );
  }
};

const applyMigrations = (project) => runWrangler(project, [
  'd1', 'migrations', 'apply', project.databaseName,
  '--local', '--persist-to', project.persistTarget,
  '--config', project.configPath
]);

const executeJson = (project, sql) => {
  const output = runWrangler(project, [
    'd1', 'execute', project.databaseName,
    '--local', '--persist-to', project.persistTarget,
    '--config', project.configPath, '--command', sql, '--json'
  ]);
  return JSON.parse(output)[0];
};

const executeSql = (project, sql) => executeJson(project, sql);

const executeSqlExpectFailure = (project, sql) => {
  assert.throws(
    () => executeSql(project, sql),
    /Wrangler failed:.*(?:constraint|CHECK|UNIQUE|error)/is
  );
};

const queryRows = (project, sql) => {
  const response = executeSql(project, sql);
  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(response.meta?.changes ?? 0, 0, JSON.stringify(response));
  assert.equal(response.meta?.changed_db ?? false, false, JSON.stringify(response));
  return response.results;
};

const installMigrationFive = (project) => {
  copyFileSync(
    join(migrationsDirectory, migrationFiveName),
    join(project.migrationTarget, migrationFiveName)
  );
};

const seedUpgradeData = (project) => {
  executeSql(project, `
    INSERT INTO users (
      user_id, employee_id, line_user_id, display_name, pickup_floor,
      balance, role, active, created_at, updated_at, verification_status
    ) VALUES
      ('fk-actor', 'FK-ACTOR', 'line-fk-actor', 'FK Actor', '1樓', 30, 'Admin', 1,
       '2026-09-13T01:00:00.000Z', '2026-09-13T01:00:00.000Z', 'VERIFIED'),
      ('fk-target', 'FK-TARGET', NULL, 'FK Target', '9樓', 5, 'User', 1,
       '2026-09-13T01:00:00.000Z', '2026-09-13T01:00:00.000Z', 'VERIFIED');
    INSERT INTO admin_audit_log (
      audit_id, actor_user_id, actor_auth_mode, target_user_id, action
    ) VALUES ('fk-audit', 'fk-actor', 'line', 'fk-target', 'PROFILE_REVIEW');
    INSERT INTO employee_guest_sessions (
      session_id, token_hash, user_id, auth_mode, expires_at
    ) VALUES ('fk-session', 'fk-session-token', 'fk-target', 'employee_guest', '2099-01-01T00:00:00.000Z');
  `);
};

const userSchema = (project) => queryRows(project, `
  SELECT name, sql
  FROM sqlite_master
  WHERE type = 'table' AND name = 'users'
`)[0];

const userColumns = (project) => queryRows(project, 'PRAGMA table_info(users)');

const userIndexes = (project) => queryRows(project, `
  SELECT name, sql
  FROM sqlite_master
  WHERE type = 'index' AND tbl_name = 'users'
  ORDER BY name
`);

const childForeignKeys = (project, tableName) => (
  queryRows(project, `PRAGMA foreign_key_list(${tableName})`)
);

const assertPostMigrationState = (project, expectedUserRows) => {
  const migrationRows = queryRows(project, `
    SELECT name FROM d1_migrations ORDER BY id
  `);
  assert.equal(
    migrationRows.filter((row) => row.name === migrationFiveName).length,
    1
  );

  const columns = userColumns(project);
  const pickupFloor = columns.find((column) => column.name === 'pickup_floor');
  assert.equal(pickupFloor.notnull, 0);
  assert.equal(columns.some((column) => column.name === 'pickup_floor_legacy'), false);

  const users = queryRows(project, `
    SELECT user_id, employee_id, line_user_id, display_name,
           pickup_floor, balance, role
    FROM users ORDER BY user_id
  `);
  assert.deepEqual(users, expectedUserRows);

  const indexNames = new Set(userIndexes(project).map((index) => index.name));
  assert.deepEqual(indexNames, new Set([
    'sqlite_autoindex_users_1',
    'users_employee_id_normalized_unique',
    'users_employee_id_unique',
    'users_line_user_id_unique'
  ]));
  const indexes = new Map(userIndexes(project).map((index) => [index.name, index.sql]));
  assert.match(indexes.get('users_employee_id_unique'), /ON users\(employee_id\)/);
  assert.match(indexes.get('users_line_user_id_unique'), /ON users\(line_user_id\)/);
  assert.match(indexes.get('users_employee_id_normalized_unique'), /UPPER\(trim\(employee_id\)\)/);

  assert.deepEqual(childForeignKeys(project, 'admin_audit_log'), [
    { id: 0, seq: 0, table: 'users', from: 'target_user_id', to: 'user_id', on_update: 'NO ACTION', on_delete: 'NO ACTION', match: 'NONE' },
    { id: 1, seq: 0, table: 'users', from: 'actor_user_id', to: 'user_id', on_update: 'NO ACTION', on_delete: 'NO ACTION', match: 'NONE' }
  ]);
  assert.deepEqual(childForeignKeys(project, 'employee_guest_sessions'), [
    { id: 0, seq: 0, table: 'users', from: 'user_id', to: 'user_id', on_update: 'NO ACTION', on_delete: 'NO ACTION', match: 'NONE' }
  ]);
  assert.deepEqual(queryRows(project, 'PRAGMA foreign_key_check'), []);

  executeSql(project, `
    INSERT INTO users (user_id, employee_id, display_name, pickup_floor)
    VALUES ('incomplete-user', 'INCOMPLETE', 'Incomplete', NULL);
    UPDATE users SET pickup_floor = '1樓' WHERE user_id = 'incomplete-user';
    UPDATE users SET pickup_floor = '9樓' WHERE user_id = 'incomplete-user';
  `);
  executeSqlExpectFailure(project, `
    UPDATE users SET pickup_floor = '3樓' WHERE user_id = 'incomplete-user'
  `);
  executeSqlExpectFailure(project, `
    INSERT INTO users (user_id, employee_id, display_name, pickup_floor)
    VALUES ('duplicate-normalized', ' fk-actor ', 'Duplicate', '1樓')
  `);
  executeSqlExpectFailure(project, `
    INSERT INTO users (user_id, employee_id, line_user_id, display_name, pickup_floor)
    VALUES ('duplicate-line', 'NEW-EMPLOYEE', 'line-fk-actor', 'Duplicate line', '1樓')
  `);
};

test('0005 uses an in-place nullable pickup-floor migration', () => {
  assert.doesNotMatch(migrationFiveSource, /PRAGMA foreign_keys\s*=\s*OFF/i);
  assert.doesNotMatch(migrationFiveSource, /CREATE TABLE\s+users_profile_policy_new/i);
  assert.doesNotMatch(migrationFiveSource, /DROP TABLE\s+users\s*;/i);
  assert.doesNotMatch(migrationFiveSource, /CREATE UNIQUE INDEX\s+users_/i);
  assert.match(migrationFiveSource, /ALTER TABLE\s+users\s+RENAME COLUMN\s+pickup_floor/i);
  assert.match(migrationFiveSource, /ALTER TABLE\s+users\s+ADD COLUMN\s+pickup_floor/i);
  assert.match(migrationFiveSource, /ALTER TABLE\s+users\s+DROP COLUMN/i);
});

test('fresh Wrangler local D1 applies 0000 through fixed 0005', () => {
  const project = createLocalProject(migrationChainNames.length);
  try {
    applyMigrations(project);
    const migrationRows = queryRows(project, 'SELECT name FROM d1_migrations ORDER BY id');
    assert.deepEqual(migrationRows.map((row) => row.name), migrationChainNames);
    assert.equal(userColumns(project).find((column) => column.name === 'pickup_floor').notnull, 0);
    assert.deepEqual(queryRows(project, 'PRAGMA foreign_key_check'), []);
  } finally {
    rmSync(project.root, { recursive: true, force: true });
  }
});

test('Wrangler local D1 upgrades populated 0004 data without rebuilding users', () => {
  const project = createLocalProject(5);
  try {
    applyMigrations(project);
    const preSchema = userSchema(project);
    const preColumns = userColumns(project);
    seedUpgradeData(project);
    const preUsers = queryRows(project, `
      SELECT user_id, employee_id, line_user_id, display_name,
             pickup_floor, balance, role
      FROM users ORDER BY user_id
    `);
    const preChildCounts = queryRows(project, `
      SELECT 'admin_audit_log' AS table_name, COUNT(*) AS count FROM admin_audit_log
      UNION ALL SELECT 'employee_guest_sessions', COUNT(*) FROM employee_guest_sessions
    `);
    assert.deepEqual(queryRows(project, `
      SELECT type, name, sql
      FROM sqlite_master
      WHERE type IN ('index', 'trigger', 'view')
        AND lower(sql) LIKE '%pickup_floor%'
    `), []);
    assert.deepEqual(queryRows(project, `
      SELECT type, name, sql
      FROM sqlite_master
      WHERE type = 'table' AND name <> 'users'
        AND lower(sql) LIKE '%pickup_floor%'
        AND lower(sql) LIKE '%generated%'
    `), []);
    const preAdminKeys = childForeignKeys(project, 'admin_audit_log');
    const preGuestKeys = childForeignKeys(project, 'employee_guest_sessions');

    installMigrationFive(project);
    applyMigrations(project);

    assertPostMigrationState(project, preUsers);
    assert.deepEqual(queryRows(project, `
      SELECT 'admin_audit_log' AS table_name, COUNT(*) AS count FROM admin_audit_log
      UNION ALL SELECT 'employee_guest_sessions', COUNT(*) FROM employee_guest_sessions
    `), preChildCounts);
    assert.deepEqual(childForeignKeys(project, 'admin_audit_log'), preAdminKeys);
    assert.deepEqual(childForeignKeys(project, 'employee_guest_sessions'), preGuestKeys);

    const postSchema = userSchema(project);
    assert.notEqual(preSchema.sql, postSchema.sql);
    assert.match(postSchema.sql, /user_id TEXT PRIMARY KEY/i);
    assert.match(postSchema.sql, /display_name TEXT NOT NULL/i);
    assert.match(postSchema.sql, /balance INTEGER NOT NULL DEFAULT 0/i);
    assert.match(postSchema.sql, /role TEXT NOT NULL DEFAULT 'User'/i);
    assert.match(postSchema.sql, /role IN \('User', 'ProxyAdmin', 'Admin'\)/i);
    assert.match(postSchema.sql, /active INTEGER NOT NULL DEFAULT 1/i);
    assert.match(postSchema.sql, /active IN \(0, 1\)/i);
    assert.match(postSchema.sql, /created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP/i);
    assert.match(postSchema.sql, /updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP/i);
    assert.match(postSchema.sql, /verification_status TEXT NOT NULL DEFAULT 'VERIFIED'/i);
    assert.match(postSchema.sql, /verification_status IN \('VERIFIED', 'UNVERIFIED'\)/i);
    assert.match(preSchema.sql, /pickup_floor\s+TEXT\s+NOT NULL/i);
    assert.match(postSchema.sql, /pickup_floor\s+TEXT\s+CHECK/i);
    assert.doesNotMatch(postSchema.sql, /pickup_floor_legacy/i);
    assert.deepEqual(queryRows(project, `
      SELECT type, name
      FROM sqlite_master
      WHERE name = 'users_profile_policy_new'
    `), []);

    const postColumns = userColumns(project);
    const preByName = new Map(preColumns.map((column) => [column.name, column]));
    const postByName = new Map(postColumns.map((column) => [column.name, column]));
    assert.deepEqual([...preByName.keys()].sort(), [...postByName.keys()].sort());
    for (const name of preByName.keys()) {
      if (name === 'pickup_floor') continue;
      assert.deepEqual(
        { type: postByName.get(name).type, notnull: postByName.get(name).notnull, dflt_value: postByName.get(name).dflt_value, pk: postByName.get(name).pk },
        { type: preByName.get(name).type, notnull: preByName.get(name).notnull, dflt_value: preByName.get(name).dflt_value, pk: preByName.get(name).pk }
      );
    }
  } finally {
    rmSync(project.root, { recursive: true, force: true });
  }
});
