export const CATEGORY_LABELS = Object.freeze({
  SYSTEM: '系統功能',
  MENU: '便當/菜色',
  VENDOR: '店家/廠商',
  OTHER: '其他'
});

export const STATUS_LABELS = Object.freeze({
  NEW: '未處理',
  IN_PROGRESS: '處理中',
  DONE: '已處理'
});

export const STATUS_STYLES = Object.freeze({
  NEW: 'bg-amber-100 text-amber-800',
  IN_PROGRESS: 'bg-sky-100 text-sky-800',
  DONE: 'bg-emerald-100 text-emerald-800'
});

export const VISIBILITY_NOTICE = '你的意見只有你本人和管理員看得到，不會公開給其他同事或廠商。';

const ERROR_MESSAGES = {
  FEEDBACK_MESSAGE_REQUIRED: '請輸入意見內容。',
  FEEDBACK_MESSAGE_TOO_LONG: '意見內容太長，請控制在 1000 字以內。',
  FEEDBACK_CATEGORY_INVALID: '請選擇意見類別。',
  FEEDBACK_RATING_INVALID: '星等請選 1 到 5 顆星。',
  FEEDBACK_TARGET_TOO_LONG: '對象名稱太長。',
  FEEDBACK_DAILY_LIMIT: '今天送出的意見已達上限（24 小時內最多 5 則），請明天再試。',
  FEEDBACK_NOT_FOUND: '找不到這則意見。',
  FEEDBACK_NOTE_TOO_LONG: '備註太長，請控制在 500 字以內。',
  FORBIDDEN: '目前的登入方式無法使用意見反饋。'
};

export const feedbackErrorMessage = (error) => (
  ERROR_MESSAGES[error?.code]
  || (error?.code ? `操作失敗（${error.code}）。` : (error?.message || '操作失敗，請稍後再試。'))
);

// Worker API methods resolve to a fetch Response; accept parsed objects too.
export const parsedResult = async (promise) => {
  const result = await promise;
  if (typeof result?.json === 'function') {
    const body = await result.json();
    if (result.ok === false) {
      const error = new Error(body?.error?.message || body?.message || 'REQUEST_FAILED');
      error.code = body?.error?.code || body?.code || '';
      throw error;
    }
    return body;
  }
  return result;
};

export const formatFeedbackTime = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
};
