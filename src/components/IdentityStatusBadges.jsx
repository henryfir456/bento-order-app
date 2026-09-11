import { getIdentityBadges } from '../features/balances/identityStatus';

const toneClasses = Object.freeze({
  line: 'bg-green-50 text-green-800 border-green-200',
  guest: 'bg-slate-50 text-slate-700 border-slate-200',
  bind: 'bg-amber-50 text-amber-800 border-amber-200',
  pending: 'bg-orange-50 text-orange-800 border-orange-200',
  verified: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  unknown: 'bg-gray-50 text-gray-600 border-gray-200'
});

export default function IdentityStatusBadges({ authSource, identityState, fields = null }) {
  const badges = getIdentityBadges({ authSource, identityState })
    .filter((badge) => !fields || fields.includes(badge.key));
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1 align-middle">
      {badges.map((badge) => (
        <span
          key={badge.key}
          data-identity-value={badge.value || 'UNKNOWN'}
          className={`inline-flex max-w-full items-center whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[10px] font-bold leading-4 ${toneClasses[badge.tone]}`}
        >
          {badge.label}
        </span>
      ))}
    </span>
  );
}
