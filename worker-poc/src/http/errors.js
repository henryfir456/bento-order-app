export class HttpError extends Error {
  constructor(status, code, message = code, details = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message = code, details = {}) => (
  new HttpError(400, code, message, details)
);

export const unauthorized = (code = 'AUTH_REQUIRED', message = code) => (
  new HttpError(401, code, message)
);

export const forbidden = (code = 'FORBIDDEN', message = code) => (
  new HttpError(403, code, message)
);

export const notFound = (code = 'NOT_FOUND', message = code) => (
  new HttpError(404, code, message)
);

export const conflict = (code, message = code) => (
  new HttpError(409, code, message)
);

export const toPublicError = (error) => {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      body: {
        error: error.code,
        ...(Object.keys(error.details || {}).length ? { details: error.details } : {})
      }
    };
  }
  return {
    status: 500,
    body: { error: 'INTERNAL_SERVER_ERROR' }
  };
};
