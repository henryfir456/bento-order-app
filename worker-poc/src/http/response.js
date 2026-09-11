export const PRODUCTION_FRONTEND_ORIGIN = 'https://stirring-pony-3571ac.netlify.app';
export const LOCAL_DEVELOPMENT_ORIGIN = 'http://localhost:5173';

export const CORS_HEADERS = Object.freeze({
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, X-Employee-Guest-Session',
  'Access-Control-Allow-Methods': 'GET, OPTIONS, PATCH, POST, PUT, DELETE',
  'Access-Control-Allow-Origin': PRODUCTION_FRONTEND_ORIGIN
});

const isLocalCorsMode = (env) => (
  String(env?.CORS_MODE || '').trim().toLowerCase() === 'local'
);

const isRemoteTestCorsMode = (env) => (
  String(env?.CORS_MODE || '').trim().toLowerCase() === 'remote-test'
);

const isExplicitDevOrTestCorsMode = (env) => (
  isLocalCorsMode(env) || isRemoteTestCorsMode(env)
);

const PINGGY_REMOTE_TEST_HOST_PATTERN = /^(?!run\.)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.run)?\.pinggy-free\.link$/i;

const normalizeExactOrigin = (value) => {
  const candidate = String(value || '').trim();
  if (!candidate || candidate.includes('*') || candidate.includes('?')) return null;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== candidate) {
    return null;
  }
  return candidate;
};

const resolveAllowedOrigins = (env = {}) => {
  const allowedOrigins = new Set([PRODUCTION_FRONTEND_ORIGIN]);
  if (!isExplicitDevOrTestCorsMode(env)) return allowedOrigins;

  allowedOrigins.add(LOCAL_DEVELOPMENT_ORIGIN);

  String(env.DEV_ALLOWED_ORIGINS || '')
    .split(',')
    .map(normalizeExactOrigin)
    .filter(Boolean)
    .forEach((origin) => allowedOrigins.add(origin));

  return allowedOrigins;
};

const isDynamicPinggyOrigin = (origin) => {
  if (!origin) return false;

  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  return parsed.protocol === 'https:'
    && parsed.origin === origin
    && PINGGY_REMOTE_TEST_HOST_PATTERN.test(parsed.hostname);
};

const isOriginAllowed = (origin, env) => (
  resolveAllowedOrigins(env).has(origin)
  || (isRemoteTestCorsMode(env) && isDynamicPinggyOrigin(origin))
);

export const applyCorsPolicy = (response, request, env = {}) => {
  const headers = new Headers(response.headers);
  const origin = request?.headers.get('Origin');
  if (!isOriginAllowed(origin, env)) {
    headers.delete('Access-Control-Allow-Origin');
    headers.delete('Access-Control-Allow-Headers');
    headers.delete('Access-Control-Allow-Methods');
  } else {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  headers.set('Vary', 'Origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};

export const jsonResponse = (body, status = 200, headers = {}) => new Response(
  JSON.stringify(body),
  {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      ...headers
    }
  }
);

export const emptyResponse = (status = 204) => new Response(null, {
  status,
  headers: CORS_HEADERS
});
