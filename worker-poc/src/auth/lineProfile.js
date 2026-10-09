import { HttpError, unauthorized } from '../http/errors.js';
import { createDeadline } from '../../../src/auth/asyncDeadline.js';

const PROFILE_URL = 'https://api.line.me/v2/profile';

export const fetchLineProfile = async (
  accessToken,
  fetchImpl = globalThis.fetch,
  profileUrl = PROFILE_URL
) => {
  const token = typeof accessToken === 'string' ? accessToken.trim() : '';
  if (!token) throw unauthorized('TOKEN_INVALID', 'A LINE access token is required.');
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required.');
  }

  const deadline = createDeadline({
    timeoutMs: 8000,
    error: new HttpError(503, 'LINE_PROFILE_TIMEOUT', 'LINE verification timed out. Please retry.')
  });
  try {
  let response;
  try {
    response = await deadline.wait(() => fetchImpl(profileUrl, {
      headers: { Authorization: 'Bearer ' + token }, signal: deadline.signal
    }));
  } catch (error) {
    if (error?.code === 'LINE_PROFILE_TIMEOUT') throw error;
    throw unauthorized('TOKEN_INVALID', 'LINE profile verification failed.');
  }

  if (!response?.ok) {
    if (response?.status === 401 || response?.status === 403) {
      throw unauthorized('TOKEN_INVALID', 'LINE access token was rejected.');
    }
    throw unauthorized('TOKEN_INVALID', 'LINE profile verification was unavailable.');
  }

  let profile;
  try {
    profile = await deadline.wait(() => response.json());
  } catch (error) {
    if (error?.code === 'LINE_PROFILE_TIMEOUT') throw error;
    throw unauthorized('TOKEN_INVALID', 'LINE profile response was invalid.');
  }

  const lineUserId = typeof profile?.userId === 'string' ? profile.userId.trim() : '';
  if (!lineUserId) {
    throw unauthorized('TOKEN_INVALID', 'LINE profile did not contain a user ID.');
  }

  return {
    lineUserId,
    displayName: typeof profile.displayName === 'string'
      ? profile.displayName.trim()
      : ''
  };
  } finally {
    deadline.dispose();
  }
};

export { PROFILE_URL };
