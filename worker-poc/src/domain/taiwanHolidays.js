const DATASET_URL = 'https://data.gov.tw/dataset/14718';
const SOURCE_HOST = 'https://www.dgpa.gov.tw';
const HOLIDAY_FLAG = '2';
const FALLBACK_HOLIDAY_PATTERN = /(補假|放假|國定假日|休假)/u;

const browserHeaders = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/csv;q=0.8,*/*;q=0.7',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.7',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36'
};

const decodeHtml = (value) => String(value || '')
  .replace(/&amp;/g, '&')
  .replace(/&#38;/g, '&');

const normalizeDate = (value) => {
  const raw = String(value || '').replace(/^\uFEFF/u, '').trim();
  let match = raw.match(/^(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})$/u);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (
    date.getUTCFullYear() !== Number(y)
    || date.getUTCMonth() + 1 !== Number(m)
    || date.getUTCDate() !== Number(d)
  ) return null;
  return `${y}-${m}-${d}`;
};

const parseCsvLine = (line) => {
  const fields = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        value += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      fields.push(value);
      value = '';
    } else {
      value += ch;
    }
  }
  fields.push(value);
  return fields.map((field) => field.trim());
};

export const parseGovernmentHolidayCsv = (csv) => {
  const lines = String(csv || '').replace(/^\uFEFF/u, '').split(/\r?\n/u).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((value) => value.replace(/^\uFEFF/u, ''));
  const dateIndex = headers.findIndex((value) => /西元日期/u.test(value));
  const holidayIndex = headers.findIndex((value) => /是否放假/u.test(value));
  const noteIndex = headers.findIndex((value) => /備註/u.test(value));
  if (dateIndex < 0 || holidayIndex < 0) return [];

  return lines.slice(1).reduce((rows, line) => {
    const fields = parseCsvLine(line);
    if (String(fields[holidayIndex] || '').trim() !== HOLIDAY_FLAG) return rows;
    const holidayDate = normalizeDate(fields[dateIndex]);
    if (!holidayDate) return rows;
    rows.push({
      holiday_date: holidayDate,
      holiday_name: noteIndex >= 0 ? String(fields[noteIndex] || '').trim() : ''
    });
    return rows;
  }, []);
};

const resourceUrlForYear = (html, westernYear) => {
  const rocYear = westernYear - 1911;
  const links = Array.from(String(html || '').matchAll(/href=["']([^"']+\.csv[^"']*)["'][^>]*>[\s\S]*?<\/a>/giu));
  for (const match of links) {
    const href = decodeHtml(match[1]);
    const surrounding = match[0];
    if (!new RegExp(`${rocYear}年[^<]*中華民國政府行政機關辦公日曆表`, 'u').test(surrounding)) continue;
    if (/Google行事曆/u.test(surrounding)) continue;
    return href.startsWith('http') ? href : new URL(href, SOURCE_HOST).toString();
  }
  return null;
};

export const syncTaiwanGovernmentHolidays = async (
  database,
  { fetchImpl = globalThis.fetch, now = new Date() } = {}
) => {
  const year = now.getUTCFullYear();
  const years = [year, year + 1];
  const page = await fetchImpl(DATASET_URL, { headers: browserHeaders, redirect: 'follow' });
  if (!page?.ok) return { status: 'FAILED', errorCode: 'TAIWAN_HOLIDAY_DATASET_UNAVAILABLE', importedYears: [] };
  const html = await page.text();
  const importedYears = [];
  let importedCount = 0;

  for (const targetYear of years) {
    const resourceUrl = resourceUrlForYear(html, targetYear);
    if (!resourceUrl) continue;
    const response = await fetchImpl(resourceUrl, { headers: browserHeaders, redirect: 'follow' });
    if (!response?.ok) continue;
    const holidays = parseGovernmentHolidayCsv(await response.text());
    if (!holidays.length) continue;
    const fetchedAt = now.toISOString();
    const statements = [
      database.prepare('DELETE FROM taiwan_government_holidays WHERE source_year = ?').bind(targetYear),
      ...holidays.map((row) => database.prepare(`
        INSERT INTO taiwan_government_holidays (
          holiday_date, holiday_name, source_year, source_url, fetched_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(holiday_date) DO UPDATE SET
          holiday_name = excluded.holiday_name,
          source_year = excluded.source_year,
          source_url = excluded.source_url,
          fetched_at = excluded.fetched_at
      `).bind(row.holiday_date, row.holiday_name, targetYear, resourceUrl, fetchedAt))
    ];
    if (typeof database.batch === 'function') await database.batch(statements);
    else {
      for (const statement of statements) await statement.run();
    }
    importedYears.push(targetYear);
    importedCount += holidays.length;
  }

  return importedYears.length
    ? { status: 'SUCCESS', importedYears, importedCount }
    : { status: 'FAILED', errorCode: 'TAIWAN_HOLIDAY_RESOURCE_NOT_FOUND', importedYears: [] };
};

export const loadNonWorkingDates = async (database, fromDate, toDate) => {
  const official = await database.prepare(`
    SELECT holiday_date
    FROM taiwan_government_holidays
    WHERE holiday_date BETWEEN ? AND ?
  `).bind(fromDate, toDate).all();
  const flavorRows = await database.prepare(`
    SELECT service_date, flavor_name
    FROM vendor_daily_flavors
    WHERE service_date BETWEEN ? AND ?
  `).bind(fromDate, toDate).all();
  const dates = new Set((official?.results || []).map((row) => row.holiday_date));
  for (const row of flavorRows?.results || []) {
    if (FALLBACK_HOLIDAY_PATTERN.test(String(row.flavor_name || ''))) dates.add(row.service_date);
  }
  return dates;
};
