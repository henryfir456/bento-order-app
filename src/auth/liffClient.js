import liff from '@line/liff';
import { createAuthClient } from './authClient.js';

export const authClient = createAuthClient({
  env: import.meta.env,
  liffClient: liff
});
