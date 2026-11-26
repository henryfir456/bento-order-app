import { useCallback, useEffect, useState } from 'react';

// Resolves to 'NOT_FRIEND' only when the server is sure; every failure stays
// 'UNKNOWN' so the warning icon never appears by mistake. Re-checks when the
// user returns to the page (e.g. after adding the official account).
export function useLineFriendship({ api, enabled, userKey }) {
  const [status, setStatus] = useState('UNKNOWN');

  const check = useCallback(async () => {
    try {
      const result = await api.getLineFriendship();
      return result?.status === 'NOT_FRIEND' ? 'NOT_FRIEND' : (result?.status === 'FRIEND' ? 'FRIEND' : 'UNKNOWN');
    } catch {
      return 'UNKNOWN';
    }
  }, [api]);

  useEffect(() => {
    setStatus('UNKNOWN');
    if (!enabled) return undefined;
    let cancelled = false;
    const run = async () => {
      const next = await check();
      if (!cancelled) setStatus(next);
    };
    void run();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, userKey, check]);

  return status;
}
