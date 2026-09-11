export const GUEST_SESSION_STORAGE_KEY = 'bento.worker.employee-guest-session.v1';
export const BIND_INTENT_STORAGE_KEY = 'bento.worker.line-bind-intent.v1';

const safeStorage = (storage) => (
  storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function'
    ? storage
    : null
);

const readSession = (storage, now) => {
  if (!storage) return null;
  let parsed;
  try {
    parsed = JSON.parse(storage.getItem(GUEST_SESSION_STORAGE_KEY) || 'null');
  } catch {
    storage.removeItem?.(GUEST_SESSION_STORAGE_KEY);
    return null;
  }

  const token = typeof parsed?.token === 'string' ? parsed.token.trim() : '';
  const expiresAt = typeof parsed?.expiresAt === 'string' ? parsed.expiresAt.trim() : '';
  const expiresMs = Date.parse(expiresAt);
  if (!token || !expiresAt || !Number.isFinite(expiresMs) || expiresMs <= now) {
    storage.removeItem?.(GUEST_SESSION_STORAGE_KEY);
    return null;
  }
  return { token, expiresAt };
};

export const createAuthSessionStore = (storage = globalThis.sessionStorage) => {
  const target = safeStorage(storage);
  const listeners = new Set();
  const notify = (event) => listeners.forEach((listener) => listener(event));

  return Object.freeze({
    getGuestSession({ now = Date.now() } = {}) {
      const session = readSession(target, now instanceof Date ? now.getTime() : Number(now));
      if (!session && target?.getItem(GUEST_SESSION_STORAGE_KEY)) {
        notify({ type: 'guest-session-invalid', reason: 'expired-or-malformed' });
      }
      return session;
    },

    setGuestSession({ token, expiresAt } = {}) {
      const normalizedToken = typeof token === 'string' ? token.trim() : '';
      const normalizedExpiry = typeof expiresAt === 'string' ? expiresAt.trim() : '';
      if (!normalizedToken || !normalizedExpiry || !Number.isFinite(Date.parse(normalizedExpiry))) {
        throw new Error('A valid opaque guest token and expiry are required.');
      }
      if (!target) return { token: normalizedToken, expiresAt: normalizedExpiry };
      // Deliberately persist only the opaque credential and expiry. Roles,
      // capabilities, balances, and employee profile data stay server-owned.
      target.setItem(GUEST_SESSION_STORAGE_KEY, JSON.stringify({
        token: normalizedToken,
        expiresAt: normalizedExpiry
      }));
      const session = { token: normalizedToken, expiresAt: normalizedExpiry };
      notify({ type: 'guest-session-set', session });
      return session;
    },

    clearGuestSession({ reason = 'cleared', notify: shouldNotify = true } = {}) {
      target?.removeItem?.(GUEST_SESSION_STORAGE_KEY);
      if (shouldNotify) notify({ type: 'guest-session-cleared', reason });
    },

    setBindIntent({ displayName = '', pickupFloor = '' } = {}) {
      target?.setItem?.(BIND_INTENT_STORAGE_KEY, JSON.stringify({
        displayName: typeof displayName === 'string' ? displayName.trim() : '',
        pickupFloor: typeof pickupFloor === 'string' ? pickupFloor.trim() : ''
      }));
      notify({ type: 'bind-intent-set' });
    },

    hasBindIntent() {
      return Boolean(target?.getItem?.(BIND_INTENT_STORAGE_KEY));
    },

    getBindIntent() {
      const raw = target?.getItem?.(BIND_INTENT_STORAGE_KEY) || '';
      if (!raw || raw === '1') return {};
      try {
        const parsed = JSON.parse(raw);
        return {
          displayName: typeof parsed?.displayName === 'string' ? parsed.displayName : '',
          pickupFloor: typeof parsed?.pickupFloor === 'string' ? parsed.pickupFloor : ''
        };
      } catch {
        return {};
      }
    },

    clearBindIntent() {
      target?.removeItem?.(BIND_INTENT_STORAGE_KEY);
      notify({ type: 'bind-intent-cleared' });
    },

    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  });
};
