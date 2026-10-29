import { HttpError } from '../http/errors.js';

export const LOGIN_FAILURE_LIMIT = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export const loginAttemptKey = (request) => (
  'ip:' + (request.headers.get('CF-Connecting-IP')?.trim() || 'unknown')
);

const rateLimited = () => new HttpError(
  429,
  'LOGIN_RATE_LIMITED',
  'Too many failed login attempts. Please try again later.'
);

const windowOpen = (row, now) => (
  row && now.getTime() - Date.parse(row.window_start) < LOGIN_WINDOW_MS
);

export const assertLoginNotThrottled = async (database, key, now = new Date()) => {
  const row = await database.prepare(
    'SELECT window_start, fail_count FROM login_attempts WHERE attempt_key = ?'
  ).bind(key).first();
  if (windowOpen(row, now) && row.fail_count >= LOGIN_FAILURE_LIMIT) throw rateLimited();
};

export const recordLoginFailure = async (database, key, now = new Date()) => {
  const iso = now.toISOString();
  const cutoff = new Date(now.getTime() - LOGIN_WINDOW_MS).toISOString();
  await database.prepare(`
    INSERT INTO login_attempts (attempt_key, window_start, fail_count)
    VALUES (?, ?, 1)
    ON CONFLICT(attempt_key) DO UPDATE SET
      window_start = CASE WHEN window_start <= ? THEN excluded.window_start ELSE window_start END,
      fail_count = CASE WHEN window_start <= ? THEN 1 ELSE fail_count + 1 END
  `).bind(key, iso, cutoff, cutoff).run();
};
