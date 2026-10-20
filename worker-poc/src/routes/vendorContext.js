import { ACTIONS, assertCan } from '../auth/permissions.js';
import { getActiveVendorIdsForPrincipal } from '../domain/vendorMemberships.js';
import { forbidden } from '../http/errors.js';
import { jsonResponse } from '../http/response.js';
import { requireIdentity } from '../http/authMiddleware.js';

export const handleVendorContextRoute = async (request, env, {
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) => {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname !== '/api/vendor/context') return null;

  const identity = await requireIdentity(request, env, {
    fetchImpl,
    allowViewAs: false,
    now
  });
  assertCan(identity, ACTIONS.READ_VENDOR_CONTEXT);
  if (url.searchParams.size > 0) throw forbidden('VENDOR_SCOPE_FORBIDDEN');

  const actorUserId = identity.authorizationActor?.userId;
  if (!actorUserId || actorUserId !== identity.actor?.userId) {
    throw forbidden('VENDOR_SCOPE_FORBIDDEN');
  }
  const vendorIds = await getActiveVendorIdsForPrincipal(env.DB, actorUserId);
  if (vendorIds.length === 0) throw forbidden('VENDOR_SCOPE_FORBIDDEN');
  return jsonResponse({ success: true, role: 'Vendor', vendorIds });
};
