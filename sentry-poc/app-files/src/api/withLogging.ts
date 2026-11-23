/**
 * Generic logging decorator for any RTK Query base query
 * (in your monorepo: packages/api/src/withLogging.ts).
 *
 * Wrap the OUTERMOST base query (after token refresh and retries), so only
 * the final outcome the user experienced is logged.
 */
import type { BaseQueryFn } from '@reduxjs/toolkit/query';
import { logger, type LogLevel } from '@poc/common';

export type WithLoggingOptions = {
  slowMs?: number; // successful calls slower than this are logged as warn
  now?: () => number; // injectable clock, for tests
};

export function classify(status: unknown): { level: LogLevel; errorCode: string } {
  if (status === 'FETCH_ERROR') return { level: 'warn', errorCode: 'NETWORK_ERROR' }; // offline is normal on mobile
  if (status === 'TIMEOUT_ERROR') return { level: 'error', errorCode: 'TIMEOUT' };
  if (status === 'PARSING_ERROR') return { level: 'error', errorCode: 'PARSING_ERROR' }; // contract break
  if (typeof status === 'number') {
    if (status >= 500) return { level: 'error', errorCode: 'SERVER_ERROR' };
    if (status === 401 || status === 403) return { level: 'warn', errorCode: 'UNAUTHORIZED' };
    if (status >= 400) return { level: 'warn', errorCode: 'CLIENT_ERROR' };
  }
  return { level: 'error', errorCode: 'UNKNOWN_ERROR' };
}

export function withLogging<Args, Result, Err, Extra, Meta>(
  baseQuery: BaseQueryFn<Args, Result, Err, Extra, Meta>,
  { slowMs = 2000, now = Date.now }: WithLoggingOptions = {},
): BaseQueryFn<Args, Result, Err, Extra, Meta> {
  return async (args, api, extraOptions) => {
    const start = now();
    try {
      const result = await baseQuery(args, api, extraOptions);
      const durationMs = now() - start;

      // Cancelled by RTK Query (unmount, replaced query): not a failure
      if (api.signal.aborted) return result;

      if (result.error !== undefined) {
        const status = (result.error as { status?: string | number } | null)?.status;
        const { level, errorCode } = classify(status);
        logger[level]('api.request.failed', {
          endpoint: api.endpoint,
          status,
          errorCode,
          durationMs,
        });
      } else if (durationMs > slowMs) {
        logger.warn('api.request.slow', { endpoint: api.endpoint, durationMs });
      }

      return result; // never modified
    } catch (e) {
      if (!api.signal.aborted) {
        logger.error('api.request.failed', {
          endpoint: api.endpoint,
          errorCode: 'UNEXPECTED_THROW',
          errorName: e instanceof Error ? e.name : undefined,
          durationMs: now() - start,
        }, e); // raw error: only sinks that report stack traces use it
      }
      throw e; // never swallow
    }
  };
}
