import { unauthorized } from '../http/errors.js';

export const VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';
const CACHE_MS = 5 * 60 * 1000;
const CACHE_LIMIT = 500;

// Per-isolate memo of tokens already confirmed for our channel, keyed by the
// token itself and never persisted.
const verified = new Map();

// A LINE access token is valid for any channel the user authorised, so the
// profile call alone cannot tell whether the token was issued to this app.
// When LINE_CHANNEL_ID is configured, require the token's client_id to match.
export const assertTokenIssuedForChannel = async (
  token,
  channelId,
  fetchImpl = globalThis.fetch,
  now = Date.now()
) => {
  const expected = String(channelId ?? '').trim();
  if (!expected) return;
  const hit = verified.get(token);
  if (hit && hit.expected === expected && hit.until > now) return;
  let body;
  try {
    const response = await fetchImpl(VERIFY_URL + '?access_token=' + encodeURIComponent(token));
    if (!response?.ok) throw new Error('verify');
    body = await response.json();
  } catch {
    throw unauthorized('TOKEN_INVALID', 'LINE token verification failed.');
  }
  if (String(body?.client_id ?? '') !== expected || !(Number(body?.expires_in) > 0)) {
    throw unauthorized('TOKEN_INVALID', 'LINE token was not issued for this app.');
  }
  if (verified.size >= CACHE_LIMIT) verified.clear();
  verified.set(token, {
    expected,
    until: now + Math.min(CACHE_MS, Number(body.expires_in) * 1000)
  });
};
