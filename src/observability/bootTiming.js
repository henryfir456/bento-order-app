const BOOT_ID_PATTERN = /^BOOT-\d{8,17}-[a-z0-9]{4,12}$/i;

const BOOT_MILESTONES = new Set([
  'BOOT_START',
  'LIFF_INIT_START',
  'LIFF_INIT_END',
  'BOOTSTRAP_REQUEST_START',
  'BOOTSTRAP_REQUEST_END',
  'BOOTSTRAP_STATE_READY',
  'BOOT_READY'
]);

const BOOT_METRICS = new Set([
  'LIFF_INIT_MS',
  'BOOTSTRAP_NETWORK_MS',
  'STATE_APPLY_MS',
  'BOOT_TOTAL_MS'
]);

const BACKEND_METRICS = new Set([
  'BOOTSTRAP_TOTAL_MS',
  'LINE_PROFILE_MS',
  'USER_LOOKUP_MS',
  'SETTINGS_MS',
  'ORDERS_MS',
  'CALENDAR_MS'
]);

const DEFERRED_BACKEND_METRICS = new Set([
  'DEFERRED_UI_TOTAL_MS',
  'LIKES_MS',
  'ANNOUNCEMENTS_MS'
]);

const BOOT_STATUSES = new Set(['success', 'error', 'fallback']);

const roundDuration = (durationMs) => {
  const numericDuration = Number(durationMs);
  return Number.isFinite(numericDuration)
    ? Math.max(0, Number(numericDuration.toFixed(1)))
    : 0;
};

export const createBootId = () => (
  `BOOT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
);

export const getPerformanceNow = () => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);

export const createBootTimingLogger = (bootId, logger = console) => {
  const safeBootId = BOOT_ID_PATTERN.test(String(bootId || ''))
    ? String(bootId)
    : 'BOOT-INVALID-ID';

  const emit = (source, fields) => {
    try {
      if (logger && typeof logger.info === 'function') {
        logger.info(`[PERF][BOOT][${safeBootId}] ${source} ${JSON.stringify(fields)}`);
      }
    } catch {
      // Performance instrumentation must never interrupt startup.
    }
  };

  const emitSummary = (source, summary, responseBootId, allowedMetrics) => {
    if (responseBootId !== safeBootId) return;
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return;
    if (!BOOT_STATUSES.has(summary.status)) return;
    if (!summary.metrics || typeof summary.metrics !== 'object' || Array.isArray(summary.metrics)) return;

    allowedMetrics.forEach((metric) => {
      if (!Object.prototype.hasOwnProperty.call(summary.metrics, metric)) return;
      const durationMs = Number(summary.metrics[metric]);
      if (!Number.isFinite(durationMs)) return;

      const fields = {
        status: summary.status,
        metric,
        durationMs: roundDuration(durationMs)
      };
      if (typeof summary.fallback === 'boolean') fields.fallback = summary.fallback;
      emit(source, fields);
    });
  };

  return {
    milestone(name) {
      if (BOOT_MILESTONES.has(name)) emit('frontend', { milestone: name });
    },

    metric(name, durationMs, status, fallback) {
      if (!BOOT_METRICS.has(name)) return;

      const fields = {};
      if (BOOT_STATUSES.has(status)) fields.status = status;
      if (typeof fallback === 'boolean') fields.fallback = fallback;
      fields.metric = name;
      fields.durationMs = roundDuration(durationMs);
      emit('frontend', fields);
    },

    backend(summary, responseBootId) {
      emitSummary('backend', summary, responseBootId, BACKEND_METRICS);
    },

    deferredBackend(summary, responseBootId) {
      emitSummary('deferred-backend', summary, responseBootId, DEFERRED_BACKEND_METRICS);
    }
  };
};
