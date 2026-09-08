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

export class ApiContractGapError extends ApiError {
  constructor(code, operation, message) {
    super({ code, kind: 'contract-gap', message, operation });
    this.name = 'ApiContractGapError';
  }
}

export const isApiError = (error) => error instanceof ApiError;
