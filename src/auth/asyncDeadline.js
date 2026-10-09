// A race is required as some SDKs/fetch shims ignore AbortSignal.
export const createDeadline = ({ timeoutMs, error, signal } = {}) => {
  const controller = new AbortController();
  let rejectDeadline;
  const expired = new Promise((_, reject) => { rejectDeadline = reject; });
  // A signal may already be aborted before the first wait is attached.
  expired.catch(() => {});
  const abort = (reason) => {
    if (controller.signal.aborted) return;
    controller.abort(reason);
    rejectDeadline(reason);
  };
  const onAbort = () => abort(signal.reason || new Error('Attempt superseded'));
  const timer = setTimeout(() => abort(error), timeoutMs);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    wait(task) {
      if (controller.signal.aborted) return Promise.reject(controller.signal.reason);
      return Promise.race([Promise.resolve().then(() => {
        if (controller.signal.aborted) throw controller.signal.reason;
        return task();
      }), expired]);
    },
    dispose() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  };
};
