import { forbidden } from '../http/errors.js';

const LINE_BOT_PROFILE_URL = 'https://api.line.me/v2/bot/profile/';
const LINE_FRIENDSHIP_TIMEOUT_MS = 3000;

// Is this user a friend of the LINE official account (Messaging API channel)?
// Messaging API "Get profile" answers 200 for a friend and 404 when the user
// is not a friend or has blocked the account. Anything else (no token, no LINE
// binding, timeout, 401/429/5xx) is UNKNOWN so the UI never shows a false alarm.
export const getLineFriendship = async (env, identity, { fetchImpl = globalThis.fetch } = {}) => {
  const lineUserId = String(identity?.actor?.lineUserId || '').trim();
  const token = env?.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
  if (!identity?.actor?.userId) throw forbidden('AUTH_REQUIRED');
  if (!token || !lineUserId) return { success: true, status: 'UNKNOWN' };
  try {
    const response = await fetchImpl(`${LINE_BOT_PROFILE_URL}${encodeURIComponent(lineUserId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(LINE_FRIENDSHIP_TIMEOUT_MS)
    });
    if (response.status === 200) return { success: true, status: 'FRIEND' };
    if (response.status === 404) return { success: true, status: 'NOT_FRIEND' };
    return { success: true, status: 'UNKNOWN' };
  } catch {
    return { success: true, status: 'UNKNOWN' };
  }
};
