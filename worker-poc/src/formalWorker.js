import { handleAuthRoute } from './routes/auth.js';
import { handleMeRoute } from './routes/me.js';
import { handleOrderRoute } from './routes/orders.js';
import { handleBalanceRoute } from './routes/balance.js';
import { handleVendorRoute } from './routes/vendors.js';
import { handleAdminRoute } from './routes/admin.js';
import { handleCalendarRoute } from './routes/calendar.js';
import { handleRoleRoute } from './routes/roles.js';
import { handleReadOnlyRequest } from './routes/readOnly.js';
import { runAutomaticDailyOpening } from './domain/automaticOpening.js';
import { HttpError, toPublicError } from './http/errors.js';
import { applyCorsPolicy, emptyResponse, jsonResponse } from './http/response.js';
import { asNumber } from './contract.js';

const AUTOMATIC_OPENING_LOG_EVENT = 'automatic_daily_group_opening';
const AUTOMATIC_OPENING_LOG_SOURCE = 'automatic_daily_cron';

export const handleScheduled = async (
  controller,
  env,
  { logger = console } = {}
) => {
  const result = await runAutomaticDailyOpening(env.DB, controller?.scheduledTime);
  const logEntry = {
    event: AUTOMATIC_OPENING_LOG_EVENT,
    source: AUTOMATIC_OPENING_LOG_SOURCE,
    status: result.status,
    businessDate: result.businessDate,
    targetDate: result.targetDate,
    ...(result.vendor ? { vendor: result.vendor } : {})
  };
  if (typeof logger?.log === 'function') logger.log(JSON.stringify(logEntry));
  return result;
};

export const handleFormalRequest = async (request, env, options = {}) => {
  let response;
  try {
    if (request.method === 'OPTIONS') {
      response = emptyResponse();
    } else if (request.method === 'GET' && new URL(request.url).pathname === '/api/health') {
      try {
        const row = await env?.DB?.prepare('SELECT COUNT(*) AS users FROM users').first();
        response = jsonResponse({
          ok: true,
          database: true,
          users: asNumber(row?.users)
        });
      } catch {
        response = jsonResponse({
          ok: false,
          database: false,
          users: 0,
          error: 'DATABASE_UNAVAILABLE'
        }, 503);
      }
    } else {
      const authResponse = await handleAuthRoute(request, env, options);
      if (authResponse) response = authResponse;
      if (!response) {
        const meResponse = await handleMeRoute(request, env, options);
        if (meResponse) response = meResponse;
      }
      if (!response) {
        const orderResponse = await handleOrderRoute(request, env, options);
        if (orderResponse) response = orderResponse;
      }
      if (!response) {
        const calendarResponse = await handleCalendarRoute(request, env, options);
        if (calendarResponse) response = calendarResponse;
      }
      if (!response) {
        const roleResponse = await handleRoleRoute(request, env, options);
        if (roleResponse) response = roleResponse;
      }
      if (!response) {
        const adminResponse = await handleAdminRoute(request, env, options);
        if (adminResponse) response = adminResponse;
      }
      if (!response) {
        const balanceResponse = await handleBalanceRoute(request, env, options);
        if (balanceResponse) response = balanceResponse;
      }
      if (!response) {
        const vendorResponse = await handleVendorRoute(request, env, options);
        if (vendorResponse) response = vendorResponse;
      }
      if (!response) {
        const readResponse = await handleReadOnlyRequest(request, env, options);
        if (readResponse) response = readResponse;
      }
      if (!response) response = jsonResponse({ error: 'NOT_FOUND' }, 404);
    }
  } catch (error) {
    const publicError = toPublicError(error);
    if (!(error instanceof HttpError) && options.onInternalError) {
      try {
        options.onInternalError(error);
      } catch {
        // Logging must not bypass the global response decorator.
      }
    }
    response = jsonResponse(publicError.body, publicError.status);
  }
  return applyCorsPolicy(response, request, env);
};

export default {
  fetch(request, env) {
    return handleFormalRequest(request, env);
  },
  scheduled(controller, env) {
    return handleScheduled(controller, env);
  }
};
