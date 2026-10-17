const messages = Object.freeze({
  SOURCE_AND_TARGET_SAME: '來源與目標是同一個帳號，無法修復。',
  SOURCE_ALREADY_INVALID: '來源帳號已標記為誤建員編。',
  SOURCE_INACTIVE: '來源帳號已停用，無法再次修復。',
  SOURCE_ROLE_NOT_REPAIRABLE: '來源帳號角色不符合修復條件。',
  SOURCE_EMPLOYEE_ID_MISSING: '來源帳號沒有員編，請先確認帳號資料。',
  SOURCE_NAME_REQUIRED: '來源帳號沒有可同步的姓名。',
  TARGET_ALREADY_INVALID: '目標帳號已標記為誤建員編。',
  TARGET_INACTIVE: '目標帳號已停用，無法作為修復目標。',
  TARGET_EMPLOYEE_ID_MISSING: '目標帳號沒有員編，請重新選擇目標。',
  TARGET_NAME_REQUIRED: '目標帳號沒有可確認的姓名。',
  REPAIR_ALREADY_RECORDED: '此來源帳號已有修復稽核紀錄。'
});

export const getInvalidEmployeeRepairMessage = (code) => (
  messages[String(code || '').trim()] || '目前無法進行安全修復，請重新整理來源與目標資料後再試。'
);
