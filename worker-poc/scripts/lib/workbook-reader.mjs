import { readFile, stat } from 'node:fs/promises';

import {
  ImportContractError,
  SHEET_DEFINITIONS,
  SHEET_NAMES,
  asText,
  sourceHashForBytes,
  sourceRef
} from './import-contract.mjs';

const toCanonicalRow = (sheetName, values, sourceRow) => {
  const columns = SHEET_DEFINITIONS[sheetName].columns;
  const source = sourceRef(sheetName, sourceRow);
  if (Array.isArray(values)) {
    return {
      ...Object.fromEntries(columns.map((column, index) => [column, values[index] ?? null])),
      source,
      raw: values.slice()
    };
  }

  const row = values && typeof values === 'object' ? values : {};
  return {
    ...Object.fromEntries(columns.map((column) => [column, row[column] ?? null])),
    source: row.source || source,
    raw: row.raw || { ...row }
  };
};

const canonicalizeSheet = (sheetName, rawSheet, shapeIssues) => {
  const columns = SHEET_DEFINITIONS[sheetName].columns;
  if (rawSheet === null || rawSheet === undefined) {
    shapeIssues.push({
      code: 'MISSING_SHEET',
      sheet: sheetName,
      expectedColumns: columns.slice()
    });
    return { headers: columns.slice(), rows: [], missing: true };
  }

  if (rawSheet && !Array.isArray(rawSheet) && Array.isArray(rawSheet.rows)) {
    const headers = Array.isArray(rawSheet.headers)
      ? rawSheet.headers.slice()
      : columns.slice();
    if (headers.length < columns.length) {
      shapeIssues.push({
        code: 'MISSING_COLUMNS',
        sheet: sheetName,
        expectedColumns: columns.slice(),
        actualColumns: headers.slice()
      });
    }
    return {
      headers,
      rows: rawSheet.rows.map((row, index) => (
        toCanonicalRow(sheetName, row, row?.source?.row || index + 2)
      )),
      missing: false
    };
  }

  if (!Array.isArray(rawSheet) || rawSheet.length === 0) {
    shapeIssues.push({
      code: 'MISSING_COLUMNS',
      sheet: sheetName,
      expectedColumns: columns.slice(),
      actualColumns: []
    });
    return { headers: [], rows: [], missing: false };
  }

  const rawHeaders = Array.isArray(rawSheet[0]) ? rawSheet[0] : [];
  if (rawHeaders.length < columns.length) {
    shapeIssues.push({
      code: 'MISSING_COLUMNS',
      sheet: sheetName,
      expectedColumns: columns.slice(),
      actualColumns: rawHeaders.slice()
    });
  }

  return {
    headers: rawHeaders.slice(),
    rows: rawSheet.slice(1).map((row, index) => toCanonicalRow(sheetName, row, index + 2)),
    missing: false
  };
};

export const canonicalizeWorkbook = (rawWorkbook) => {
  const sources = rawWorkbook?.sheets || rawWorkbook || {};
  const shapeIssues = [];
  const sheets = Object.fromEntries(
    SHEET_NAMES.map((sheetName) => [
      sheetName,
      canonicalizeSheet(sheetName, sources[sheetName], shapeIssues)
    ])
  );
  return { sheets, shapeIssues };
};

const readWithXlsx = async (bytes) => {
  let xlsx;
  try {
    xlsx = await import('xlsx');
  } catch (error) {
    throw new ImportContractError(
      'WORKBOOK_READER_UNAVAILABLE',
      'The XLSX adapter is not installed; inject an adapter for validation tests.',
      { cause: error?.code || error?.message || 'unknown' }
    );
  }

  const module = xlsx.default || xlsx;
  const workbook = module.read(bytes, { type: 'buffer', cellDates: true });
  return Object.fromEntries(SHEET_NAMES.map((sheetName) => {
    const worksheet = workbook.Sheets?.[sheetName];
    if (!worksheet) return [sheetName, null];
    return [
      sheetName,
      module.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: null,
        raw: true
      })
    ];
  }));
};

export const readLegacyWorkbook = async (inputPath, { adapter } = {}) => {
  const path = asText(inputPath).trim();
  if (!path) {
    throw new ImportContractError('WORKBOOK_PATH_REQUIRED', 'A local workbook path is required.');
  }

  const fileInfo = await stat(path).catch((error) => {
    throw new ImportContractError('WORKBOOK_NOT_FOUND', 'The local workbook path is unavailable.', {
      cause: error?.code || error?.message || 'unknown'
    });
  });
  if (!fileInfo.isFile()) {
    throw new ImportContractError('WORKBOOK_NOT_FILE', 'The workbook input must be a file.');
  }

  const bytes = await readFile(path);
  const rawWorkbook = adapter
    ? await adapter.read(path, bytes)
    : await readWithXlsx(bytes);
  const canonical = canonicalizeWorkbook(rawWorkbook);
  return {
    ...canonical,
    inputPath: path,
    sourceHash: sourceHashForBytes(bytes)
  };
};
