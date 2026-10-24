import React from 'react';

// Shared page heading: optional ← back link, title, optional one-line hint.
export default function PageHeader({ title, hint = '', backLabel = '', onBack }) {
  return <header className="space-y-1">
    {backLabel && onBack && <button type="button" onClick={onBack} className="min-h-11 text-sm font-bold text-emerald-800 hover:underline">← {backLabel}</button>}
    <h2 className="text-xl font-bold text-[#2C4A3E]">{title}</h2>
    {hint && <p className="text-xs text-gray-500">{hint}</p>}
  </header>;
}
