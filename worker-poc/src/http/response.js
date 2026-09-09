export const PRODUCTION_FRONTEND_ORIGIN = 'https://stirring-pony-3571ac.netlify.app';

export const CORS_HEADERS = Object.freeze({
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key',
  'Access-Control-Allow-Methods': 'GET, OPTIONS, PATCH, POST, PUT',
  'Access-Control-Allow-Origin': PRODUCTION_FRONTEND_ORIGIN
});

export const applyCorsPolicy = (response, request) => {
  const headers = new Headers(response.headers);
  const origin = request?.headers.get('Origin');
  if (origin !== PRODUCTION_FRONTEND_ORIGIN) {
    headers.delete('Access-Control-Allow-Origin');
    headers.delete('Access-Control-Allow-Headers');
    headers.delete('Access-Control-Allow-Methods');
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
