import Modal from './Modal';

export default function PickupFloorModal({
  open,
  displayName,
  floor,
  loading,
  error,
  onDisplayNameChange,
  onChange,
  onSave,
  onClose
}) {
  return (
    <Modal
      open={open}
      title="個人資料維護"
      onClose={onClose}
      ariaLabel="關閉個人資料維護"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-500">更新姓名與未來新增訂單預設使用的領取樓層。</p>
        <label className="block space-y-1 text-sm font-bold text-gray-600" htmlFor="profile-display-name">
          姓名
          <input
            id="profile-display-name"
            type="text"
            value={displayName}
            onChange={(event) => onDisplayNameChange(event.target.value)}
            disabled={loading}
            maxLength={100}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-normal focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-100"
          />
        </label>
        <div className="space-y-2">
          <p className="text-sm font-bold text-gray-600">預設取餐樓層</p>
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
