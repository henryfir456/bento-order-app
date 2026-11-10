import React, { useCallback, useEffect, useState } from 'react';

// Opt-in LINE reminders 10 minutes before each group closes; one switch per group type.
const REMINDER_OPTIONS = [
  { mode: 'A', label: '蔡老師', hint: '當天 10:00 截止，開啟後可設定提醒時間' },
  { mode: 'B', label: '其他廠商（如禾拾）', hint: '前一天 18:00 截止，開啟後可設定提醒時間' }
];

const LEAD_CHOICES = [10, 30, 60];
const WEEKDAY_CHOICES = [[1, '一'], [2, '二'], [3, '三'], [4, '四'], [5, '五']];
const LUNAR_CHOICES = [[1, '初一'], [15, '十五']];
const DEFAULT_SCHEDULE = { leadMinutes: 10, weekdays: [1, 2, 3, 4, 5], lunarDays: [] };

const describeSchedule = ({ leadMinutes, weekdays, lunarDays }) => {
  const days = weekdays.length === 5 ? '週一至週五' : `週${weekdays.map((day) => WEEKDAY_CHOICES.find(([value]) => value === day)?.[1]).join('、')}`;
  const lunar = lunarDays.length ? `・只限農曆${lunarDays.map((day) => LUNAR_CHOICES.find(([value]) => value === day)?.[1]).join('、')}` : '';
  return `${days}・提前 ${leadMinutes} 分鐘${lunar}`;
};

const chipClass = (active) => `min-h-11 min-w-11 rounded-full border px-3 text-sm font-semibold ${active
  ? 'border-emerald-700 bg-emerald-700 text-white'
  : 'border-slate-300 bg-white text-slate-700'}`;

const ADMIN_CLOSE_OPTION = { mode: 'adminClose', label: '蔡老師結單通知', hint: '每天 10:00 結單後，用 LINE 通知訂單數與份數（管理者）' };
const ADMIN_VENDOR_CLOSE_OPTION = { mode: 'adminVendorClose', label: '廠商結單通知（如禾拾）', hint: '前一天 18:00 結單後，用 LINE 通知訂單數與份數（管理者，預設關閉）' };
const VENDOR_CLOSE_OPTION = { mode: 'vendorClose', label: '結單通知', hint: '前一天 18:00 結單後，用 LINE 通知訂單數與份數' };
const DEFAULT_ADD_FRIEND_URL = 'https://line.me/R/ti/p/@518jelfh';
const ADD_FRIEND_URL = String(import.meta.env?.VITE_LINE_OA_ADD_FRIEND_URL || '').trim() || DEFAULT_ADD_FRIEND_URL;

export default function OrderReminderSettings({ api, defaultOpen = false }) {
  const [settings, setSettings] = useState(null);
  const [hasLineBinding, setHasLineBinding] = useState(true);
  const [canManageAdminClose, setCanManageAdminClose] = useState(false);
  const [canManageVendorClose, setCanManageVendorClose] = useState(false);
  const [schedule, setSchedule] = useState({ A: DEFAULT_SCHEDULE, B: DEFAULT_SCHEDULE });
  const [busyMode, setBusyMode] = useState('');
  const [error, setError] = useState('');

  const apply = (payload) => {
    setSettings({
      A: Boolean(payload?.settings?.A),
      B: Boolean(payload?.settings?.B),
      adminClose: payload?.settings?.adminClose !== false,
      vendorClose: payload?.settings?.vendorClose !== false,
      adminVendorClose: payload?.settings?.adminVendorClose === true
    });
    setSchedule({
      A: { ...DEFAULT_SCHEDULE, ...payload?.schedule?.A },
      B: { ...DEFAULT_SCHEDULE, ...payload?.schedule?.B }
    });
    setCanManageAdminClose(Boolean(payload?.canManageAdminClose));
    setCanManageVendorClose(Boolean(payload?.canManageVendorClose));
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

  const saveSchedule = async (mode, patch) => {
    if (busyMode) return;
    const next = { ...schedule[mode], ...patch };
    if (!next.weekdays.length) return;
    setBusyMode(`schedule-${mode}`);
    setError('');
    try {
      const response = await api.updateReminderSettings({ schedule: { [mode]: next } });
      if (!response.ok) throw new Error('save');
      apply(await response.json());
    } catch {
      setError('儲存失敗，請稍後再試');
    } finally {
      setBusyMode('');
    }
  };

  const toggleIn = (list, value) => (list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value].sort((a, b) => a - b));

  const renderScheduleControls = (mode) => {
    const current = schedule[mode];
    const disabled = busyMode === `schedule-${mode}`;
    return (
      <div className="mt-2 space-y-3 border-t border-slate-100 pt-3" data-testid={`reminder-schedule-${mode}`}>
        <p className="text-xs font-semibold text-emerald-800">{describeSchedule(current)}</p>
        <div>
          <p className="mb-1 text-xs text-slate-500">提前多久提醒</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="提前多久提醒">
            {LEAD_CHOICES.map((minutes) => (
              <button key={minutes} type="button" role="radio" aria-checked={current.leadMinutes === minutes}
                disabled={disabled} className={chipClass(current.leadMinutes === minutes)}
                onClick={() => saveSchedule(mode, { leadMinutes: minutes })}>{minutes} 分鐘</button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs text-slate-500">訂餐日是星期幾（至少選一天）</p>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_CHOICES.map(([day, label]) => (
              <button key={day} type="button" aria-pressed={current.weekdays.includes(day)}
                disabled={disabled || (current.weekdays.length === 1 && current.weekdays.includes(day))}
                className={chipClass(current.weekdays.includes(day))}
                onClick={() => saveSchedule(mode, { weekdays: toggleIn(current.weekdays, day) })}>{label}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs text-slate-500">只在農曆這幾天提醒（都不選＝不限制）</p>
          <div className="flex flex-wrap gap-2">
            {LUNAR_CHOICES.map(([day, label]) => (
              <button key={day} type="button" aria-pressed={current.lunarDays.includes(day)}
                disabled={disabled} className={chipClass(current.lunarDays.includes(day))}
                onClick={() => saveSchedule(mode, { lunarDays: toggleIn(current.lunarDays, day) })}>{label}</button>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <details open={defaultOpen || undefined} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <summary className="min-h-11 cursor-pointer text-base font-bold text-[#2C4A3E]">{canManageVendorClose ? 'LINE 結單通知' : 'LINE 訂餐提醒'}</summary>
      <div className="mt-3 space-y-3">
        <p className="text-sm text-slate-600">{canManageVendorClose
          ? '結單後，會用 LINE 官方帳號通知你當天的訂單數與份數。'
          : '截止前，若你還沒訂餐，會用 LINE 官方帳號通知你。已訂餐就不會打擾。'}</p>
        {!hasLineBinding && <p className="text-sm text-amber-800">你的帳號尚未綁定 LINE，無法收到通知。</p>}
        {ADD_FRIEND_URL && (
          <a href={ADD_FRIEND_URL} target="_blank" rel="noopener noreferrer"
            className="flex min-h-11 items-center justify-center rounded-xl bg-[#06C755] px-4 py-2 text-sm font-bold text-white">
            加入 LINE 官方帳號好友
          </a>
        )}
        {(canManageVendorClose
          ? [VENDOR_CLOSE_OPTION]
          : [...REMINDER_OPTIONS, ...(canManageAdminClose ? [ADMIN_CLOSE_OPTION, ADMIN_VENDOR_CLOSE_OPTION] : [])]).map(({ mode, label, hint }) => (
          <div key={mode} className="rounded-xl border border-slate-200 px-3 py-2">
            <label className="flex min-h-12 items-center justify-between gap-3">
              <span>
                <span className="block font-semibold">{label}</span>
                <span className="block text-xs text-slate-500">{hint}</span>
              </span>
              <input type="checkbox" className="h-6 w-6 accent-emerald-700"
                checked={Boolean(settings?.[mode])}
                disabled={!settings || busyMode === mode}
                onChange={() => toggle(mode)} />
            </label>
            {(mode === 'A' || mode === 'B') && settings?.[mode] && renderScheduleControls(mode)}
          </div>
        ))}
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      </div>
    </details>
  );
}
