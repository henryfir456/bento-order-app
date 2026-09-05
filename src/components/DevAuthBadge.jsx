export default function DevAuthBadge({ mode, mockUser }) {
  if (!import.meta.env.DEV || mode !== 'mock') return null;

  return (
    <span className="rounded bg-amber-300/90 px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide text-amber-950">
      DEV · MOCK {String(mockUser || 'user').toUpperCase()}
    </span>
  );
}

