import { useEffect } from 'react';

export default function Modal({
  open,
  title,
  onClose,
  children,
  ariaLabel = '關閉視窗',
  className = 'max-w-md'
}) {
  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title ? undefined : ariaLabel}
        aria-labelledby={title ? 'shared-modal-title' : undefined}
        className={`max-h-[90vh] w-full overflow-y-auto rounded-3xl border border-emerald-100 bg-white p-6 shadow-2xl ${className}`}
      >
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-gray-100 pb-3">
          {title ? (
            <h2 id="shared-modal-title" className="font-bold text-base text-[#2C4A3E]">{title}</h2>
          ) : <span />}
          <button
            type="button"
            onClick={onClose}
            aria-label={ariaLabel}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-50 text-lg font-bold text-gray-400 transition-colors hover:bg-rose-50 hover:text-rose-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
