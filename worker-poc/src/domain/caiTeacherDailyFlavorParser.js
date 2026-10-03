export const CAI_TEACHER_DAILY_FLAVOR_SOURCE_URL = 'https://www.vegetsai.com.tw/products.html#specials';

const SOURCE_IMAGE_BASE_URL = 'https://www.vegetsai.com.tw/img/sp_meals_s/';
const MAX_HTML_LENGTH = 2 * 1024 * 1024;
const MAX_ROW_COUNT = 500;

export class DailyFlavorParseError extends Error {
  constructor(code, stage = 'parse') {
    super(code);
    this.name = 'DailyFlavorParseError';
    this.code = code;
    this.stage = stage;
  }
}

const parseError = (code, stage) => {
  throw new DailyFlavorParseError(code, stage);
};

const isWhitespace = (character) => /\s/u.test(character || '');

const parseStringLiteral = (source, state) => {
  if (source[state.index] !== '"') parseError('DAILY_FLAVOR_MENU_DATA_INVALID');
  const start = state.index;
  state.index += 1;
  let escaped = false;

  while (state.index < source.length) {
    const character = source[state.index];
    if (escaped) {
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '"') {
      state.index += 1;
      try {
        return JSON.parse(source.slice(start, state.index));
      } catch {
        parseError('DAILY_FLAVOR_MENU_DATA_INVALID');
      }
    }
    state.index += 1;
  }

  return parseError('DAILY_FLAVOR_MENU_DATA_INVALID');
};

const skipWhitespace = (source, state) => {
  while (isWhitespace(source[state.index])) state.index += 1;
};

const parseObject = (source, state) => {
  if (source[state.index] !== '{') parseError('DAILY_FLAVOR_MENU_DATA_INVALID');
  state.index += 1;
  const values = Object.create(null);
  let propertyCount = 0;

  while (state.index < source.length) {
    skipWhitespace(source, state);
    if (source[state.index] === '}') {
      state.index += 1;
      if (propertyCount === 0) parseError('DAILY_FLAVOR_MENU_DATA_INVALID');
      return values;
    }

    const keyMatch = source.slice(state.index).match(/^[A-Za-z_$][\w$]*/u);
    if (!keyMatch) parseError('DAILY_FLAVOR_MENU_DATA_INVALID');
    const key = keyMatch[0];
    if (Object.hasOwn(values, key)) parseError('DAILY_FLAVOR_MENU_DATA_INVALID');
    state.index += key.length;
    skipWhitespace(source, state);
    if (source[state.index] !== ':') parseError('DAILY_FLAVOR_MENU_DATA_INVALID');
    state.index += 1;
    skipWhitespace(source, state);
    values[key] = parseStringLiteral(source, state);
    propertyCount += 1;
    skipWhitespace(source, state);

    if (source[state.index] === ',') {
      state.index += 1;
      continue;
    }
    if (source[state.index] !== '}') parseError('DAILY_FLAVOR_MENU_DATA_INVALID');
  }

  return parseError('DAILY_FLAVOR_MENU_DATA_INVALID');
};

const readMenuDataArray = (script) => {
  const assignments = Array.from(script.matchAll(/\bconst\s+menuData\s*=\s*/gu));
  if (assignments.length !== 1) parseError('DAILY_FLAVOR_MENU_DATA_AMBIGUOUS');

  const state = { index: assignments[0].index + assignments[0][0].length };
  if (script[state.index] !== '[') parseError('DAILY_FLAVOR_MENU_DATA_INVALID');
  state.index += 1;
  const records = [];
  const finishArray = () => {
    state.index += 1;
    skipWhitespace(script, state);
    if (script[state.index] !== ';') parseError('DAILY_FLAVOR_MENU_DATA_INVALID');
    if (records.length === 0) parseError('DAILY_FLAVOR_ROWS_EMPTY', 'validate');
    return records;
  };

  while (state.index < script.length) {
    skipWhitespace(script, state);
    if (script[state.index] === ']') return finishArray();

    records.push(parseObject(script, state));
    if (records.length > MAX_ROW_COUNT) parseError('DAILY_FLAVOR_ROW_COUNT_INVALID', 'validate');
    skipWhitespace(script, state);
    if (script[state.index] === ']') return finishArray();
    if (script[state.index] !== ',') parseError('DAILY_FLAVOR_MENU_DATA_INVALID');
    state.index += 1;
    skipWhitespace(script, state);
    if (script[state.index] === ']') return finishArray();
  }

  return parseError('DAILY_FLAVOR_MENU_DATA_INVALID');
};

const normalizeServiceDate = (value) => {
  const match = String(value || '').trim().match(/^(\d{4})\/(\d{2})\/(\d{2})$/u);
  if (!match) parseError('DAILY_FLAVOR_DATE_INVALID', 'validate');
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const isoDate = `${yearText}-${monthText}-${dayText}`;
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    parsedDate.getUTCFullYear() !== year
    || parsedDate.getUTCMonth() + 1 !== month
    || parsedDate.getUTCDate() !== day
  ) {
    parseError('DAILY_FLAVOR_DATE_INVALID', 'validate');
  }
  return isoDate;
};

const toDailyFlavorRow = (record) => {
  const flavorName = String(record.title || '').trim();
  if (!flavorName || flavorName.length > 160) {
    parseError('DAILY_FLAVOR_NAME_MISSING', 'validate');
  }

  const imageFile = String(record.img || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\.(?:jpe?g|png|webp|avif)$/iu.test(imageFile)) {
    parseError('DAILY_FLAVOR_IMAGE_INVALID', 'validate');
  }

  const description = String(record.note || '').trim();
  if (description.length > 500) parseError('DAILY_FLAVOR_DESCRIPTION_INVALID', 'validate');

  return {
    service_date: normalizeServiceDate(record.date),
    flavor_name: flavorName,
    description,
    image_url: `${SOURCE_IMAGE_BASE_URL}${imageFile}`
  };
};

export const parseCaiTeacherDailyFlavorHtml = (html) => {
  if (typeof html !== 'string' || !html.trim()) {
    parseError('DAILY_FLAVOR_HTML_INVALID');
  }
  if (html.length > MAX_HTML_LENGTH) parseError('DAILY_FLAVOR_HTML_TOO_LARGE');

  const scripts = Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/giu))
    .map((match) => match[1])
    .filter((script) => /\bconst\s+menuData\s*=/u.test(script));
  if (scripts.length === 0) parseError('DAILY_FLAVOR_MENU_DATA_NOT_FOUND');
  if (scripts.length !== 1) parseError('DAILY_FLAVOR_MENU_DATA_AMBIGUOUS');

  const records = readMenuDataArray(scripts[0]);
  const seenDates = new Set();
  return records.map((record) => {
    const row = toDailyFlavorRow(record);
    if (seenDates.has(row.service_date)) {
      parseError('DAILY_FLAVOR_DATE_DUPLICATE', 'validate');
    }
    seenDates.add(row.service_date);
    return row;
  });
};
