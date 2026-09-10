import { handleRemoteCleanupRequest } from './remote-cleanup-worker.mjs';

export default {
  fetch: handleRemoteCleanupRequest
};
