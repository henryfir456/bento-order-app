// Diagnostic log of login/bootstrap failures (migration 0031). Holds no tokens
// or identities; see the migration for the privacy rules.
export const AUTH_ERROR_RETENTION_DAYS = 14;

// Writes are throttled per Worker isolate so a retry loop or a hostile caller
// cannot turn the log into a D1 write storm.
const DEDUPE_MS = 60 * 1000;
const DEDUPE_LIMIT = 300;
const WINDOW_MS = 60 * 1000;
const WINDOW_MAX_WRITES = 40;
const recent = new Map();
let windowStart = 0;
let windowWrites = 0;

export const resetAuthErrorThrottle = () => {
  recent.clear();
  windowStart = 0;
  windowWrites = 0;
};

const allowWrite = (key, nowMs) => {
  const last = recent.get(key);
  if (last !== undefined && nowMs - last < DEDUPE_MS) return false;
  if (nowMs - windowStart >= WINDOW_MS) {
    windowStart = nowMs;
    windowWrites = 0;
  }
  if (windowWrites >= WINDOW_MAX_WRITES) return false;
  windowWrites += 1;
  if (recent.size >= DEDUPE_LIMIT) recent.clear();
  recent.set(key, nowMs);
  return true;
};

const text = (value, max, pattern = null) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, max);
  if (!trimmed) return null;
  return pattern && !pattern.test(trimmed) ? null : trimmed;
};

const integer = (value, min, max) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
};

const bit = (value) => (value === true ? 1 : value === false ? 0 : null);

// Free text is kept short and scrubbed of anything that could identify a person.
export const scrubDetail = (value) => {
  const raw = text(value, 160);
  if (!raw) return null;
  return raw
    .replace(/(access[_-]?token|id[_-]?token|authorization)\s*[:=]?\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\bU[0-9a-f]{32}\b/g, '[LINE_ID]')
    .replace(/[^\s@]+@[^\s@]+/g, '[EMAIL]')
    .replace(/\d{5,}/g, '#');
};

// Coarse device summary: OS family, browser family and the LINE app version.
export const summarizeUserAgent = (userAgent) => {
  const ua = String(userAgent || '');
  if (!ua) return null;
  const os = /Android\s([\d.]+)/.exec(ua)
    ? 'Android ' + /Android\s([\d.]+)/.exec(ua)[1].split('.')[0]
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
      : /Windows/.test(ua) ? 'Windows'
        : /Mac OS X/.test(ua) ? 'macOS'
          : /Linux/.test(ua) ? 'Linux' : 'OS?';
  const line = /\bLine\/([\d.]+)/.exec(ua);
  const browser = line ? 'LINE ' + line[1]
    : /Edg\//.test(ua) ? 'Edge'
      : /Chrome\//.test(ua) ? 'Chrome'
        : /Safari\//.test(ua) ? 'Safari'
          : /Firefox\//.test(ua) ? 'Firefox' : 'Browser?';
  return (os + ' / ' + browser).slice(0, 40);
};

export const hashClient = async (request) => {
  const address = request.headers.get('CF-Connecting-IP')?.trim() || 'unknown';
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode('auth-error-log:' + address)
  );
  return [...new Uint8Array(digest).slice(0, 4)]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const CODE = /^[A-Za-z0-9_:.\-]+$/;

// Validates a frontend report; returns null when it is unusable.
export const sanitizeClientReport = (body) => {
  const stage = text(body?.stage, 48, CODE);
  const errorCode = text(body?.errorCode, 64, CODE);
  if (!stage || !errorCode) return null;
  return {
    source: 'frontend',
    stage,
    errorCode,
    httpStatus: integer(body.httpStatus, 0, 599),
    errorClass: text(body.errorClass, 40, CODE),
    inLine: bit(body.inLine),
    appVersion: text(body.appVersion, 20, /^[0-9A-Za-z.\-+]+$/),
    detail: scrubDetail(body.detail)
  };
};

export const recordAuthError = async (database, request, entry, now = new Date()) => {
  try {
    const clientRef = await hashClient(request);
    const key = [entry.source, entry.stage, entry.errorCode, clientRef].join('|');
    if (!allowWrite(key, now.getTime())) return false;
    await database.prepare(`
      INSERT INTO auth_error_log (
        occurred_at, source, stage, error_code, http_status, error_class,
        line_profile_status, line_verify_status, duration_ms, in_line,
        app_version, ua_summary, client_ref, request_id, detail
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      now.toISOString(), entry.source, entry.stage, entry.errorCode,
      entry.httpStatus ?? null, entry.errorClass ?? null,
      entry.lineProfileStatus ?? null, entry.lineVerifyStatus ?? null,
      entry.durationMs ?? null, entry.inLine ?? null,
      entry.appVersion ?? null, summarizeUserAgent(request.headers.get('User-Agent')),
      clientRef, entry.requestId ?? null, entry.detail ?? null
    ).run();
    return true;
  } catch {
    // Diagnostics must never break or slow down the request being diagnosed.
    return false;
  }
};

export const purgeOldAuthErrors = async (database, now = new Date()) => {
  const cutoff = new Date(now.getTime() - AUTH_ERROR_RETENTION_DAYS * 86400000).toISOString();
  const result = await database.prepare(
    'DELETE FROM auth_error_log WHERE occurred_at < ?'
  ).bind(cutoff).run();
  return result?.meta?.changes ?? result?.changes ?? 0;
};
