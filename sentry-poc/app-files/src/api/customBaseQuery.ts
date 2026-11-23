/**
 * Stand-in for YOUR existing customBaseQuery.
 * In your real monorepo you keep your own file (auth headers, token refresh,
 * retries) and do not change it. This one just talks to the local dev server.
 */
import {
  fetchBaseQuery,
  type BaseQueryFn,
  type FetchArgs,
  type FetchBaseQueryError,
} from '@reduxjs/toolkit/query';

let baseUrl = '';

/** Called once at startup by the app with the URL from its config. */
export function setApiBaseUrl(url: string): void {
  baseUrl = url.replace(/\/$/, '');
}

const rawBaseQuery = fetchBaseQuery({
  timeout: 5000, // so the "hang" endpoint produces TIMEOUT_ERROR
  prepareHeaders: (headers) => {
    headers.set('Accept', 'application/json');
    // Your real base query adds the auth token here.
    return headers;
  },
});

export const customBaseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = (
  args,
  api,
  extraOptions,
) => {
  const fetchArgs: FetchArgs = typeof args === 'string' ? { url: args } : args;
  const url = /^https?:\/\//.test(fetchArgs.url) ? fetchArgs.url : `${baseUrl}${fetchArgs.url}`;
  // Your real base query handles 401 -> refresh token -> retry here.
  return rawBaseQuery({ ...fetchArgs, url }, api, extraOptions);
};
