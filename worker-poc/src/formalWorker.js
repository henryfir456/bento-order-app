import { createReadMeter, meterDatabase } from './db/readMeter.js';
import { handleAuthRoute } from './routes/auth.js';
import { handleClientErrorRoute } from './routes/clientErrors.js';
import { handleMeRoute } from './routes/me.js';
import { handleAnnouncementInboxRoute } from './routes/announcementInbox.js';
import { notifyAdminsLateGroupClosed, notifyVendorsOrderClosed } from './domain/userNotifications.js';
import { sendOrderReminders } from './domain/orderReminders.js';
import { handleUserNotificationRoute } from './routes/userNotifications.js';
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
import { bearerToken } from './auth/identity.js';
import { isGuestToken } from './auth/guestSession.js';
import { PROFILE_URL as LINE_PROFILE_URL } from './auth/lineProfile.js';
import { VERIFY_URL as LINE_VERIFY_URL } from './auth/lineChannel.js';
import { purgeOldAuthErrors, recordAuthError } from './auth/authErrorLog.js';

const AUTOMATIC_OPENING_LOG_EVENT = 'automatic_daily_group_opening';
const AUTOMATIC_OPENING_LOG_SOURCE = 'automatic_daily_cron';

// 10:00 / 18:00 Taipei close notifications share one trigger, and so do the
// 09:50 / 17:50 reminders, to stay within the five-cron-trigger plan limit.
const CLOSE_CRON = '0 2,10 * * *';
const REMINDER_CRON = '50 1,9 * * *';
const closeCronHour = (controller) => new Date(controller.scheduledTime).getUTCHours();

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
    try {
      await purgeOldAuthErrors(env.DB, controller?.scheduledTime === undefined
        ? new Date()
        : new Date(controller.scheduledTime));
    } catch (error) {
      if (typeof logger?.log === 'function') logger.log(JSON.stringify({ event: 'auth_error_purge_failed' }));
    }
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

  if (controller?.cron === REMINDER_CRON) {
    const mode = new Date(controller.scheduledTime).getUTCHours() === 1 ? 'A' : 'B';
    const result = await sendOrderReminders(env.DB, env, controller.scheduledTime, mode, { fetchImpl });
    const logEntry = { event: 'order_reminder', source: 'order_reminder_cron', ...result };
    if (typeof logger?.log === 'function') logger.log(JSON.stringify(logEntry));
    return result;
  }

  if (controller?.cron === CLOSE_CRON && closeCronHour(controller) === 2) {
    const result = await notifyAdminsLateGroupClosed(env.DB, env, controller?.scheduledTime, { fetchImpl });
    const logEntry = { event: 'admin_order_closed_notification', source: 'order_close_cron', ...result };
    if (typeof logger?.log === 'function') logger.log(JSON.stringify(logEntry));
    return result;
  }

  if (controller?.cron === CLOSE_CRON && closeCronHour(controller) === 10) {
    const result = await notifyVendorsOrderClosed(env.DB, env, controller?.scheduledTime, { fetchImpl });
    const logEntry = { event: 'vendor_order_closed_notification', source: 'order_close_cron', ...result };
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

const D1_ROWS_LOG_THRESHOLD = 5000;
const LINE_API_HOST = 'api.line.me';

const urlOf = (input) => (typeof input === 'string' ? input : String(input?.url || ''));

const hostOf = (input) => {
  try {
    return new URL(urlOf(input)).host;
  } catch {
    return '';
  }
};

const authorizationOf = (init) => {
  const headers = init?.headers;
  if (!headers) return '';
  return typeof headers.get === 'function' ? headers.get('Authorization') || '' : headers.Authorization || '';
};

/**
 * Durations only (no identities or payload), so a browser's network panel can
 * show where a request's time goes: the D1 probe approximates one D1 round
 * trip and `line` is the time spent verifying LINE access tokens.
 */
const createServerTiming = (fetchImpl = (...args) => globalThis.fetch(...args)) => {
  const startedAt = performance.now();
  const totals = {
    probe: null, line: 0, lineCount: 0,
    profileStatus: null, verifyStatus: null, profileMs: null
  };
  let prefetchedProfile = null;
  const timedLineFetch = async (input, init) => {
    const lineStartedAt = performance.now();
    const url = urlOf(input);
    const kind = url === LINE_PROFILE_URL ? 'profileStatus'
      : url.startsWith(LINE_VERIFY_URL) ? 'verifyStatus' : null;
    try {
      const response = await fetchImpl(input, init);
      if (kind) totals[kind] = Number(response?.status) || 0;
      return response;
    } catch (error) {
      // Status 0 marks a network failure or timeout before any HTTP answer.
      if (kind) totals[kind] = 0;
      throw error;
    } finally {
      const elapsed = performance.now() - lineStartedAt;
      totals.line += elapsed;
      totals.lineCount += 1;
      if (kind === 'profileStatus') totals.profileMs = elapsed;
    }
  };
  const timedFetch = async (input, init) => {
    if (hostOf(input) !== LINE_API_HOST) return fetchImpl(input, init);
    if (prefetchedProfile
      && urlOf(input) === LINE_PROFILE_URL
      && authorizationOf(init) === prefetchedProfile.authorization) {
      // Hand the early profile response to the first identity check that
      // asks for this exact token; any later call fetches normally.
      const { response } = prefetchedProfile;
      prefetchedProfile = null;
      return response;
    }
    return timedLineFetch(input, init);
  };
  /**
   * Start LINE token verification while the D1 probe runs. The probe still
   * completes (or fails with 503) before any route runs; only the network
   * wait for LINE overlaps with it.
   */
  timedFetch.prefetchLineProfile = (token) => {
    const authorization = 'Bearer ' + token;
    const response = timedLineFetch(LINE_PROFILE_URL, { headers: { Authorization: authorization } });
    // An unused or failed prefetch must not surface as an unhandled rejection;
    // the identity check that consumes it still sees the rejection.
    response.catch(() => {});
    prefetchedProfile = { authorization, response };
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

const isHttpOk = (status) => status === null || (status >= 200 && status < 300);

const lineErrorClass = (code, totals) => {
  if (code === 'LINE_PROFILE_TIMEOUT') return 'LINE_TIMEOUT';
  if (totals.profileStatus === 0) return 'LINE_NETWORK';
  if (totals.profileStatus > 0 && !isHttpOk(totals.profileStatus)) return 'LINE_PROFILE_HTTP';
  if (totals.verifyStatus === 0) return 'LINE_VERIFY_NETWORK';
  if (totals.verifyStatus > 0 && !isHttpOk(totals.verifyStatus)) return 'LINE_VERIFY_HTTP';
  // Both LINE calls answered 200, so the token itself was refused (for example
  // issued to another channel, or the profile had no user ID).
  if (code === 'TOKEN_INVALID') return 'TOKEN_CONTENT_REJECTED';
  return null;
};

// Login-related failures worth keeping for diagnosis. Ordinary business
// errors (validation, permission checks on a signed-in user) are not logged.
const authFailureEntry = (request, error, timing, startedAt, requestId) => {
  if (error.code === 'DATABASE_UNAVAILABLE') return null;
  const { totals } = timing;
  const path = new URL(request.url).pathname;
  const hasToken = Boolean(bearerToken(request));
  const lineFailed = !isHttpOk(totals.profileStatus) || !isHttpOk(totals.verifyStatus);
  const authPath = path.startsWith('/api/auth/');
  const unauthorized = error.status === 401 && hasToken;
  if (!authPath && !unauthorized && !lineFailed && error.code !== 'LINE_PROFILE_TIMEOUT') return null;
  return {
    source: 'backend',
    stage: (request.method + ' ' + path.split('/').slice(0, 4).join('/')).slice(0, 48),
    errorCode: error.code,
    httpStatus: error.status,
    errorClass: lineErrorClass(error.code, totals),
    lineProfileStatus: totals.profileStatus,
    lineVerifyStatus: totals.verifyStatus,
    durationMs: Math.round(performance.now() - startedAt),
    requestId
  };
};

export const handleFormalRequest = async (request, env, options = {}) => {
  const requestId = globalThis.crypto.randomUUID();
  const timing = createServerTiming(options.fetchImpl);
  options = { ...options, fetchImpl: timing.timedFetch };
  const startedAt = performance.now();
  const meter = createReadMeter();
  if (env?.DB) env = { ...env, DB: meterDatabase(env.DB, meter) };
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
      const token = bearerToken(request);
      if (token && !isGuestToken(token)) timing.timedFetch.prefetchLineProfile(token);
      const probeStartedAt = performance.now();
      try {
        const ready = await env?.DB?.prepare('SELECT 1 AS ready').first();
        if (Number(ready?.ready) !== 1) throw new Error('D1 probe returned no row');
      } catch {
        throw serviceUnavailable('DATABASE_UNAVAILABLE');
      } finally {
        timing.totals.probe = performance.now() - probeStartedAt;
      }
      const clientErrorResponse = await handleClientErrorRoute(request, env, options);
      if (clientErrorResponse) response = clientErrorResponse;
      const authResponse = response ? null : await handleAuthRoute(request, env, options);
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
        const notificationResponse = await handleUserNotificationRoute(request, env, options);
        if (notificationResponse) response = notificationResponse;
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
    const failure = error instanceof HttpError && env?.DB
      ? authFailureEntry(request, error, timing, startedAt, requestId)
      : null;
    if (failure) {
      const write = recordAuthError(env.DB, request, failure, options.now ?? new Date());
      if (typeof options.waitUntil === 'function') options.waitUntil(write);
      else await write;
    }
  }
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set('X-Request-Id', requestId);
  responseHeaders.set('Server-Timing', `${timing.header()}, d1-rows;desc="${meter.rows} rows/${meter.queries} queries"`);
  const logger = options.logger ?? console;
  if (meter.rows >= D1_ROWS_LOG_THRESHOLD && typeof logger?.log === 'function') {
    logger.log(JSON.stringify({
      event: 'd1_rows_read',
      method: request.method,
      path: new URL(request.url).pathname,
      rows: meter.rows,
      queries: meter.queries
    }));
  }
  response = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders
  });
  return applyCorsPolicy(response, request, env);
};

export default {
  fetch(request, env, ctx) {
    return handleFormalRequest(request, env, {
      waitUntil: (promise) => ctx?.waitUntil?.(promise)
    });
  },
  scheduled(controller, env) {
    return handleScheduled(controller, env);
  }
};
