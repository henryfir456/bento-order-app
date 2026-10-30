import { redactAuthSecrets } from '../auth/authRuntime.js';

const MAX_REPORTS_PER_PAGE_LOAD = 5;

/**
 * Reports login/bootstrap failures to the Worker's diagnostic log so they can
 * be read without a screenshot. Fire-and-forget: it never throws, never blocks
 * the login UI, sends each stage/code once, and sends no tokens or identities.
 */
export const createAuthErrorReporter = ({ apiClient, authClient, appVersion }) => {
  const sent = new Set();
  return (stage, error) => {
    try {
      if (apiClient?.transport !== 'worker' || authClient?.isMock
        || typeof apiClient.reportClientError !== 'function') return;
      const errorCode = String(error?.code || stage);
      const key = `${stage}|${errorCode}`;
      if (sent.has(key) || sent.size >= MAX_REPORTS_PER_PAGE_LOAD) return;
      sent.add(key);
      let inLine = null;
      try { inLine = Boolean(authClient.isInClient()); } catch { /* unknown */ }
      const detail = redactAuthSecrets(error instanceof Error ? error.message : error);
      Promise.resolve(apiClient.reportClientError({
        stage,
        errorCode,
        httpStatus: Number.isInteger(error?.status) ? error.status : null,
        errorClass: typeof error?.kind === 'string' ? error.kind : null,
        inLine,
        appVersion,
        detail: detail === 'Unknown error' ? null : detail.slice(0, 160)
      })).catch(() => {});
    } catch {
      // Reporting must never affect the login flow.
    }
  };
};
