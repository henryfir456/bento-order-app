import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workerDirectory = resolve(scriptDirectory, '..');
const dataDirectory = resolve(workerDirectory, '.local-uat');
const stateDirectory = resolve(dataDirectory, 'state');
const wranglerConfig = resolve(workerDirectory, 'wrangler.local-uat.jsonc');
const wranglerEntry = resolve(workerDirectory, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const secretsFile = resolve(dataDirectory, 'secrets.env');
const credentialsFile = resolve(dataDirectory, 'credentials.txt');
const localDatabaseName = 'bento-order-app-local-uat-only';
const sentinelDatabaseId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
const vendorOneId = 'V' + String(1).padStart(5, '0');
const vendorTwoId = 'V' + String(2).padStart(5, '0');
const passwordDefinitions = Object.freeze([
  ['LOCAL_UAT_PASSWORD_ADMIN', 'Admin', 'admin'],
  ['LOCAL_UAT_PASSWORD_USER', 'User', 'user'],
  ['LOCAL_UAT_PASSWORD_VENDOR_ONE', `Vendor V${String(1).padStart(5, '0')}`, 'vendor-one'],
  ['LOCAL_UAT_PASSWORD_VENDOR_TWO', `Vendor V${String(2).padStart(5, '0')} isolation canary`, 'vendor-two']
]);

const parseEnvFile = (contents) => Object.fromEntries(
  String(contents).split(/\r?\n/u)
    .filter((line) => line.trim() && !line.trim().startsWith('#'))
    .map((line) => {
      const separator = line.indexOf('=');
      return separator < 0 ? ['', ''] : [line.slice(0, separator), line.slice(separator + 1)];
    })
    .filter(([key]) => key)
);

const validateLocalConfig = () => {
  const config = JSON.parse(readFileSync(wranglerConfig, 'utf8'));
  const database = config.d1_databases?.length === 1 ? config.d1_databases[0] : null;
  if (config.name !== 'bento-order-app-local-uat-only'
    || config.main !== 'src/localUatWorker.js'
    || config.workers_dev !== false
    || config.account_id
    || config.env
    || database?.binding !== 'DB'
    || database?.database_name !== localDatabaseName
    || database?.database_id !== sentinelDatabaseId
    || database?.migrations_dir !== 'migrations-formal'
    || config.vars?.LOCAL_UAT_MODE !== '1'
    || config.vars?.CORS_MODE !== 'local'
    || config.vars?.DEV_ALLOWED_ORIGINS !== 'http://localhost:5173'
    || config.vars?.APP_ORIGIN !== 'http://localhost:5173'
    || Object.keys(config.vars || {}).length !== 4
    || (config.triggers?.crons || []).length !== 0
    || config.routes?.length
    || config.services?.length
    || config.hyperdrive?.length
    || config.vectorize?.length
    || config.ai
    || config.pipelines?.length
    || config.workflows?.length
    || config.send_email
    || config.r2_buckets?.length
    || config.kv_namespaces?.length
    || config.durable_objects?.bindings?.length
    || config.queues?.producers?.length) {
    throw new Error('LOCAL_UAT_CONFIG_UNSAFE: expected isolated local-only bindings');
  }
};

const ensureCredentials = () => {
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  let values = {};
  if (existsSync(secretsFile) && existsSync(credentialsFile)) {
    values = parseEnvFile(readFileSync(secretsFile, 'utf8'));
    if (values.LOCAL_UAT_TOKEN_SECRET
      && passwordDefinitions.every(([key]) => values[key])) return values;
  }

  values = {
    LOCAL_UAT_TOKEN_SECRET: randomBytes(48).toString('base64url'),
    ...Object.fromEntries(passwordDefinitions.map(([key]) => [key, randomBytes(24).toString('base64url')]))
  };
  const envText = Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
  const credentialText = [
    'Bento local UAT test accounts (synthetic only)',
    'Environment: Wrangler local mode + disposable local D1; not Cloudflare, not production.',
    'Passwords are generated on this computer and are not committed to GitHub.',
    '',
    ...passwordDefinitions.map(([key, label, username]) => `${label}\n  username: ${username}\n  password: ${values[key]}`),
    '',
    'Protected-account owner mapping is a separate synthetic seed and has no login credential.'
  ].join('\n') + '\n';
  writeFileSync(secretsFile, envText, { mode: 0o600 });
  writeFileSync(credentialsFile, credentialText, { mode: 0o600 });
  return values;
};

const runWrangler = (args, { capture = false } = {}) => {
  if (!existsSync(wranglerEntry)) {
    throw new Error('WRANGLER_NOT_INSTALLED: run npm ci --prefix worker-poc first');
  }
  const configHome = resolve(dataDirectory, 'wrangler-config');
  mkdirSync(configHome, { recursive: true, mode: 0o700 });
  const childEnvironment = {
    ...process.env,
    CI: '1',
    XDG_CONFIG_HOME: configHome,
    WRANGLER_SEND_METRICS: 'false'
  };
  for (const credentialName of Object.keys(childEnvironment)) {
    if (/^(?:CLOUDFLARE_|CF_)/iu.test(credentialName)) delete childEnvironment[credentialName];
  }
  const result = spawnSync(process.execPath, [wranglerEntry, ...args], {
    cwd: workerDirectory,
    encoding: 'utf8',
    env: childEnvironment,
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`WRANGLER_LOCAL_COMMAND_FAILED${detail ? `\n${detail}` : ''}`);
  }
  if (capture) return result.stdout || '';
  return '';
};

const resetLocalDatabase = () => {
  validateLocalConfig();
  ensureCredentials();
  const relativeState = relative(workerDirectory, resolve(stateDirectory)).split(sep).join('/');
  if (relativeState !== '.local-uat/state') {
    throw new Error('LOCAL_UAT_RESET_PATH_UNSAFE');
  }
  rmSync(stateDirectory, { recursive: true, force: true });
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  runWrangler([
    '--config', 'wrangler.local-uat.jsonc',
    'd1', 'migrations', 'apply', localDatabaseName,
    '--local', '--persist-to', '.local-uat/state'
  ]);
  runWrangler([
    '--config', 'wrangler.local-uat.jsonc',
    'd1', 'execute', localDatabaseName,
    '--local', '--yes', '--persist-to', '.local-uat/state',
    '--file', 'scripts/local-uat-seed.sql'
  ]);
  const result = runWrangler([
    '--config', 'wrangler.local-uat.jsonc',
    'd1', 'execute', localDatabaseName,
    '--local', '--json', '--persist-to', '.local-uat/state',
    '--command',
    "SELECT (SELECT name FROM d1_migrations ORDER BY name DESC LIMIT 1) AS last_migration, (SELECT COUNT(*) FROM users WHERE user_id LIKE 'local-uat-%') AS synthetic_users, (SELECT COUNT(*) FROM vendors WHERE vendor_id IN ('"
      + vendorOneId + "', '" + vendorTwoId
      + "')) AS synthetic_vendors, (SELECT COUNT(*) FROM protected_account_user_mappings WHERE user_id = 'local-uat-protected-owner') AS synthetic_owner_mappings, (SELECT COUNT(*) FROM orders WHERE order_id LIKE 'local-uat-%') AS synthetic_orders, (SELECT COUNT(*) FROM vendor_transfer_payments WHERE payment_id LIKE 'SYNTHETIC-UAT-%') AS synthetic_payments;"
  ], { capture: true });
  let verification;
  try {
    verification = JSON.parse(result)?.[0]?.results?.[0];
  } catch {
    verification = null;
  }
  const foreignKeyCheck = runWrangler([
    '--config', 'wrangler.local-uat.jsonc',
    'd1', 'execute', localDatabaseName,
    '--local', '--json', '--persist-to', '.local-uat/state',
    '--command', 'PRAGMA foreign_key_check;'
  ], { capture: true });
  let foreignKeyRows;
  try {
    foreignKeyRows = JSON.parse(foreignKeyCheck)?.[0]?.results;
  } catch {
    foreignKeyRows = null;
  }
  if (verification?.last_migration !== '0022_vendor_legacy_name_attribution.sql'
    || verification.synthetic_users !== 5
    || verification.synthetic_vendors !== 2
    || verification.synthetic_owner_mappings !== 1
    || verification.synthetic_orders !== 3
    || verification.synthetic_payments !== 1
    || !Array.isArray(foreignKeyRows)
    || foreignKeyRows.length !== 0) {
    throw new Error('LOCAL_UAT_SEED_VERIFICATION_FAILED');
  }
  return {
    migration: '0022_vendor_legacy_name_attribution',
    database: localDatabaseName,
    credentialsFile
  };
};

const [command = 'help'] = process.argv.slice(2);
try {
  if (command === 'reset' || command === 'seed') {
    const result = resetLocalDatabase();
    process.stdout.write(`PASS local synthetic D1 reset and seed\nMigration: ${result.migration}\nDatabase: ${result.database}\nCredentials: ${result.credentialsFile}\n`);
  } else if (command === 'credentials') {
    ensureCredentials();
    process.stdout.write(`${credentialsFile}\n`);
  } else {
    process.stdout.write('Usage: node scripts/local-uat.mjs reset|seed|credentials\n');
  }
} catch (error) {
  process.stderr.write(`${String(error?.message || error)}\n`);
  process.exitCode = 1;
}
