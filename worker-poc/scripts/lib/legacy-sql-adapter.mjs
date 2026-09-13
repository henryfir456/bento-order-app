import { readFile } from 'node:fs/promises';

import {
  asNullableText,
  parseEmployeeId,
  parseInteger,
  parseTimestamp,
  sourceHashForBytes
} from './import-contract.mjs';

const TABLES = Object.freeze([
  'bento_order_count',
  'bento_order_status',
  'bento_price',
  'bento_type'
]);

const STATUS_TABLE = 'bento_order_status';

const decodeSqlString = (value) => value
  .replace(/^N'/i, "'")
  .replace(/^'/, '')
  .replace(/'$/, '')
  .replace(/''/g, "'");

const splitSqlValues = (value) => {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "'") {
      if (quoted && value[index + 1] === "'") {
        index += 1;
        continue;
      }
      quoted = !quoted;
    } else if (!quoted && character === '(') {
      depth += 1;
    } else if (!quoted && character === ')') {
      depth -= 1;
    } else if (!quoted && depth === 0 && character === ',') {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
};

const parseSqlValue = (token) => {
  const value = token.trim();
  if (/^NULL$/i.test(value)) return null;
  const casted = value.match(/^CAST\((N?'(?:''|[^'])*')\s+AS\s+[^)]+\)$/i);
  if (casted) return decodeSqlString(casted[1]);
  if (/^N?'(?:''|[^'])*'$/.test(value)) return decodeSqlString(value);
  if (/^[+-]?\d+$/.test(value)) return Number(value);
  return value;
};

const decodeInput = (input) => {
  if (typeof input === 'string') {
    return { text: input.replace(/^\uFEFF/, ''), encoding: 'text' };
  }
  const bytes = Buffer.from(input);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: bytes.toString('utf16le').replace(/^\uFEFF/, ''), encoding: 'utf16le' };
  }
  return { text: bytes.toString('utf8').replace(/^\uFEFF/, ''), encoding: 'utf8' };
};

const normalizeSqlEmployeeId = (value) => {
  const parsed = parseEmployeeId(value);
  if (!parsed.value) return parsed;
  return { value: parsed.value.trim().toUpperCase(), code: null };
};

const parseInsertStatements = (text) => {
  const inserts = [];
  const lineStarts = [0];
  for (let lineIndex = 0; lineIndex < text.length; lineIndex += 1) {
    if (text[lineIndex] === '\n') lineStarts.push(lineIndex + 1);
  }
  const sourceRowAt = (offset) => {
    let low = 0;
    let high = lineStarts.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (lineStarts[middle] <= offset) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const headerPattern = /INSERT\s+\[dbo\]\.\[([^\]]+)\]\s*\(([\s\S]*?)\)\s+VALUES\s*\(/gi;
  let match;
  while ((match = headerPattern.exec(text)) !== null) {
    const valueStart = headerPattern.lastIndex;
    let index = valueStart;
    let depth = 1;
    let quoted = false;
    for (; index < text.length; index += 1) {
      const character = text[index];
      if (character === "'") {
        if (quoted && text[index + 1] === "'") {
          index += 1;
          continue;
        }
        quoted = !quoted;
      } else if (!quoted && character === '(') {
        depth += 1;
      } else if (!quoted && character === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const columns = [...match[2].matchAll(/\[([^\]]+)\]/g)].map((item) => item[1]);
    const values = index < text.length
      ? splitSqlValues(text.slice(valueStart, index)).map(parseSqlValue)
      : [];
    inserts.push({
      table: match[1],
      sourceRow: sourceRowAt(match.index),
      malformed: index >= text.length || columns.length !== values.length,
      row: Object.fromEntries(columns.map((column, valueIndex) => [column, values[valueIndex]])),
      columns,
      values
    });
    headerPattern.lastIndex = Math.max(index + 1, valueStart);
  }
  return inserts;
};

const baseFact = ({ table, sourceRow, row, normalizedEmployeeId = null, identityIssue = null }) => ({
  normalizedEmployeeId,
  identityIssue,
  sourceTable: table,
  sourceRow,
  sourceId: parseInteger(row.id),
  ownerIdentitySource: normalizedEmployeeId ? 'username' : null,
  rawEvidence: { ...row }
});

const employeeEvidence = (row) => {
  const identity = normalizeSqlEmployeeId(row.username);
  return {
    normalizedEmployeeId: identity.value,
    identityIssue: identity.code
  };
};

const parseCountFact = (insert, sourceRow) => {
  const identity = employeeEvidence(insert.row);
  return {
    kind: 'HISTORICAL_ORDER_FACT',
    ...baseFact({ table: insert.table, sourceRow, row: insert.row, ...identity }),
    originalEventType: 'order_count',
    occurredAt: parseTimestamp(insert.row.dt_update),
    yymmBento: asNullableText(insert.row.yymm_bento),
    ddBento: asNullableText(insert.row.dd_bento),
    bentoType: asNullableText(insert.row.bento_type),
    quantity: parseInteger(insert.row.cnt),
    vegType: asNullableText(insert.row.veg_type),
    syntheticOrderId: false
  };
};

const parseStatusFact = (insert, sourceRow) => {
  const identity = employeeEvidence(insert.row);
  const base = {
    ...baseFact({ table: insert.table, sourceRow, row: insert.row, ...identity }),
    originalEventType: asNullableText(insert.row.status)?.toLowerCase() || null,
    occurredAt: parseTimestamp(insert.row.dt_update),
    yymmBento: asNullableText(insert.row.yymm_bento),
    ddBento: asNullableText(insert.row.dd_bento),
    memo: asNullableText(insert.row.memo),
    receivePlace: asNullableText(insert.row.receive_place),
    wallet: parseInteger(insert.row.wallet)
  };
  if (base.originalEventType === 'order') {
    return {
      kind: 'HISTORICAL_ORDER_FACT',
      ...base,
      syntheticOrderId: false
    };
  }
  if (base.originalEventType === 'heart' || base.originalEventType === 'heart-outline') {
    return { kind: 'HISTORICAL_LIKE_EVENT', ...base };
  }
  if (base.originalEventType === 'wallet_add' || base.originalEventType === 'wallet_sub') {
    return { kind: 'HISTORICAL_WALLET_EVENT', ...base };
  }
  return null;
};

const parseMenuFact = (insert, sourceRow) => ({
  kind: 'HISTORICAL_MENU_FACT',
  ...baseFact({ table: insert.table, sourceRow, row: insert.row }),
  type: asNullableText(insert.row.tp),
  name: asNullableText(insert.row.name),
  price: parseInteger(insert.row.price),
  yymmBento: asNullableText(insert.row.yymm_bento),
  createdAt: parseTimestamp(insert.row.dt_create),
  updatedAt: parseTimestamp(insert.row.dt_update)
});

const parseTypeFact = (insert, sourceRow) => ({
  kind: 'HISTORICAL_TYPE_FACT',
  ...baseFact({ table: insert.table, sourceRow, row: insert.row }),
  viewType: asNullableText(insert.row.view_tp),
  type: asNullableText(insert.row.tp),
  name: asNullableText(insert.row.name),
  createdAt: parseTimestamp(insert.row.dt_create),
  updatedAt: parseTimestamp(insert.row.dt_update)
});

export const parseLegacySqlDump = (input) => {
  const { text, encoding } = decodeInput(input);
  const sourceHash = Buffer.isBuffer(input) || input instanceof Uint8Array
    ? sourceHashForBytes(input)
    : sourceHashForBytes(Buffer.from(`\uFEFF${text}`, 'utf16le'));
  const tableRowCounts = Object.fromEntries(TABLES.map((table) => [table, 0]));
  const historicalOrderFacts = [];
  const historicalLikeFacts = [];
  const historicalWalletFacts = [];
  const historicalMenuFacts = [];
  const historicalTypeFacts = [];
  const sourceShapeIssues = [];
  const usernamesByNormalizedId = new Map();
  const statusCounts = {};

  for (const insert of parseInsertStatements(text)) {
    const { sourceRow } = insert;
    if (!TABLES.includes(insert.table)) continue;
    if (insert.malformed) {
      sourceShapeIssues.push({ code: 'SQL_INSERT_SHAPE_INVALID', sourceTable: insert.table, sourceRow });
      continue;
    }
    tableRowCounts[insert.table] += 1;
    const identity = employeeEvidence(insert.row);
    if (identity.normalizedEmployeeId) {
      const values = usernamesByNormalizedId.get(identity.normalizedEmployeeId) || new Set();
      values.add(asNullableText(insert.row.username));
      usernamesByNormalizedId.set(identity.normalizedEmployeeId, values);
    }

    if (insert.table === 'bento_order_count') {
      historicalOrderFacts.push(parseCountFact(insert, sourceRow));
    } else if (insert.table === STATUS_TABLE) {
      const eventType = asNullableText(insert.row.status)?.toLowerCase() || 'null';
      statusCounts[eventType] = (statusCounts[eventType] || 0) + 1;
      const fact = parseStatusFact(insert, sourceRow);
      if (fact?.kind === 'HISTORICAL_ORDER_FACT') historicalOrderFacts.push(fact);
      if (fact?.kind === 'HISTORICAL_LIKE_EVENT') historicalLikeFacts.push(fact);
      if (fact?.kind === 'HISTORICAL_WALLET_EVENT') historicalWalletFacts.push(fact);
    } else if (insert.table === 'bento_price') {
      historicalMenuFacts.push(parseMenuFact(insert, sourceRow));
    } else if (insert.table === 'bento_type') {
      historicalTypeFacts.push(parseTypeFact(insert, sourceRow));
    }
  }

  const normalizationCollisions = [...usernamesByNormalizedId.entries()]
    .filter(([, values]) => values.size > 1)
    .map(([normalizedEmployeeId, values]) => ({
      normalizedEmployeeId,
      rawValues: [...values].sort()
    }));
  return {
    adapterVersion: 1,
    encoding,
    sourceHash,
    tableRowCounts,
    statusCounts,
    sourceShapeIssues,
    normalizationCollisions,
    sqlHistoricalIdentityCount: usernamesByNormalizedId.size,
    historicalOrderFacts,
    historicalLikeFacts,
    historicalWalletFacts,
    historicalMenuFacts,
    historicalTypeFacts
  };
};

export const readLegacySqlDump = async (inputPath) => {
  const bytes = await readFile(inputPath);
  return parseLegacySqlDump(bytes);
};

export const SqlServerDumpAdapter = Object.freeze({
  name: 'SqlServerDumpAdapter',
  parse: parseLegacySqlDump,
  read: readLegacySqlDump
});

export { normalizeSqlEmployeeId };
