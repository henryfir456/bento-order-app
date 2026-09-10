import Modal from '../../components/Modal';

const formatAmount = amount => `$${Number(amount || 0).toLocaleString('en-US')}`;

export default function OrderConfirmationModal({
  open,
  submission,
  loading,
  onCancel,
  onConfirm,
  title = '確認訂單',
  cancelLabel = '取消',
  confirmLabel = '確認下單',
  loadingLabel = '送出中...',
  error = ''
}) {
  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={loading ? () => {} : onCancel}
      title={title}
    >
      <div className="space-y-4 text-sm text-gray-700">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg bg-gray-50 p-3">
          <dt className="font-semibold text-gray-500">訂餐日期</dt>
          <dd>{submission.targetDate || '未指定'}</dd>
          {submission.vendor && (
            <>
              <dt className="font-semibold text-gray-500">店家</dt>
              <dd>{submission.vendor}</dd>
            </>
          )}
          <dt className="font-semibold text-gray-500">領取樓層</dt>
          <dd>{submission.pickupFloor || '未指定'}</dd>
        </dl>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full min-w-[320px] text-left">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2 font-semibold">餐點</th>
                <th className="px-3 py-2 text-right font-semibold">數量</th>
                <th className="px-3 py-2 text-right font-semibold">單價</th>
                <th className="px-3 py-2 text-right font-semibold">小計</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {submission.items.map(item => (
                <tr key={item.item_id}>
                  <td className="px-3 py-2">{item.item_name || item.item_id}</td>
                  <td className="px-3 py-2 text-right">{item.quantity}</td>
                  <td className="px-3 py-2 text-right">{formatAmount(item.unit_price)}</td>
                  <td className="px-3 py-2 text-right">{formatAmount(item.subtotal ?? (item.unit_price * item.quantity))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-gray-200 bg-gray-50 font-semibold">
              <tr>
                <th className="px-3 py-2 text-left">合計</th>
                <td className="px-3 py-2 text-right">{submission.totalCount}</td>
                <td className="px-3 py-2 text-right">—</td>
                <td className="px-3 py-2 text-right">{formatAmount(submission.totalAmount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="rounded-lg border border-gray-200 px-3 py-2">
          <span className="font-semibold text-gray-500">備註：</span>{submission.note.trim() || '無備註'}
        </p>

        {error && (
          <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-gray-200 pt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg border border-gray-300 px-4 py-2 font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="rounded-lg bg-[#2C4A3E] px-4 py-2 font-semibold text-white transition hover:bg-[#20382F] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? loadingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
