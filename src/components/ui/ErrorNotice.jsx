import React from 'react';

// Shared inline error: one sentence plus an optional 重試 button.
// Error codes and trace IDs belong in `detail`, which stays collapsed by default.
export default function ErrorNotice({ message, detail = '', onRetry, className = '' }) {
  return <div role="alert" className={`rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 ${className}`.trim()}>
    <p>{message}</p>
    {detail && <details className="mt-1 text-xs text-rose-700"><summary className="cursor-pointer">詳細資訊</summary><p className="mt-1 break-words">{detail}</p></details>}
    {onRetry && <button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded-xl bg-rose-700 px-4 text-xs font-bold text-white">重試</button>}
  </div>;
}
