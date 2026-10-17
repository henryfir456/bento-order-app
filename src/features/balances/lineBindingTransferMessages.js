const messages = Object.freeze({
  ADMIN_LINE_AUTH_REQUIRED: '此操作僅限以 LINE 登入的 Admin 執行。',
  USER_NOT_FOUND: '找不到來源帳號，請重新整理使用者資料。',
  TRANSFER_TARGET_NOT_FOUND: '找不到目標員編，請確認員編後重新預覽。',
  INVALID_EMPLOYEE_ID: '員編格式不正確，請重新輸入。',
  SOURCE_AND_TARGET_SAME: '來源與目標是同一個帳號，無法移轉。',
  SOURCE_INACTIVE: '來源帳號已停用，無法移轉。',
  TARGET_INACTIVE: '目標帳號已停用，無法移轉。',
  SOURCE_INVALID_EMPLOYEE_ID: '來源帳號已標記為誤建員編，禁止移轉 LINE 綁定。',
  TARGET_INVALID_EMPLOYEE_ID: '目標帳號已標記為誤建員編，禁止移轉 LINE 綁定。',
  SOURCE_EMPLOYEE_ID_MISSING: '來源帳號沒有員編，請先確認帳號資料。',
  SOURCE_LINE_NOT_BOUND: '來源帳號目前沒有 LINE 綁定，請重新整理使用者資料。',
  TARGET_LINE_ALREADY_BOUND: '目標帳號已有 LINE 綁定，為保護原身分不會覆蓋。',
  LINE_ALREADY_BOUND: '此 LINE 已綁定其他帳號，請重新整理並確認綁定狀態。',
  SOURCE_HAS_ORDERS: '來源帳號有訂單紀錄，不能移轉 LINE 綁定。',
  SOURCE_HAS_TRANSACTIONS: '來源帳號有帳務交易紀錄，不能移轉 LINE 綁定。',
  SOURCE_BALANCE_NON_ZERO: '來源帳號餘額不是 0，不能移轉 LINE 綁定。',
  SOURCE_HAS_LIKES: '來源帳號有收藏紀錄，不能移轉 LINE 綁定。',
  SOURCE_HAS_OPENING_BALANCE: '來源帳號有期初餘額資料，不能移轉 LINE 綁定。',
  SOURCE_HAS_IDEMPOTENCY_RECORDS: '來源帳號有未移轉的操作紀錄，不能移轉 LINE 綁定。',
  LINE_BINDING_TRANSFER_STALE: '預覽後帳號資料已變更，請重新取得移轉預覽。',
  LINE_BINDING_TRANSFER_RACE: '綁定狀態剛被其他操作變更，請重新整理後再試。',
  API_REQUEST_FAILED: '連線失敗，請檢查網路後重新預覽。'
});

export const getLineBindingTransferMessage = (error) => {
  const code = String(error?.code || error?.message || error || '').trim();
  return messages[code]
    || `移轉失敗（${code || '未知錯誤'}），請確認資料後重試。`;
};
