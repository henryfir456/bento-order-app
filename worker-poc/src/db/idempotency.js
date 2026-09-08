import { badRequest, conflict } from '../http/errors.js';
import { prepareStatement, randomId, runMutationBatch } from './transactions.js';

const MAX_KEY_LENGTH = 200;

const hasControlCharacter = (value) => Array.from(value).some((character) => {
  const code = character.charCodeAt(0);
  return code < 32 || code === 127;
});

const assertText = (value, code) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw badRequest(code);
  return text;
};

export const requireIdempotencyKey = (value) => {
  const key = assertText(value, 'IDEMPOTENCY_REQUIRED');
  if (key.length > MAX_KEY_LENGTH || hasControlCharacter(key)) {
    throw badRequest('IDEMPOTENCY_KEY_INVALID');
  }
  return key;
};

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .reduce((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
      }, {});
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError('Idempotency payload must contain finite numbers.');
  }
  return value;
};

export const canonicalJson = (value) => JSON.stringify(canonicalize(value));

export const hashRequest = async (value) => {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is required for request hashing.');
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const claimParams = ({ actorLineUserId, operation, idempotencyKey, requestHash, claimToken }) => [
  actorLineUserId,
  operation,
  idempotencyKey,
  requestHash,
  claimToken
];

export const idempotencyGuard = (details) => ({
  sql: `EXISTS (
    SELECT 1
    FROM idempotency_keys
    WHERE actor_line_user_id = ?
      AND operation = ?
      AND idempotency_key = ?
      AND request_hash = ?
      AND claim_token = ?
      AND status = 'IN_PROGRESS'
  )`,
  params: claimParams(details)
});

export const beginIdempotentOperation = (database, {
  actorLineUserId,
  operation,
  idempotencyKey,
  requestHash,
  claimToken = randomId('claim'),
  occurredAt
}) => prepareStatement(database, `
  INSERT OR IGNORE INTO idempotency_keys (
    actor_line_user_id, operation, idempotency_key, request_hash,
    claim_token, status, created_at
  )
  VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS', ?)
`, [actorLineUserId, operation, idempotencyKey, requestHash, claimToken, occurredAt]);

export const completeIdempotentOperation = (database, {
  actorLineUserId,
  operation,
  idempotencyKey,
  requestHash,
  claimToken,
  occurredAt,
  responseSpec
}) => {
  if (!responseSpec?.trusted || typeof responseSpec.expression !== 'string') {
    throw new TypeError('A trusted stored response specification is required.');
  }
  return prepareStatement(database, `
    UPDATE idempotency_keys
    SET status = 'COMPLETED',
        response_json = ${responseSpec.expression},
        completed_at = ?
    WHERE actor_line_user_id = ?
      AND operation = ?
      AND idempotency_key = ?
      AND request_hash = ?
      AND claim_token = ?
      AND status = 'IN_PROGRESS'
  `, [
    ...responseSpec.params,
    occurredAt,
    actorLineUserId,
    operation,
    idempotencyKey,
    requestHash,
    claimToken
  ]);
};

export const readIdempotencyRecord = async (
  database,
  { actorLineUserId, operation, idempotencyKey }
) => prepareStatement(database, `
  SELECT actor_line_user_id, operation, idempotency_key, request_hash,
         claim_token, status, response_json, created_at, completed_at
  FROM idempotency_keys
  WHERE actor_line_user_id = ? AND operation = ? AND idempotency_key = ?
  LIMIT 1
`, [actorLineUserId, operation, idempotencyKey]).first();

export const mutationResponseSpec = ({
  message,
  orderId,
  balanceUserId
}) => ({
  trusted: true,
  expression: `json_object(
    'success', json('true'),
    'message', ?,
    'orderId', ?,
    'newBalance', (SELECT balance FROM users WHERE line_user_id = ?)
  )`,
  params: [message, orderId, balanceUserId]
});

export const balanceMutationResponseSpec = ({
  message,
  targetLineUserId,
  balanceUserId,
  transactionId
}) => ({
  trusted: true,
  expression: `json_object(
    'success', json('true'),
    'message', ?,
    'targetUserId', ?,
    'transactionId', ?,
    'newBalance', (SELECT balance FROM users WHERE line_user_id = ?)
  )`,
  params: [message, targetLineUserId, transactionId, balanceUserId]
});

export const parseStoredResponse = (record) => {
  try {
    return JSON.parse(record.response_json);
  } catch {
    const error = new Error('Stored idempotency response is invalid.');
    error.code = 'IDEMPOTENCY_RESPONSE_INVALID';
    throw error;
  }
};

export const readExistingIdempotencyResult = async (
  database,
  { actorLineUserId, operation, idempotencyKey, requestHash }
) => {
  const record = await readIdempotencyRecord(database, {
    actorLineUserId, operation, idempotencyKey
  });
  if (!record) return null;
  if (record.request_hash !== requestHash) throw conflict('IDEMPOTENCY_CONFLICT');
  if (record.status === 'COMPLETED') return parseStoredResponse(record);
  if (record.status === 'IN_PROGRESS') throw conflict('IDEMPOTENCY_IN_PROGRESS');
  throw conflict('IDEMPOTENCY_FAILED');
};

export const runIdempotentMutation = async (database, {
  actorLineUserId,
  operation,
  idempotencyKey,
  requestHash,
  occurredAt,
  responseSpec,
  buildStatements,
  claimToken = randomId('claim')
}) => {
  const details = {
    actorLineUserId,
    operation,
    idempotencyKey,
    requestHash,
    claimToken
  };
  const statements = [beginIdempotentOperation(database, {
    ...details,
    occurredAt
  })];
  const built = await buildStatements({ ...details, guard: idempotencyGuard(details) });
  if (!Array.isArray(built) || built.length === 0) {
    throw new TypeError('An idempotent mutation must provide mutation statements.');
  }
  statements.push(...built);
  statements.push(completeIdempotentOperation(database, {
    ...details,
    occurredAt,
    responseSpec
  }));

  await runMutationBatch(database, statements);
  const record = await readIdempotencyRecord(database, {
    actorLineUserId, operation, idempotencyKey
  });
  if (!record) throw new Error('Idempotency claim disappeared after commit.');
  if (record.request_hash !== requestHash) throw conflict('IDEMPOTENCY_CONFLICT');
  if (record.status === 'COMPLETED') return parseStoredResponse(record);
  if (record.status === 'IN_PROGRESS') throw conflict('IDEMPOTENCY_IN_PROGRESS');
  throw conflict('IDEMPOTENCY_FAILED');
};
