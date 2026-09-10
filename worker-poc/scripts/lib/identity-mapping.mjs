import { readFile } from 'node:fs/promises';

import {
  ImportContractError,
  asText,
  cloneJson,
  parseEmployeeId,
  stableId
} from './import-contract.mjs';

const plainObject = (value) => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const sourceKeyFor = (record) => {
  const sheet = asText(record?.source?.sheet).trim();
  const row = Number(record?.source?.row || 0);
  return `${sheet}:${row}`;
};

const normalizeMappingObject = (value, label) => {
  if (value === undefined) return {};
  if (!plainObject(value)) {
    throw new ImportContractError(
      'IDENTITY_MAPPING_INVALID',
      `${label} must be a JSON object.`
    );
  }
  const output = {};
  for (const [key, rawEmployeeId] of Object.entries(value)) {
    const normalizedKey = asText(key).trim();
    const parsed = parseEmployeeId(rawEmployeeId);
    if (!normalizedKey || !parsed.value) {
      throw new ImportContractError(
        'IDENTITY_MAPPING_INVALID',
        `${label} contains an invalid mapping entry.`,
        { key, code: parsed.code }
      );
    }
    output[normalizedKey] = parsed.value;
  }
  return output;
};

export const emptyIdentityMap = () => ({
  bySource: {},
  byLegacyLineUserId: {}
});

export const normalizeIdentityMap = (value) => {
  if (value === undefined || value === null) return emptyIdentityMap();
  if (!plainObject(value)) {
    throw new ImportContractError(
      'IDENTITY_MAPPING_INVALID',
      'The identity mapping must be a JSON object.'
    );
  }
  return {
    bySource: normalizeMappingObject(value.bySource, 'bySource'),
    byLegacyLineUserId: normalizeMappingObject(
      value.byLegacyLineUserId,
      'byLegacyLineUserId'
    )
  };
};

export const loadIdentityMap = async (inputPath) => {
  const path = asText(inputPath).trim();
  if (!path) return emptyIdentityMap();
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new ImportContractError(
      'IDENTITY_MAPPING_UNAVAILABLE',
      'The exact employee identity mapping file could not be read.',
      { cause: error?.code || error?.message || 'invalid-json' }
    );
  }
  return normalizeIdentityMap(parsed);
};

const mapEntryFor = (record, identityMap) => ({
  source: identityMap.bySource[sourceKeyFor(record)] || null,
  line: record?.lineUserId
    ? identityMap.byLegacyLineUserId[record.lineUserId] || null
    : null
});

const identityStatus = ({ direct, source, line }) => {
  if (direct) return 'AUTO_MATCHED_BY_EMPLOYEE_ID';
  if (line) return 'AUTO_MATCHED_BY_LINE_ID';
  if (source) return 'EXPLICIT_MAPPING_APPLIED';
  return 'EXPLICIT_MAPPING_REQUIRED';
};

export const resolveSourceIdentity = (
  record,
  { byEmployeeId = new Map(), byLineUserId = new Map() } = {},
  identityMap = emptyIdentityMap()
) => {
  const employeeIssue = record?.employeeIdIssue;
  if (employeeIssue && employeeIssue !== 'EMPLOYEE_ID_REQUIRED') {
    return {
      status: employeeIssue,
      userId: null,
      employeeId: null,
      lineUserId: record?.lineUserId || null,
      evidence: { sourceKey: sourceKeyFor(record) }
    };
  }

  const direct = record?.employeeId || null;
  const mapped = mapEntryFor(record, identityMap);
  const candidates = [direct, mapped.line, mapped.source].filter(Boolean);
  if (new Set(candidates).size > 1) {
    return {
      status: 'CONFLICT',
      userId: null,
      employeeId: null,
      lineUserId: record?.lineUserId || null,
      evidence: {
        sourceKey: sourceKeyFor(record),
        candidates: [...new Set(candidates)]
      }
    };
  }

  const employeeId = candidates[0] || null;
  if (!employeeId) {
    return {
      status: 'EXPLICIT_MAPPING_REQUIRED',
      userId: null,
      employeeId: null,
      lineUserId: record?.lineUserId || null,
      evidence: { sourceKey: sourceKeyFor(record) }
    };
  }

  const employeeUser = byEmployeeId.get(employeeId) || null;
  const lineUser = record?.lineUserId
    ? byLineUserId.get(record.lineUserId) || null
    : null;
  if (employeeUser && lineUser && employeeUser.userId !== lineUser.userId) {
    return {
      status: 'CONFLICT',
      userId: null,
      employeeId,
      lineUserId: record?.lineUserId || null,
      evidence: {
        sourceKey: sourceKeyFor(record),
        employeeUserId: employeeUser.userId,
        lineUserEmployeeId: lineUser.employeeId
      }
    };
  }
  const knownUser = employeeUser || lineUser || null;
  if (knownUser && knownUser.employeeId !== employeeId) {
    return {
      status: 'CONFLICT',
      userId: null,
      employeeId,
      lineUserId: record?.lineUserId || null,
      evidence: {
        sourceKey: sourceKeyFor(record),
        existingEmployeeId: knownUser.employeeId
      }
    };
  }

  return {
    status: identityStatus({ direct, source: mapped.source, line: mapped.line }),
    userId: knownUser?.userId || stableId('user', employeeId),
    employeeId,
    lineUserId: record?.lineUserId || knownUser?.lineUserId || null,
    evidence: {
      sourceKey: sourceKeyFor(record),
      matchedBy: direct ? 'employee_id' : mapped.line ? 'reviewed_line_mapping' : 'source_mapping'
    }
  };
};

const indexUserRows = (records, identityMap) => {
  const byEmployeeId = new Map();
  const byLineUserId = new Map();
  const rows = [];
  for (const record of records) {
    const identity = resolveSourceIdentity(record, { byEmployeeId, byLineUserId }, identityMap);
    const row = { ...record, identity };
    if (identity.employeeId && identity.status !== 'CONFLICT'
      && identity.status !== 'EXPLICIT_MAPPING_REQUIRED') {
      const existingEmployee = byEmployeeId.get(identity.employeeId);
      const existingLine = identity.lineUserId ? byLineUserId.get(identity.lineUserId) : null;
      if (existingEmployee && existingEmployee.sourceKey !== sourceKeyFor(record)) {
        row.identity = {
          ...identity,
          status: 'CONFLICT',
          userId: null,
          evidence: {
            ...identity.evidence,
            duplicateEmployeeSource: existingEmployee.sourceKey
          }
        };
      } else if (existingLine && existingLine.employeeId !== identity.employeeId) {
        row.identity = {
          ...identity,
          status: 'CONFLICT',
          userId: null,
          evidence: {
            ...identity.evidence,
            conflictingLineEmployeeId: existingLine.employeeId
          }
        };
      } else {
        const indexed = {
          userId: identity.userId,
          employeeId: identity.employeeId,
          lineUserId: identity.lineUserId,
          sourceKey: sourceKeyFor(record)
        };
        byEmployeeId.set(identity.employeeId, indexed);
        if (identity.lineUserId) byLineUserId.set(identity.lineUserId, indexed);
      }
    }
    rows.push(row);
  }
  return { rows, byEmployeeId, byLineUserId };
};

const resolveDependentRows = (records, indexes, identityMap) => records.map((record) => ({
  ...record,
  identity: resolveSourceIdentity(record, indexes, identityMap)
}));

export const resolveLegacyIdentities = (normalized, { identityMap } = {}) => {
  const map = normalizeIdentityMap(identityMap);
  const userIndex = indexUserRows(normalized?.Users || [], map);
  const indexes = {
    byEmployeeId: userIndex.byEmployeeId,
    byLineUserId: userIndex.byLineUserId
  };
  return {
    ...normalized,
    identityMap: cloneJson(map),
    Users: userIndex.rows,
    Orders: resolveDependentRows(normalized?.Orders || [], indexes, map),
    Likes: resolveDependentRows(normalized?.Likes || [], indexes, map),
    TopupHistory: (normalized?.TopupHistory || []).map((record) => ({
      ...record,
      identity: resolveSourceIdentity(record, indexes, map),
      operatorIdentity: resolveSourceIdentity({
        ...record,
        employeeId: record.operatorEmployeeId,
        employeeIdIssue: record.operatorEmployeeIdIssue,
        lineUserId: record.operatorLineUserId,
        source: record.source
      }, indexes, map)
    })),
    identityIndexes: indexes
  };
};

export { sourceKeyFor };
