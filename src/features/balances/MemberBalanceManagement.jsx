import { formatBalanceAmount } from './formatters';

export default function MemberBalanceManagement({
  memberBalances,
  memberBalancesLoading,
  memberBalancesError,
  canTopup,
  isViewAsMode,
  onOpenTopupModal
}) {
  return (
<div className="space-y-4">
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-emerald-900/10 space-y-2">
                  <h3 className="font-bold text-base text-[#2C4A3E]">💰 餘額管理</h3>
                  <p className="text-xs text-gray-500">成員餘額為目前帳戶總額，與訂單日期無關。</p>
                </div>

                {memberBalancesLoading ? (
                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-emerald-900/10 text-center text-sm text-emerald-800 animate-pulse">
                    讀取成員餘額中...
                  </div>
                ) : memberBalancesError ? (
                  <div className="bg-rose-50 p-4 rounded-2xl border border-rose-200 text-center text-sm text-rose-800">
                    {memberBalancesError}
                  </div>
                ) : memberBalances.length === 0 ? (
                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-emerald-900/10 text-center text-sm text-gray-400">
                    目前沒有成員餘額資料
                  </div>
                ) : (
                  <div className="bg-white p-4 rounded-2xl shadow-sm border border-emerald-900/10">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-gray-100 text-gray-600">
                          <tr>
                            <th className="p-2">姓名</th>
                            <th className="p-2">樓層</th>
                            <th className="p-2">餘額</th>
                            <th className="p-2">角色</th>
                            {canTopup && !isViewAsMode && <th className="p-2">操作</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {memberBalances.map((u, idx) => (
                            <tr key={u.userId || `member-${idx}`} className="border-b last:border-0">
                              <td className="p-2 font-medium">{u.name}</td>
                              <td className="p-2">{u.floor}</td>
                              <td className="p-2">
                                <span className={`font-bold px-1.5 py-0.5 rounded text-xs ${u.balance < 0 ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}>
                                  {formatBalanceAmount(u.balance)}
                                </span>
                              </td>
                              <td className="p-2">{u.role}</td>
                              {canTopup && !isViewAsMode && (
                                <td className="p-2">
                                  {u.userId ? (
                                    <button
                                      type="button"
                                      onClick={() => onOpenTopupModal(u)}
                                      className="bg-emerald-700 hover:bg-emerald-600 text-white px-2.5 py-1.5 rounded-lg text-xs font-bold transition shadow-sm whitespace-nowrap"
                                    >
                                      儲值
                                    </button>
                                  ) : (
                                    <span className="text-gray-400">—</span>
                                  )}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
  );
}

