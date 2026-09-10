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
  ORDER_NOT_FOUND: '找不到這筆訂單，請重新整理訂單狀態。'
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
