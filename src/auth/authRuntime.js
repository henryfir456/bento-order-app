export const redactAuthSecrets = (value) => String(value || 'Unknown error')
  .replace(/(access[_-]?token|id[_-]?token|authorization)\s*[:=]?\s*[^\s,;]+/gi, '$1=[REDACTED]')
  .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]');

export const requireAuthoritativeIdentityState = (data) => {
  const identityState = data?.user?.identityState || data?.identityState;
  if (typeof identityState !== 'string' || !identityState.trim()) {
    throw new Error('IDENTITY_STATE_MISSING');
  }
  return identityState;
};
