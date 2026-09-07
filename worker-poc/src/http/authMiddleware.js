import { resolveCanonicalIdentity } from '../auth/identity.js';

export const requireIdentity = (request, env, options = {}) => (
  resolveCanonicalIdentity(request, env, options.fetchImpl || globalThis.fetch, options)
);
