import { getAdminSummary, getMemberBalances } from '../domain/adminSummary.js';
import { jsonResponse } from '../http/response.js';
import { requireIdentity } from '../http/authMiddleware.js';

const asBoolean = (value) => value === true || String(value).toLowerCase() === 'true';

export const handleAdminRoute = async (request, env, {
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) => {
  const url = new URL(request.url);
  const isSummary = request.method === 'GET' && url.pathname === '/api/admin/summary';
  const isMembers = request.method === 'GET' && url.pathname === '/api/admin/members/balances';
  if (!isSummary && !isMembers) return null;
  const identity = await requireIdentity(request, env, {
    fetchImpl,
    allowViewAs: true
  });
  if (isMembers) return jsonResponse(await getMemberBalances(env.DB, identity, now));
  return jsonResponse(await getAdminSummary(
    env.DB,
    identity,
    url.searchParams.get('date') || url.searchParams.get('targetDate') || '',
    {
      includeMemberBalances: asBoolean(url.searchParams.get('includeMemberBalances')),
      now
    }
  ));
};

