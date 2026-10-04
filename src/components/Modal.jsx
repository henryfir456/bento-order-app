import { useEffect, useRef } from 'react';

export default function Modal({
  open,
  title,
  onClose,
  children,
  ariaLabel = '關閉視窗',
  className = 'max-w-md'
}) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const previouslyFocused = document.activeElement;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    dialogRef.current?.querySelector('button:not([disabled])')?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
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
        ref={dialogRef}
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
