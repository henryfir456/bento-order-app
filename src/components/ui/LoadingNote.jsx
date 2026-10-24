import React from 'react';

// Shared loading indicator. Pass the object being loaded, e.g. label="店家資料".
export default function LoadingNote({ label = '', compact = false, className = '' }) {
  const text = label ? `${label}載入中…` : '載入中…';
  return <p role="status" className={`${compact ? 'py-2 text-xs' : 'py-6 text-sm'} text-center text-slate-500 ${className}`.trim()}>{text}</p>;
}
