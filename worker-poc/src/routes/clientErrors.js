import { badRequest } from '../http/errors.js';
import { jsonResponse } from '../http/response.js';
import { recordAuthError, sanitizeClientReport } from '../auth/authErrorLog.js';

const MAX_BODY_BYTES = 2048;

// Write-only endpoint: a failed login has no credential to present, so it is
// unauthenticated, size-limited, validated field by field and write-throttled.
export const handleClientErrorRoute = async (request, env, { now = new Date() } = {}) => {
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== '/api/client-errors') return null;
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) throw badRequest('REPORT_TOO_LARGE');
  let body;
  try { body = JSON.parse(raw); } catch { throw badRequest('INVALID_JSON'); }
  const entry = sanitizeClientReport(body);
  if (!entry) throw badRequest('REPORT_INVALID');
  entry.requestId = request.headers.get('X-Request-Id') || null;
  await recordAuthError(env.DB, request, entry, now);
  return jsonResponse({ ok: true }, 202);
};
