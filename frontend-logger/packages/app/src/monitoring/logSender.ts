/**
 * HOW log batches reach the backend. The only file to change when the backend's
 * generated API arrives.
 *
 * Step 1 (now): plain fetch to the endpoint URL from config.
 * Step 2 (after codegen): switch to the generated RTK Query endpoint. Then the request
 *   goes through your customBaseQuery: same base URL, auth and token refresh as every
 *   other call. Delete the fetch sender, and `url` in config.ts, at that point.
 */
import { createFetchSender, type LogSender } from '@your-org/common';
// Step 2: uncomment, using the names your codegen produced
// import { api, createRtkLogSender, type ClientLogBatch } from '@your-org/api';
// import { store } from '../store';
import { tokenStore } from '../auth/tokenStore'; // your existing token source
import { loggingConfig } from './config';

export function createLogSender(): LogSender {
  // Step 2:
  // return createRtkLogSender(store.dispatch, api.endpoints.sendLog, (body) => ({
  //   clientLogBatch: body as ClientLogBatch, // the generated argument shape
  // }));

  // Step 1:
  return createFetchSender(loggingConfig.url, async (): Promise<Record<string, string>> => {
    const token = await tokenStore.getAccessToken().catch(() => undefined);
    return token ? { Authorization: `Bearer ${token}` } : {};
  });
}
