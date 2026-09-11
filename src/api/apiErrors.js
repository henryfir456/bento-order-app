class ApiError extends Error {
  constructor({ code, kind, message, operation = null, status = null }) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.kind = kind;
    this.operation = operation;
    this.status = status;
  }
}

export class ApiConfigurationError extends ApiError {
  constructor(code, message) {
    super({ code, kind: 'configuration', message });
    this.name = 'ApiConfigurationError';
  }
}

export class ApiAuthenticationError extends ApiError {
  constructor(code, message, { operation = null, status = null } = {}) {
    super({ code, kind: 'authentication', message, operation, status });
    this.name = 'ApiAuthenticationError';
  }
}

export class ApiAuthorizationError extends ApiError {
  constructor(code, message, { operation = null, status = null } = {}) {
    super({ code, kind: 'authorization', message, operation, status });
    this.name = 'ApiAuthorizationError';
  }
}

export class ApiBackendError extends ApiError {
  constructor(code, message, { operation = null, status = null } = {}) {
    super({ code, kind: 'backend', message, operation, status });
    this.name = 'ApiBackendError';
  }
}

export class ApiNetworkError extends ApiError {
  constructor(code, message, { operation = null } = {}) {
    super({ code, kind: 'network', message, operation });
    this.name = 'ApiNetworkError';
  }
}

export class ApiContractGapError extends ApiError {
  constructor(code, operation, message) {
    super({ code, kind: 'contract-gap', message, operation });
    this.name = 'ApiContractGapError';
  }
}

export const isApiError = (error) => error instanceof ApiError;

const businessMessages = Object.freeze({
  DEADLINE_CLOSED: '已過截止時間，請重新整理訂單狀態後再試。',
  IDEMPOTENCY_CONFLICT: '請求內容已變更，請重新確認後再試。',
  IDEMPOTENCY_IN_PROGRESS: '請求仍在處理中，請稍候再試。',
  ORDER_ALREADY_CANCELLED: '訂單已取消，請重新整理訂單狀態。',
  ORDER_FORBIDDEN: '無法取消這筆訂單。',
  ORDER_NOT_FOUND: '找不到這筆訂單，請重新整理訂單狀態。',
  EMPLOYEE_NOT_FOUND: '找不到此員工編號，請確認後再試。',
  EMPLOYEE_INACTIVE: '此員工編號目前未啟用，請洽管理員。',
  EMPLOYEE_ALREADY_LINE_BOUND: '此員工編號已綁定 LINE，請直接使用 LINE 登入。',
  LINE_LOGIN_REQUIRED: '此員工編號已綁定 LINE，請使用 LINE 登入。',
  UNVERIFIED_EMPLOYEE: '此員工編號尚未完成核驗，請先使用 LINE 完成 onboarding。',
  LINE_ALREADY_BOUND: '此 LINE 帳號已綁定其他員工，請確認後再試。',
  LINE_BIND_CONFLICT: 'LINE 綁定狀態已變更，請重新登入後再試。',
  INVALID_EMPLOYEE_ID: '員工編號格式不正確，請重新輸入。',
  PROFILE_INVALID: '請確認姓名與基本資料格式。',
  GUEST_SESSION_INVALID: '員工登入已失效，請重新輸入員工編號。',
  EMPLOYEE_BIND_REQUIRED: '此 LINE 帳號尚未綁定員工資料，請先以員工編號登入。'
});

export const getApiErrorPresentation = (error, operationLabel = '操作') => {
  const code = String(error?.code || '').trim();
  const status = Number(error?.status);

  if (error?.kind === 'network' || code === 'API_REQUEST_FAILED') {
    return {
      category: 'network',
      code,
      message: `${operationLabel}失敗，請檢查網路連線後再試。`
    };
  }

  if (error?.kind === 'authentication' || error?.kind === 'authorization') {
    if (businessMessages[code]) {
      return {
        category: error.kind === 'authorization' ? 'authorization' : 'authentication',
        code,
        message: businessMessages[code]
      };
    }
    return {
      category: 'auth',
      code,
      message: `${operationLabel}需要重新驗證身份，請重新登入後再試。`
    };
  }

  if (error?.kind === 'business' || (status >= 400 && status < 500)) {
    return {
      category: 'business',
      code,
      message: businessMessages[code]
        || `${operationLabel}失敗（${code || `HTTP ${status}`}），請檢查資料後再試。`
    };
  }

  return {
    category: 'server',
    code,
    message: `${operationLabel}遇到伺服器錯誤，請稍後再試。`
  };
};
