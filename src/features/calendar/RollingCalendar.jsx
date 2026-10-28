import React from 'react';
import { formatDateInput, shiftDateInput } from '../../dateUtils';

const WEEKS = [['上週', -7], ['本週', 0], ['下週', 7]];

export default function RollingCalendar({ renderCalendarDays }) {
  const today = formatDateInput(new Date());
  const dow = new Date(`${today}T12:00:00`).getDay();
  const monday = shiftDateInput(today, dow === 0 ? -6 : 1 - dow);
  return (
    <div className="w-full min-w-0 space-y-3 rounded-2xl border border-emerald-900/10 bg-white p-4 shadow-sm" aria-label="滾動三週訂餐">
      <h2 className="px-1 text-lg font-bold text-[#2C4A3E]">近三週</h2>
      <div className="mb-1 grid grid-cols-5 gap-1 text-center text-xs font-medium text-gray-500">
        <div>一</div><div>二</div><div>三</div><div>四</div><div>五</div>
      </div>
      {WEEKS.map(([label, offset]) => (
        <section key={label} aria-label={label} className="space-y-1">
          <h3 className={`px-1 text-xs font-bold ${label === '本週' ? 'text-[#2C4A3E]' : 'text-slate-500'}`}>{label}</h3>
          <div className="grid grid-cols-5 gap-1.5">
            {renderCalendarDays([0, 1, 2, 3, 4].map((i) => shiftDateInput(monday, offset + i)))}
          </div>
        </section>
      ))}
    </div>
  );
}
