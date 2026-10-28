import React, { useCallback, useEffect, useState } from 'react';

// Opt-in LINE reminders 10 minutes before each group closes; one switch per group type.
const REMINDER_OPTIONS = [
  { mode: 'A', label: '蔡老師', hint: '當天 10:00 截止，09:50 提醒' },
  { mode: 'B', label: '其他廠商（如禾拾）', hint: '前一天 18:00 截止，17:50 提醒' }
];

const ADMIN_CLOSE_OPTION = { mode: 'adminClose', label: '蔡老師結單通知', hint: '每天 10:00 結單後，用 LINE 通知訂單數與份數（管理者）' };
const ADD_FRIEND_URL = String(import.meta.env?.VITE_LINE_OA_ADD_FRIEND_URL || '').trim();

export default function OrderReminderSettings({ api, defaultOpen = false }) {
  const [settings, setSettings] = useState(null);
  const [hasLineBinding, setHasLineBinding] = useState(true);
  const [canManageAdminClose, setCanManageAdminClose] = useState(false);
  const [busyMode, setBusyMode] = useState('');
  const [error, setError] = useState('');

  const apply = (payload) => {
    setSettings({
      A: Boolean(payload?.settings?.A),
      B: Boolean(payload?.settings?.B),
      adminClose: payload?.settings?.adminClose !== false
    });
    setCanManageAdminClose(Boolean(payload?.canManageAdminClose));
    setHasLineBinding(payload?.hasLineBinding !== false);
  };

  const load = useCallback(async () => {
    try {
      const response = await api.getReminderSettings();
      if (!response.ok) throw new Error('load');
      apply(await response.json());
      setError('');
    } catch {
      setError('讀取提醒設定失敗');
    }
  }, [api]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const toggle = async (mode) => {
    if (!settings || busyMode) return;
    setBusyMode(mode);
    setError('');
    try {
      const response = await api.updateReminderSettings({ [mode]: !settings[mode] });
      if (!response.ok) throw new Error('save');
      apply(await response.json());
    } catch {
      setError('儲存失敗，請稍後再試');
    } finally {
      setBusyMode('');
    }
  };

  return (
    <details open={defaultOpen || undefined} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <summary className="min-h-11 cursor-pointer text-base font-bold text-[#2C4A3E]">LINE 訂餐提醒</summary>
      <div className="mt-3 space-y-3">
        <p className="text-sm text-slate-600">截止前 10 分鐘，若你還沒訂餐，會用 LINE 官方帳號通知你。已訂餐就不會打擾。</p>
        {!hasLineBinding && <p className="text-sm text-amber-800">你的帳號尚未綁定 LINE，無法收到提醒。</p>}
        {ADD_FRIEND_URL && (
          <a href={ADD_FRIEND_URL} target="_blank" rel="noopener noreferrer"
            className="flex min-h-11 items-center justify-center rounded-xl bg-[#06C755] px-4 py-2 text-sm font-bold text-white">
            加入 LINE 官方帳號好友
          </a>
        )}
        {[...REMINDER_OPTIONS, ...(canManageAdminClose ? [ADMIN_CLOSE_OPTION] : [])].map(({ mode, label, hint }) => (
          <label key={mode} className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2">
            <span>
              <span className="block font-semibold">{label}</span>
              <span className="block text-xs text-slate-500">{hint}</span>
            </span>
            <input type="checkbox" className="h-6 w-6 accent-emerald-700"
              checked={Boolean(settings?.[mode === 'adminClose' ? 'adminClose' : mode])}
              disabled={!settings || busyMode === mode}
              onChange={() => toggle(mode)} />
          </label>
        ))}
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      </div>
    </details>
  );
}
