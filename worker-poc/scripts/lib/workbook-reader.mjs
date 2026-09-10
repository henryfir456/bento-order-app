import { readFile, stat } from 'node:fs/promises';

import {
  ImportContractError,
  SHEET_DEFINITIONS,
  SHEET_NAMES,
  asText,
  canonicalColumnForHeader,
  sourceHashForBytes,
  sourceRef
} from './import-contract.mjs';

const toCanonicalRow = (sheetName, values, sourceRow, headers = []) => {
  const columns = SHEET_DEFINITIONS[sheetName].columns;
  const source = sourceRef(sheetName, sourceRow);
  if (Array.isArray(values)) {
    const indexes = new Map();
    headers.forEach((header, index) => {
      const column = canonicalColumnForHeader(header, columns);
      if (column && !indexes.has(column)) indexes.set(column, index);
    });
    return {
      ...Object.fromEntries(columns.map((column, index) => [
        column,
        values[indexes.has(column) ? indexes.get(column) : (headers.length ? -1 : index)] ?? null
      ])),
      source,
      raw: values.slice()
    };
  }

  const row = values && typeof values === 'object' ? values : {};
  return {
      ...Object.fromEntries(columns.map((column) => {
        if (row[column] !== undefined) return [column, row[column]];
        const sourceKey = Object.keys(row).find((key) => (
          canonicalColumnForHeader(key, columns) === column
        ));
        return [column, sourceKey ? row[sourceKey] : null];
      })),
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
    const missingColumns = (SHEET_DEFINITIONS[sheetName].requiredColumns || [])
      .filter((column) => !headers.some((header) => canonicalColumnForHeader(header, columns) === column));
    if (missingColumns.length) {
      shapeIssues.push({
        code: 'MISSING_COLUMNS',
        sheet: sheetName,
        expectedColumns: missingColumns,
        actualColumns: headers.slice()
      });
    }
    if (sheetName === 'Users' && !headers.some((header) => (
      canonicalColumnForHeader(header, columns) === 'employee_id'
    ))) {
      shapeIssues.push({
        code: 'EMPLOYEE_ID_FIELD_MISSING',
        sheet: sheetName,
        expectedColumns: ['employee_id'],
        actualColumns: headers.slice()
      });
    }
    return {
      headers,
      rows: rawSheet.rows.map((row, index) => (
        toCanonicalRow(sheetName, row, row?.source?.row || index + 2, headers)
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
  const missingColumns = (SHEET_DEFINITIONS[sheetName].requiredColumns || [])
    .filter((column) => !rawHeaders.some((header) => canonicalColumnForHeader(header, columns) === column));
  if (missingColumns.length) {
    shapeIssues.push({
      code: 'MISSING_COLUMNS',
      sheet: sheetName,
      expectedColumns: missingColumns,
      actualColumns: rawHeaders.slice()
    });
  }
  if (sheetName === 'Users' && !rawHeaders.some((header) => (
    canonicalColumnForHeader(header, columns) === 'employee_id'
  ))) {
    shapeIssues.push({
      code: 'EMPLOYEE_ID_FIELD_MISSING',
      sheet: sheetName,
      expectedColumns: ['employee_id'],
      actualColumns: rawHeaders.slice()
    });
  }

  return {
    headers: rawHeaders.slice(),
    rows: rawSheet.slice(1).map((row, index) => (
      toCanonicalRow(sheetName, row, index + 2, rawHeaders)
    )),
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
