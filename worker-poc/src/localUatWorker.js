import { handleFormalRequest } from './formalWorker.js';
import { applyCorsPolicy, emptyResponse, jsonResponse } from './http/response.js';

const TOKEN_ISSUER = 'bento-local-uat';
const TOKEN_AUDIENCE = 'bento-local-worker';
const TOKEN_LIFETIME_SECONDS = 8 * 60 * 60;
const PROFILE_URL = 'https://api.line.me/v2/profile';
const VENDOR_ONE_CODE = `V${String(1).padStart(5, '0')}`;
const VENDOR_TWO_CODE = `V${String(2).padStart(5, '0')}`;

const identities = Object.freeze({
  admin: Object.freeze({
    passwordEnv: 'LOCAL_UAT_PASSWORD_ADMIN',
    lineUserId: 'local-uat-line-admin',
    displayName: '合成 Admin'
  }),
  user: Object.freeze({
    passwordEnv: 'LOCAL_UAT_PASSWORD_USER',
    lineUserId: 'local-uat-line-user',
    displayName: '合成 User'
  }),
  'vendor-one': Object.freeze({
    passwordEnv: 'LOCAL_UAT_PASSWORD_VENDOR_ONE',
    lineUserId: 'local-uat-line-vendor-one',
    displayName: `合成 Vendor ${VENDOR_ONE_CODE}`
  }),
  'vendor-two': Object.freeze({
    passwordEnv: 'LOCAL_UAT_PASSWORD_VENDOR_TWO',
    lineUserId: 'local-uat-line-vendor-two',
    displayName: `合成 Vendor ${VENDOR_TWO_CODE}`
  })
});

const encoder = new TextEncoder();

const base64UrlEncode = (value) => {
  const bytes = typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};

const base64UrlDecode = (value) => {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const signingKey = async (env, usages) => {
  const secret = String(env?.LOCAL_UAT_TOKEN_SECRET || '');
  if (secret.length < 32) return null;
  return globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages
  );
};

const jsonBase64Url = (value) => base64UrlEncode(JSON.stringify(value));

const signToken = async (env, role, now = Date.now()) => {
  const header = jsonBase64Url({ alg: 'HS256', typ: 'JWT' });
  const payload = jsonBase64Url({
    iss: TOKEN_ISSUER,
    aud: TOKEN_AUDIENCE,
    sub: role,
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + TOKEN_LIFETIME_SECONDS
  });
  const unsigned = `${header}.${payload}`;
  const key = await signingKey(env, ['sign']);
  if (!key) throw new Error('LOCAL_UAT_CONFIGURATION_REQUIRED');
  const signature = await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(unsigned));
  return `${unsigned}.${base64UrlEncode(signature)}`;
};

const verifiedRoleFromToken = async (env, token, now = Date.now()) => {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedHeader)));
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload)));
    if (header?.alg !== 'HS256' || header?.typ !== 'JWT'
      || payload?.iss !== TOKEN_ISSUER || payload?.aud !== TOKEN_AUDIENCE
      || !Object.hasOwn(identities, payload?.sub)
      || !Number.isInteger(payload?.iat) || !Number.isInteger(payload?.exp)) return null;
    const nowSeconds = Math.floor(now / 1000);
    if (payload.iat > nowSeconds + 60 || payload.exp <= nowSeconds
      || payload.exp - payload.iat > TOKEN_LIFETIME_SECONDS) return null;
    const key = await signingKey(env, ['verify']);
    if (!key) return null;
    const valid = await globalThis.crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlDecode(encodedSignature),
      encoder.encode(`${encodedHeader}.${encodedPayload}`)
    );
    return valid ? payload.sub : null;
  } catch {
    return null;
  }
};

const tokenFromRequest = (request) => {
  const match = String(request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
};

const tracedLocalResponse = (response, request, env) => {
  const headers = new Headers(response.headers);
  headers.set('X-Request-Id', globalThis.crypto.randomUUID());
  headers.set('Cache-Control', 'no-store');
  return applyCorsPolicy(new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  }), request, env);
};

const localUatUnavailable = (request, env, status = 404) => tracedLocalResponse(
  jsonResponse({ error: status === 404 ? 'NOT_FOUND' : 'LOCAL_UAT_CONFIGURATION_REQUIRED' }, status),
  request,
  env
);

const login = async (request, env) => {
  if (request.method === 'OPTIONS') {
    return tracedLocalResponse(emptyResponse(), request, env);
  }
  if (request.method !== 'POST') {
    return tracedLocalResponse(jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405), request, env);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return tracedLocalResponse(jsonResponse({ error: 'LOCAL_UAT_LOGIN_INVALID' }, 400), request, env);
  }
  const role = String(body?.role || '').trim().toLowerCase();
  const identity = identities[role];
  const expectedPassword = String(identity ? env?.[identity.passwordEnv] || '' : '');
  const suppliedPassword = typeof body?.password === 'string' ? body.password : '';
  if (!identity || !expectedPassword || suppliedPassword !== expectedPassword) {
    return tracedLocalResponse(jsonResponse({ error: 'LOCAL_UAT_LOGIN_REJECTED' }, 401), request, env);
  }
  try {
    const accessToken = await signToken(env, role);
    return tracedLocalResponse(jsonResponse({
      success: true,
      role,
      accessToken,
      expiresInSeconds: TOKEN_LIFETIME_SECONDS
    }), request, env);
  } catch {
    return localUatUnavailable(request, env, 503);
  }
};

export const createLocalUatProfileFetch = (env) => async (url, init = {}) => {
  if (String(url) !== PROFILE_URL) return new Response('{}', { status: 503 });
  const headers = new Headers(init.headers);
  const request = new Request(PROFILE_URL, { headers });
  const role = await verifiedRoleFromToken(env, tokenFromRequest(request));
  const identity = role ? identities[role] : null;
  return identity
    ? Response.json({ userId: identity.lineUserId, displayName: identity.displayName })
    : Response.json({}, { status: 401 });
};

export const handleLocalUatRequest = async (request, env = {}) => {
  const url = new URL(request.url);
  const isSession = url.pathname === '/__local-uat/session';
  if (isSession && env.LOCAL_UAT_MODE !== '1') return localUatUnavailable(request, env);
  if (isSession) return login(request, env);
  if (env.LOCAL_UAT_MODE !== '1') return handleFormalRequest(request, env);
  return handleFormalRequest(request, env, {
    fetchImpl: createLocalUatProfileFetch(env)
  });
};

export default {
  fetch(request, env) {
    return handleLocalUatRequest(request, env);
  }
};
