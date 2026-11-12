import React from 'react';

// Line-style megaphone (UI guidelines: line SVG icons, no emoji in buttons).
export default function MegaphoneIcon({ size = 16, className = '' }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 10v4a1 1 0 0 0 1 1h2l9 4V5L6 9H4a1 1 0 0 0-1 1Z" />
      <path d="M18.5 9.5a4 4 0 0 1 0 5" />
      <path d="M7 15l1 5h2.5l-1-4.4" />
    </svg>
  );
}
