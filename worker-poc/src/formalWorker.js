import { handleMeRoute } from './routes/me.js';
import { handleReadOnlyRequest } from './routes/readOnly.js';
import { HttpError, toPublicError } from './http/errors.js';
import { emptyResponse, jsonResponse } from './http/response.js';

export const handleFormalRequest = async (request, env, options = {}) => {
  if (request.method === 'OPTIONS') return emptyResponse();
  try {
    const meResponse = await handleMeRoute(request, env, options);
    if (meResponse) return meResponse;
    const readResponse = await handleReadOnlyRequest(request, env, options);
    if (readResponse) return readResponse;
    return jsonResponse({ error: 'NOT_FOUND' }, 404);
  } catch (error) {
    const publicError = toPublicError(error);
    if (!(error instanceof HttpError) && options.onInternalError) {
      options.onInternalError(error);
    }
    return jsonResponse(publicError.body, publicError.status);
  }
};

export default {
  fetch(request, env) {
    return handleFormalRequest(request, env);
  }
};
