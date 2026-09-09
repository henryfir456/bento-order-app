import { handleMeRoute } from './routes/me.js';
import { handleOrderRoute } from './routes/orders.js';
import { handleBalanceRoute } from './routes/balance.js';
import { handleAdminRoute } from './routes/admin.js';
import { handleCalendarRoute } from './routes/calendar.js';
import { handleRoleRoute } from './routes/roles.js';
import { handleReadOnlyRequest } from './routes/readOnly.js';
import { HttpError, toPublicError } from './http/errors.js';
import { applyCorsPolicy, emptyResponse, jsonResponse } from './http/response.js';

export const handleFormalRequest = async (request, env, options = {}) => {
  const corsResponse = (response) => applyCorsPolicy(response, request, env);
  if (request.method === 'OPTIONS') return corsResponse(emptyResponse());
  try {
    const meResponse = await handleMeRoute(request, env, options);
    if (meResponse) return corsResponse(meResponse);
    const orderResponse = await handleOrderRoute(request, env, options);
    if (orderResponse) return corsResponse(orderResponse);
    const calendarResponse = await handleCalendarRoute(request, env, options);
    if (calendarResponse) return corsResponse(calendarResponse);
    const roleResponse = await handleRoleRoute(request, env, options);
    if (roleResponse) return corsResponse(roleResponse);
    const adminResponse = await handleAdminRoute(request, env, options);
    if (adminResponse) return corsResponse(adminResponse);
    const balanceResponse = await handleBalanceRoute(request, env, options);
    if (balanceResponse) return corsResponse(balanceResponse);
    const readResponse = await handleReadOnlyRequest(request, env, options);
    if (readResponse) return corsResponse(readResponse);
    return corsResponse(jsonResponse({ error: 'NOT_FOUND' }, 404));
  } catch (error) {
    const publicError = toPublicError(error);
    if (!(error instanceof HttpError) && options.onInternalError) {
      options.onInternalError(error);
    }
    return corsResponse(jsonResponse(publicError.body, publicError.status));
  }
};

export default {
  fetch(request, env) {
    return handleFormalRequest(request, env);
  }
};
