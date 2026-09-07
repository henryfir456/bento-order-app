export const CORS_HEADERS = Object.freeze({
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key',
  'Access-Control-Allow-Methods': 'GET, OPTIONS, PATCH, POST',
  'Access-Control-Allow-Origin': '*'
});

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
