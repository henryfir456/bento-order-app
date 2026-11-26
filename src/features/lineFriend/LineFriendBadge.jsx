import { useState } from 'react';

const DEFAULT_ADD_FRIEND_URL = 'https://line.me/R/ti/p/@518jelfh';
const ADD_FRIEND_URL = String(import.meta.env?.VITE_LINE_OA_ADD_FRIEND_URL || '').trim() || DEFAULT_ADD_FRIEND_URL;

// Small warning icon in the header; shown only when the server confirmed the
// user has not added the LINE official account as a friend.
export default function LineFriendBadge({ status }) {
  const [open, setOpen] = useState(false);
  if (status !== 'NOT_FRIEND') return null;
  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="尚未加入 LINE 官方帳號好友"
        aria-expanded={open}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-amber-300 transition hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-200"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path strokeLinecap="round" d="M12 7v6M12 16.5v.01" />
        </svg>
      </button>
      {open && (
        <div role="dialog" className="absolute right-0 top-10 z-50 w-64 rounded-xl bg-white p-3 text-sm text-slate-800 shadow-lg">
          <p className="font-bold">你還沒加入 LINE 官方帳號</p>
          <p className="mt-1 text-xs text-slate-600">加入好友後，才能收到訂餐提醒與結單通知。</p>
          <a
            href={ADD_FRIEND_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 flex min-h-10 items-center justify-center rounded-lg bg-[#06C755] px-3 py-2 text-sm font-bold text-white"
          >
            加入好友
          </a>
        </div>
      )}
    </span>
  );
}
