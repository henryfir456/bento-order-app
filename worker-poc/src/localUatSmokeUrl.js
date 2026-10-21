const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export const normalizeLocalUatApiBase = (value) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('LOCAL_UAT_API_URL_MUST_BE_LOOPBACK_HTTP');
  }

  if (parsed.protocol !== 'http:'
    || !LOOPBACK_HOSTS.has(parsed.hostname)
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || (parsed.pathname !== '/' && parsed.pathname !== '')) {
    throw new Error('LOCAL_UAT_API_URL_MUST_BE_LOOPBACK_HTTP');
  }

  return parsed.origin;
};
