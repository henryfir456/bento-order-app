import Modal from './Modal';

export default function PickupFloorModal({
  open,
  floor,
  loading,
  error,
  onChange,
  onSave,
  onClose
}) {
  return (
    <Modal
      open={open}
      title="設定預設領取樓層"
      onClose={onClose}
      ariaLabel="關閉預設領取樓層設定"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-500">未來新增訂單將預設使用這個領取樓層。</p>
        <div className="grid grid-cols-2 gap-3">
          {['1樓', '9樓'].map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              aria-pressed={floor === option}
              disabled={loading}
              className={`rounded-2xl border px-4 py-3 text-sm font-bold transition focus:outline-none focus:ring-2 focus:ring-emerald-500 ${floor === option ? 'border-emerald-700 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-gray-50 text-gray-600'} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {option}
            </button>
          ))}
        </div>
        {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        <button
          type="button"
          onClick={onSave}
          disabled={loading}
          className="w-full rounded-2xl bg-[#2C4A3E] py-3 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {loading ? '儲存中...' : '儲存設定'}
        </button>
      </div>
    </Modal>
  );
}
