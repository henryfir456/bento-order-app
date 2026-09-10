import {
  APPROVED_BACKUP_SHA256,
  FORMAL_CLEANUP_TARGET,
  runFormalCleanup
} from '../scripts/lib/formal-cleanup.mjs';

export const REMOTE_CLEANUP_PATH = '/__bento-maintenance/formal-cleanup';
export const REMOTE_CLEANUP_HEALTH_PATH = '/__bento-maintenance/health';
export const REMOTE_CLEANUP_SESSION_HEADER = 'X-Bento-Maintenance-Session';

const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8' }
});

const errorResponse = (code, message, status = 400, details = undefined) => (
  jsonResponse({
    success: false,
    error: { code, message, ...(details === undefined ? {} : { details }) }
  }, status)
);

const requireDatabase = (env) => {
  if (!env?.DB || typeof env.DB.prepare !== 'function' || typeof env.DB.batch !== 'function') {
    const error = new Error('The formal D1 binding is unavailable.');
    error.code = 'REMOTE_D1_BINDING_UNAVAILABLE';
    throw error;
  }
  return env.DB;
};

const readContentLength = (request) => {
  const value = request.headers.get('content-length');
  if (!value) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const sessionMatches = (request, env) => {
  const expected = String(env?.MAINTENANCE_SESSION_TOKEN || '');
  const supplied = request.headers.get(REMOTE_CLEANUP_SESSION_HEADER) || '';
  return Boolean(expected) && supplied === expected;
};

const assertRuntimeTarget = (env) => {
  const target = String(env?.CLEANUP_TARGET_NAME || '').trim();
  const databaseId = String(env?.CLEANUP_DATABASE_ID || '').trim();
  if (target !== FORMAL_CLEANUP_TARGET.name) {
    const error = new Error('The maintenance Worker is not configured for bento-formal.');
    error.code = 'CLEANUP_TARGET_INVALID';
    throw error;
  }
  if (databaseId !== FORMAL_CLEANUP_TARGET.databaseId) {
    const error = new Error('The maintenance Worker has the wrong formal D1 UUID.');
    error.code = 'CLEANUP_DATABASE_ID_INVALID';
    throw error;
  }
  return { target, databaseId };
};

const assertExpectedBackupHash = (body, env) => {
  const expected = String(env?.EXPECTED_BACKUP_SHA256 || '').trim().toLowerCase();
  const supplied = String(body?.expectedBackupSha256 || '').trim().toLowerCase();
  if (!SHA256_PATTERN.test(expected)
    || !SHA256_PATTERN.test(supplied)
    || expected !== APPROVED_BACKUP_SHA256
    || supplied !== expected) {
    const error = new Error('The backup SHA256 does not match the adapter session.');
    error.code = 'CLEANUP_BACKUP_HASH_INVALID';
    throw error;
  }
  return expected;
};

const summarizeCleanupResult = (result) => ({
  kind: result?.kind,
  mode: result?.mode,
  target: result?.target,
  baselineProvided: result?.baselineProvided,
  baselineMatches: result?.baselineMatches,
  baselineMismatches: result?.baselineMismatches || [],
  readyForExecute: result?.readyForExecute,
  before: result?.before,
  after: result?.after,
  reconciliation: result?.reconciliation
});

const parseRequestBody = async (request) => {
  const contentLength = readContentLength(request);
  if (contentLength !== null && contentLength > MAX_REQUEST_BYTES) {
    const error = new Error('The maintenance request body is too large.');
    error.code = 'CLEANUP_REQUEST_TOO_LARGE';
    throw error;
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
    const error = new Error('The maintenance request body is too large.');
    error.code = 'CLEANUP_REQUEST_TOO_LARGE';
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error('The maintenance request body must be valid JSON.');
    error.code = 'CLEANUP_REQUEST_INVALID_JSON';
    throw error;
  }
};

export const createRemoteCleanupHandler = ({ cleanup = runFormalCleanup } = {}) => (
  async (request, env) => {
    if (!sessionMatches(request, env)) {
      return errorResponse('REMOTE_MAINTENANCE_UNAUTHORIZED', 'Maintenance session is invalid.', 401);
    }

    try {
      const runtimeTarget = assertRuntimeTarget(env);
      if (request.method === 'GET' && new URL(request.url).pathname === REMOTE_CLEANUP_HEALTH_PATH) {
        requireDatabase(env);
        return jsonResponse({
          success: true,
          target: {
            name: runtimeTarget.target,
            databaseId: runtimeTarget.databaseId
          },
          mode: 'read-only'
        });
      }
      if (request.method !== 'POST' || new URL(request.url).pathname !== REMOTE_CLEANUP_PATH) {
        return errorResponse('REMOTE_MAINTENANCE_NOT_FOUND', 'Maintenance route not found.', 404);
      }

      const body = await parseRequestBody(request);
      const expectedBackupSha256 = assertExpectedBackupHash(body, env);
      const mode = body?.mode || 'dry-run';
      if (mode !== 'dry-run' && mode !== 'execute') {
        return errorResponse('CLEANUP_MODE_INVALID', 'Cleanup mode must be dry-run or execute.');
      }
      if (!body?.baseline) {
        return errorResponse('CLEANUP_BASELINE_REQUIRED', 'A reviewed cleanup baseline is required.');
      }
      const confirmed = body?.confirmation === 'CONFIRM_REMOTE_CLEANUP=YES';
      if (mode === 'execute' && !confirmed) {
        return errorResponse(
          'CLEANUP_CONFIRMATION_REQUIRED',
          'Execute mode requires CONFIRM_REMOTE_CLEANUP=YES.'
        );
      }

      const result = await cleanup(requireDatabase(env), {
        target: runtimeTarget.target,
        databaseId: runtimeTarget.databaseId,
        configuredDatabaseId: runtimeTarget.databaseId,
        baseline: body.baseline,
        dryRun: mode === 'dry-run',
        confirmed,
        executionMode: 'remote',
        remoteExecutionAuthorized: true
      });

      return jsonResponse({
        success: true,
        expectedBackupSha256,
        result: summarizeCleanupResult(result)
      });
    } catch (error) {
      const status = error?.code === 'REMOTE_MAINTENANCE_UNAUTHORIZED' ? 401 : 409;
      return errorResponse(
        error?.code || 'REMOTE_CLEANUP_FAILED',
        error?.message || 'Remote cleanup failed closed.',
        status,
        error?.details
      );
    }
  }
);

export const handleRemoteCleanupRequest = createRemoteCleanupHandler();

export default {
  fetch: handleRemoteCleanupRequest
};
