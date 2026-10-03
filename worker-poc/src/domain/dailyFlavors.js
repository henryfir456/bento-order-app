import { HISTORICAL_SQL_VENDOR, normalizeMenuVendor } from './menuVendors.js';
import { getTaipeiDate, isDateOnly } from './deadlines.js';
import { randomId } from '../db/transactions.js';
import { runMutationBatch } from '../db/transactions.js';
import {
  CAI_TEACHER_DAILY_FLAVOR_SOURCE_URL,
  DailyFlavorParseError,
  parseCaiTeacherDailyFlavorHtml
} from './caiTeacherDailyFlavorParser.js';

const SOURCE_URL_FOR_FETCH = CAI_TEACHER_DAILY_FLAVOR_SOURCE_URL.split('#')[0];
const FLAVOR_ITEM_CODES = new Set(['E', 'A', 'AM']);

const resultCounts = () => ({
  parsedCount: 0,
  consideredCount: 0,
  addedCount: 0,
  updatedCount: 0,
  unchangedCount: 0
});

const sha256 = async (value) => {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    throw Object.assign(new Error('DAILY_FLAVOR_HASH_UNAVAILABLE'), {
      code: 'DAILY_FLAVOR_HASH_UNAVAILABLE',
      stage: 'hash'
    });
  }
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const sourceHashFor = (row) => sha256(JSON.stringify([
  row.service_date,
  row.flavor_name,
  row.description,
  row.image_url
]));

const countResult = (counts, status, errorCode = null) => ({
  status,
  ...counts,
  errorCode
});

export const runCaiTeacherDailyFlavorSync = async (
  database,
  { fetchImpl = globalThis.fetch, now = new Date() } = {}
) => {
  const instant = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (Number.isNaN(instant.getTime())) throw new TypeError('A valid sync time is required.');
  const startedAt = instant.toISOString();
  const runId = randomId('daily-flavor-run');
  const counts = resultCounts();

  await database.prepare(`
    INSERT INTO vendor_daily_flavor_sync_runs (
      run_id, vendor, source_url, started_at, status, stage
    ) VALUES (?, ?, ?, ?, 'RUNNING', 'fetch')
  `).bind(runId, HISTORICAL_SQL_VENDOR, CAI_TEACHER_DAILY_FLAVOR_SOURCE_URL, startedAt).run();

  const finish = async (status, stage, errorCode = null) => {
    await database.prepare(`
      UPDATE vendor_daily_flavor_sync_runs
      SET finished_at = ?, status = ?, stage = ?, error_code = ?,
          parsed_count = ?, considered_count = ?, added_count = ?,
          updated_count = ?, unchanged_count = ?
      WHERE run_id = ?
    `).bind(
      instant.toISOString(), status, stage, errorCode,
      counts.parsedCount, counts.consideredCount, counts.addedCount,
      counts.updatedCount, counts.unchangedCount, runId
    ).run();
    return countResult(counts, status, errorCode);
  };

  try {
    const response = await fetchImpl(SOURCE_URL_FOR_FETCH, {
      method: 'GET',
      headers: { Accept: 'text/html' },
      redirect: 'follow'
    });
    if (!response?.ok) return await finish('FAILED', 'fetch', 'DAILY_FLAVOR_SOURCE_UNAVAILABLE');

    const html = await response.text();
    let parsedRows;
    try {
      parsedRows = parseCaiTeacherDailyFlavorHtml(html);
    } catch (error) {
      if (error instanceof DailyFlavorParseError) {
        counts.parsedCount = 0;
        return await finish('FAILED', error.stage, error.code);
      }
      throw error;
    }
    counts.parsedCount = parsedRows.length;

    const serviceDate = getTaipeiDate(instant);
    const eligibleRows = parsedRows.filter((row) => row.service_date >= serviceDate);
    if (!eligibleRows.length) {
      return await finish('FAILED', 'validate', 'DAILY_FLAVOR_FUTURE_ROWS_EMPTY');
    }
    counts.consideredCount = eligibleRows.length;

    const rowsWithHash = await Promise.all(eligibleRows.map(async (row) => ({
      ...row,
      source_hash: await sourceHashFor(row)
    })));
    const existingResult = await database.prepare(`
      SELECT service_date, source_hash
      FROM vendor_daily_flavors
      WHERE vendor = ?
    `).bind(HISTORICAL_SQL_VENDOR).all();
    const existing = new Map((existingResult?.results || []).map((row) => (
      [row.service_date, row.source_hash]
    )));
    const changedRows = [];

    for (const row of rowsWithHash) {
      const oldHash = existing.get(row.service_date);
      if (oldHash === undefined) {
        counts.addedCount += 1;
        changedRows.push(row);
      } else if (oldHash !== row.source_hash) {
        counts.updatedCount += 1;
        changedRows.push(row);
      } else {
        counts.unchangedCount += 1;
      }
    }

    if (changedRows.length) {
      const fetchedAt = instant.toISOString();
      const statements = changedRows.map((row) => database.prepare(`
        INSERT INTO vendor_daily_flavors (
          vendor, service_date, flavor_name, description, image_url,
          source_url, source_hash, fetched_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(vendor, service_date) DO UPDATE SET
          flavor_name = excluded.flavor_name,
          description = excluded.description,
          image_url = excluded.image_url,
          source_url = excluded.source_url,
          source_hash = excluded.source_hash,
          fetched_at = excluded.fetched_at,
          updated_at = excluded.updated_at
        WHERE vendor_daily_flavors.source_hash <> excluded.source_hash
      `).bind(
        HISTORICAL_SQL_VENDOR,
        row.service_date,
        row.flavor_name,
        row.description,
        row.image_url,
        CAI_TEACHER_DAILY_FLAVOR_SOURCE_URL,
        row.source_hash,
        fetchedAt,
        fetchedAt,
        fetchedAt
      ));
      await runMutationBatch(database, statements);
    }

    return await finish('SUCCESS', 'complete');
  } catch (error) {
    const stage = error?.stage || (error?.code === 'TRANSACTION_FAILED' ? 'write' : 'fetch');
    const errorCode = error?.code === 'DAILY_FLAVOR_HASH_UNAVAILABLE'
      ? error.code
      : stage === 'write'
        ? 'DAILY_FLAVOR_WRITE_FAILED'
        : stage === 'hash'
          ? 'DAILY_FLAVOR_HASH_FAILED'
          : 'DAILY_FLAVOR_FETCH_FAILED';
    return await finish('FAILED', stage, errorCode);
  }
};

export const getCaiTeacherDailyFlavor = async (
  database,
  { vendor, targetDate, menu } = {}
) => {
  if (
    normalizeMenuVendor(vendor) !== HISTORICAL_SQL_VENDOR
    || !isDateOnly(targetDate)
    || !Array.isArray(menu)
    || !menu.some((item) => FLAVOR_ITEM_CODES.has(String(item?.legacy_item_id || '').trim().toUpperCase()))
  ) return null;

  const row = await database.prepare(`
    SELECT service_date, flavor_name, description, image_url
    FROM vendor_daily_flavors
    WHERE vendor = ? AND service_date = ?
    LIMIT 1
  `).bind(HISTORICAL_SQL_VENDOR, targetDate).first();
  if (!row) return null;
  return {
    service_date: row.service_date,
    name: row.flavor_name,
    description: row.description,
    image_url: row.image_url
  };
};

export const getDailyFlavorSyncStatus = async (database, now = new Date()) => {
  const serviceDate = getTaipeiDate(now instanceof Date ? now : new Date(now));
  const [countRow, run] = await Promise.all([
    database.prepare(`
      SELECT COUNT(*) AS count
      FROM vendor_daily_flavors
      WHERE vendor = ? AND service_date >= ?
    `).bind(HISTORICAL_SQL_VENDOR, serviceDate).first(),
    database.prepare(`
      SELECT status, stage, error_code, started_at, finished_at,
             parsed_count, considered_count, added_count, updated_count, unchanged_count
      FROM vendor_daily_flavor_sync_runs
      WHERE vendor = ?
      ORDER BY started_at DESC, run_id DESC
      LIMIT 1
    `).bind(HISTORICAL_SQL_VENDOR).first()
  ]);

  return {
    success: true,
    availableDateCount: Number(countRow?.count || 0),
    lastRun: run ? {
      status: run.status,
      stage: run.stage,
      errorCode: run.error_code || null,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      parsedCount: run.parsed_count,
      consideredCount: run.considered_count,
      addedCount: run.added_count,
      updatedCount: run.updated_count,
      unchangedCount: run.unchanged_count
    } : null
  };
};
