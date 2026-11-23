/**
 * Logs the outcome of every RTK Query request. Wrap your OUTERMOST base query
 * (after token refresh and retries), so only what the user experienced is logged.
 *
 *   export const baseQueryWithLogging = withLogging(customBaseQuery);
 *   createApi({ baseQuery: baseQueryWithLogging, ... })
 *
 * Logs: failures (classified by status) and slow successes. Never: URLs, params,
 * headers, bodies or the error's `data`. Never changes the result.
 */
import type { BaseQueryFn } from '@reduxjs/toolkit/query';
import { logger as rootLogger, type Logger, type LogLevel } from '@your-org/common';

export type WithLoggingOptions = {
  slowMs?: number;
  /**
   * Endpoints that are never logged. ALWAYS include the log endpoint itself: otherwise
   * a failing log request logs a failure, which is sent and fails again, in a loop.
   */
  ignoreEndpoints?: string[];
  logger?: Logger;
  /** Override if your customBaseQuery returns errors in its own shape. */
  classify?: (error: unknown) => { level: Extract<LogLevel, 'warn' | 'error'>; errorCode: string; status?: string | number };
  now?: () => number;
};

export function classifyRtkError(error: unknown) {
  const status = (error as { status?: unknown } | null)?.status;
  const s = typeof status === 'number' || typeof status === 'string' ? status : undefined;
  if (status === 'FETCH_ERROR') return { level: 'warn' as const, errorCode: 'NETWORK_ERROR', status: s }; // offline is normal on mobile
  if (status === 'TIMEOUT_ERROR') return { level: 'error' as const, errorCode: 'TIMEOUT', status: s };
  if (status === 'PARSING_ERROR') return { level: 'error' as const, errorCode: 'PARSING_ERROR', status: s }; // contract break
  if (typeof status === 'number') {
    if (status >= 500) return { level: 'error' as const, errorCode: 'SERVER_ERROR', status: s };
    if (status === 401 || status === 403) return { level: 'warn' as const, errorCode: 'UNAUTHORIZED', status: s };
    if (status >= 400) return { level: 'warn' as const, errorCode: 'CLIENT_ERROR', status: s };
  }
  return { level: 'error' as const, errorCode: 'UNKNOWN_ERROR', status: s };
}

export function withLogging<Args, Result, Err, Extra, Meta>(
  baseQuery: BaseQueryFn<Args, Result, Err, Extra, Meta>,
  { slowMs = 2000, ignoreEndpoints = [], logger = rootLogger, classify = classifyRtkError, now = Date.now }: WithLoggingOptions = {},
): BaseQueryFn<Args, Result, Err, Extra, Meta> {
  const ignored = new Set(ignoreEndpoints);
  return async (args, api, extraOptions) => {
    if (ignored.has(api.endpoint)) return baseQuery(args, api, extraOptions);
    const start = now();
    const base = { endpoint: api.endpoint, operation: api.type };
    try {
      const result = await baseQuery(args, api, extraOptions);
      if (api.signal.aborted) return result; // cancelled by RTK Query: not a failure
      const durationMs = now() - start;

      if (result.error !== undefined) {
        const { level, errorCode, status } = classify(result.error);
        logger[level]('api.request.failed', { ...base, status, errorCode, durationMs });
      } else if (durationMs > slowMs) {
        logger.warn('api.request.slow', { ...base, durationMs });
      }
      return result;
    } catch (e) {
      if (!api.signal.aborted) {
        logger.error('api.request.failed', { ...base, errorCode: 'UNEXPECTED_THROW', durationMs: now() - start }, e);
      }
      throw e; // never swallow
    }
  };
}
