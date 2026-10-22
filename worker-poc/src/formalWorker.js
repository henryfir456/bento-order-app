import { handleAuthRoute } from './routes/auth.js';
import { handleMeRoute } from './routes/me.js';
import { handleAnnouncementInboxRoute } from './routes/announcementInbox.js';
import { handleOrderRoute } from './routes/orders.js';
import { handleBalanceRoute } from './routes/balance.js';
import { handleVendorRoute } from './routes/vendors.js';
import { handleVendorContextRoute } from './routes/vendorContext.js';
import { handleVendorOperationsRoute } from './routes/vendorOperations.js';
import { handleAdminRoute } from './routes/admin.js';
import { handleCalendarRoute } from './routes/calendar.js';
import { handleRoleRoute } from './routes/roles.js';
import { handleReadOnlyRequest } from './routes/readOnly.js';
import { runAutomaticDailyOpening } from './domain/automaticOpening.js';
import { runCaiTeacherDailyFlavorSync } from './domain/dailyFlavors.js';
import { syncTaiwanGovernmentHolidays } from './domain/taiwanHolidays.js';
import { HttpError, serviceUnavailable, toPublicError } from './http/errors.js';
import { applyCorsPolicy, emptyResponse, jsonResponse } from './http/response.js';
import { asNumber } from './contract.js';

const AUTOMATIC_OPENING_LOG_EVENT = 'automatic_daily_group_opening';
const AUTOMATIC_OPENING_LOG_SOURCE = 'automatic_daily_cron';

export const handleScheduled = async (
  controller,
  env,
  { logger = console, fetchImpl = globalThis.fetch } = {}
) => {
  if (controller?.cron === '0 8 * * *') {
    const result = await runCaiTeacherDailyFlavorSync(env.DB, {
      fetchImpl,
      now: controller?.scheduledTime === undefined
        ? new Date()
        : new Date(controller.scheduledTime)
    });
    const logEntry = {
      event: 'cai_teacher_daily_flavor_sync',
      source: 'daily_flavor_cron',
      ...result
    };
    if (typeof logger?.log === 'function') logger.log(JSON.stringify(logEntry));
    return result;
  }

  if (controller?.cron === '30 0 15 6-12 *') {
    const result = await syncTaiwanGovernmentHolidays(env.DB, {
      fetchImpl,
      now: controller?.scheduledTime === undefined
        ? new Date()
        : new Date(controller.scheduledTime)
    });
    const logEntry = {
      event: 'taiwan_government_holiday_sync',
      source: 'holiday_calendar_cron',
      ...result
    };
    if (typeof logger?.log === 'function') logger.log(JSON.stringify(logEntry));
    return result;
  }

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

const LINE_API_HOST = 'api.line.me';

const hostOf = (input) => {
  try {
    return new URL(typeof input === 'string' ? input : input?.url).host;
  } catch {
    return '';
  }
};

/**
 * Durations only (no identities or payload), so a browser's network panel can
 * show where a request's time goes: the D1 probe approximates one D1 round
 * trip and `line` is the time spent verifying LINE access tokens.
 */
const createServerTiming = (fetchImpl = (...args) => globalThis.fetch(...args)) => {
  const startedAt = performance.now();
  const totals = { probe: null, line: 0, lineCount: 0 };
  const timedFetch = async (input, init) => {
    if (hostOf(input) !== LINE_API_HOST) return fetchImpl(input, init);
    const lineStartedAt = performance.now();
    try {
      return await fetchImpl(input, init);
    } finally {
      totals.line += performance.now() - lineStartedAt;
      totals.lineCount += 1;
    }
  };
  const header = () => {
    const entries = [];
    if (totals.probe !== null) entries.push(`d1-probe;dur=${totals.probe.toFixed(1)}`);
    if (totals.lineCount) entries.push(`line;desc="${totals.lineCount}";dur=${totals.line.toFixed(1)}`);
    entries.push(`total;dur=${(performance.now() - startedAt).toFixed(1)}`);
    return entries.join(', ');
  };
  return { totals, timedFetch, header };
};

export const handleFormalRequest = async (request, env, options = {}) => {
  const requestId = globalThis.crypto.randomUUID();
  const timing = createServerTiming(options.fetchImpl);
  options = { ...options, fetchImpl: timing.timedFetch };
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
      // Probe only D1 availability. Protected-owner configuration is checked
      // lazily by the identity workflows that need it and never gates all APIs.
      const probeStartedAt = performance.now();
      try {
        const ready = await env?.DB?.prepare('SELECT 1 AS ready').first();
        if (Number(ready?.ready) !== 1) throw new Error('D1 probe returned no row');
      } catch {
        throw serviceUnavailable('DATABASE_UNAVAILABLE');
      } finally {
        timing.totals.probe = performance.now() - probeStartedAt;
      }
      const authResponse = await handleAuthRoute(request, env, options);
      if (authResponse) response = authResponse;
      if (!response) {
        const meResponse = await handleMeRoute(request, env, options);
        if (meResponse) response = meResponse;
      }
      if (!response) {
        const announcementInboxResponse = await handleAnnouncementInboxRoute(request, env, options);
        if (announcementInboxResponse) response = announcementInboxResponse;
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
        const vendorContextResponse = await handleVendorContextRoute(request, env, options);
        if (vendorContextResponse) response = vendorContextResponse;
      }
      if (!response) {
        const vendorOperationsResponse = await handleVendorOperationsRoute(request, env, options);
        if (vendorOperationsResponse) response = vendorOperationsResponse;
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
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set('X-Request-Id', requestId);
  responseHeaders.set('Server-Timing', timing.header());
  response = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders
  });
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
