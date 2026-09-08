import fs from 'node:fs';

const configUrl = new URL('../wrangler.jsonc', import.meta.url);
const config = JSON.parse(fs.readFileSync(configUrl, 'utf8'));
const database = config.d1_databases?.find((binding) => binding.binding === 'DB');
const databaseId = database?.database_id;
const databaseIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!databaseIdPattern.test(String(databaseId || ''))) {
  console.error('[worker-poc] Refusing remote write: wrangler.jsonc must contain a valid formal D1 database_id.');
  process.exit(1);
}
