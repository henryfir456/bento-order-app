import { serviceUnavailable, unauthorized } from '../http/errors.js';

export const VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';
const CACHE_MS = 5 * 60 * 1000;
const CACHE_LIMIT = 500;

// Per-isolate memo of tokens already confirmed for our channel, keyed by the
// token itself and never persisted.
const verified = new Map();

export const allowedChannelIds = (value) => String(value ?? '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

// A LINE access token is valid for any channel the user authorised, so the
// profile call alone cannot tell whether the token was issued to this app.
// LINE_CHANNEL_ID lists the allowed channel IDs (comma separated). With
// LINE_CHANNEL_MODE="enforce" a token for another channel is rejected; in any
// other mode the result is only logged, so a wrong ID cannot lock users out.
export const assertTokenIssuedForChannel = async (
  token,
  channelIds,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  mode = 'report'
) => {
  const allowed = allowedChannelIds(channelIds);
  if (!allowed.length) return;
  const enforce = String(mode ?? '').trim() === 'enforce';
  const key = allowed.join(',');
  const hit = verified.get(token);
  if (hit && hit.key === key && hit.until > now) return;

  let body;
  try {
    const response = await fetchImpl(VERIFY_URL + '?access_token=' + encodeURIComponent(token));
    if (!response?.ok) {
      const status = response?.status;
      console.warn('LINE_VERIFY_HTTP_STATUS', status);
      // 4xx other than rate limiting means LINE rejected the token itself.
      if (status >= 400 && status < 500 && status !== 429) {
        if (enforce) throw unauthorized('TOKEN_INVALID', 'LINE token verification failed.');
        return;
      }
      throw new Error('verify unavailable');
    }
    body = await response.json();
  } catch (error) {
    if (error?.status === 401) throw error;
    console.warn('LINE_VERIFY_UNAVAILABLE', error?.name || 'error');
    if (enforce) {
      throw serviceUnavailable('LINE_VERIFY_UNAVAILABLE', 'LINE verification is temporarily unavailable.');
    }
    return;
  }

  const clientId = String(body?.client_id ?? '');
  if (!allowed.includes(clientId) || !(Number(body?.expires_in) > 0)) {
    console.warn('LINE_CHANNEL_MISMATCH', clientId || 'none', enforce ? 'enforced' : 'report-only');
    if (enforce) throw unauthorized('TOKEN_INVALID', 'LINE token was not issued for this app.');
    return;
  }
  if (verified.size >= CACHE_LIMIT) verified.clear();
  verified.set(token, {
    key,
    until: now + Math.min(CACHE_MS, Number(body.expires_in) * 1000)
  });
};
