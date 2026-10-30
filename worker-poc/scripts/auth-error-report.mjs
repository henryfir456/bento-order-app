// Read-only summary of recent login/bootstrap failures from auth_error_log.
// Usage (from worker-poc, needs wrangler login):
//   node scripts/auth-error-report.mjs [--hours 48] [--limit 30]
// Output holds no tokens or identities. Queries are bounded (500 rows scanned).
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_HOURS = 14 * 24;
const SCAN_LIMIT = 500;

export const parseArgs = (argv) => {
  const args = { hours: 48, limit: 30 };
  for (let i = 0; i < argv.length; i += 1) {
    const value = Number(argv[i + 1]);
    if (argv[i] === '--hours') { args.hours = value; i += 1; }
    else if (argv[i] === '--limit') { args.limit = value; i += 1; }
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!Number.isInteger(args.hours) || args.hours < 1 || args.hours > MAX_HOURS) {
    throw new Error(`--hours must be an integer from 1 to ${MAX_HOURS}.`);
  }
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100) {
    throw new Error('--limit must be an integer from 1 to 100.');
  }
  return args;
};

export const buildQueries = ({ hours, limit }, now = new Date()) => {
  const since = new Date(now.getTime() - hours * 3600000).toISOString();
  const window = `SELECT * FROM auth_error_log WHERE occurred_at >= '${since}' ORDER BY occurred_at DESC LIMIT ${SCAN_LIMIT}`;
  return {
    summary: `SELECT source, stage, error_code, http_status, error_class, COUNT(*) AS n,
      MAX(occurred_at) AS last_at FROM (${window})
      GROUP BY source, stage, error_code, http_status, error_class ORDER BY n DESC LIMIT 20`,
    recent: `SELECT occurred_at, source, stage, error_code, http_status, error_class,
      line_profile_status, line_verify_status, duration_ms, in_line, app_version,
      ua_summary, client_ref, request_id, detail FROM (${window}) LIMIT ${limit}`
  };
};

const dash = (value) => (value === null || value === undefined || value === '' ? '-' : value);

export const formatReport = ({ summary, recent }, { hours }) => {
  const lines = [`# 登入錯誤彙整（近 ${hours} 小時，最多掃描 ${SCAN_LIMIT} 筆）`, ''];
  if (!summary.length) return lines.concat('沒有紀錄。').join('\n');
  lines.push('## 依類型統計', '| 次數 | 來源 | 階段 | 錯誤碼 | HTTP | 類別 | 最近一次 (UTC) |', '|---|---|---|---|---|---|---|');
  for (const row of summary) {
    lines.push(`| ${row.n} | ${row.source} | ${row.stage} | ${row.error_code} | ${dash(row.http_status)} | ${dash(row.error_class)} | ${row.last_at} |`);
  }
  lines.push('', '## 最近紀錄');
  for (const row of recent) {
    const inLine = row.in_line === null ? '?' : row.in_line ? 'LINE內' : '外部瀏覽器';
    lines.push(
      `- ${row.occurred_at} [${row.source}] ${row.stage} ${row.error_code} http=${dash(row.http_status)}`
      + ` class=${dash(row.error_class)} lineProfile=${dash(row.line_profile_status)} lineVerify=${dash(row.line_verify_status)}`
      + ` ${dash(row.duration_ms)}ms ${inLine} v${dash(row.app_version)} ${dash(row.ua_summary)}`
      + ` client=${dash(row.client_ref)} req=${dash(row.request_id)}${row.detail ? ` detail="${row.detail}"` : ''}`
    );
  }
  return lines.join('\n');
};

const remoteQuery = (sql) => {
  const result = spawnSync(process.execPath, [
    resolve(workerRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
    'd1', 'execute', 'bento-formal', '--remote', '--json',
    '--config', resolve(workerRoot, 'wrangler.jsonc'),
    '--command', sql.replace(/\s+/g, ' ').trim()
  ], { cwd: workerRoot, encoding: 'utf8', shell: false, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`wrangler d1 execute failed:\n${result.stderr || result.stdout}`);
  }
  const parsed = JSON.parse(result.stdout);
  return (Array.isArray(parsed) ? parsed : [parsed]).flatMap((entry) => entry.results || []);
};

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = parseArgs(process.argv.slice(2));
  const queries = buildQueries(args);
  console.log(formatReport({ summary: remoteQuery(queries.summary), recent: remoteQuery(queries.recent) }, args));
}
