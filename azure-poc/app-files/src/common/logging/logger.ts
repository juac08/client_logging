/**
 * Shared logger (in your monorepo: packages/common/src/logging/logger.ts).
 *
 * - No React Native or Azure imports: any package can use it.
 * - Every event goes through sanitize() before it leaves this file.
 * - Events logged before a sink is registered are buffered (max 50).
 * - Never throws: logging must never break a customer flow.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export type LogEvent =
  | 'app.started'
  | 'api.request.failed'
  | 'api.request.slow'
  | 'ui.render.failed'
  | 'app.js.error'
  | 'feature.operation.failed';

export type LogContext = {
  feature?: string; // 'lending', 'loanApplication'
  endpoint?: string; // RTK Query endpoint name, never a URL
  status?: string | number;
  errorCode?: string; // 'SERVER_ERROR', 'NETWORK_ERROR'
  errorName?: string; // 'TypeError'; never the message
  durationMs?: number;
};

export type LogEntry = {
  level: LogLevel;
  event: LogEvent;
  context: LogContext;
  timestamp: number;
};

export type LogSink = (entry: LogEntry) => void;

const ALLOWED_KEYS: (keyof LogContext)[] = [
  'feature',
  'endpoint',
  'status',
  'errorCode',
  'errorName',
  'durationMs',
];
const SAFE_TEXT = /^[A-Za-z0-9_.-]{1,64}$/; // identifiers only: no spaces, no free text
const LONG_DIGITS = /\d{6,}/; // blocks account numbers and national IDs
const MAX_PENDING = 50;

let sink: LogSink | null = null;
const pending: LogEntry[] = [];

export function sanitize(ctx: LogContext = {}): LogContext {
  const out: Record<string, string | number> = {};
  for (const key of ALLOWED_KEYS) {
    const value = (ctx as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = Math.round(value);
    } else if (typeof value === 'string' && SAFE_TEXT.test(value) && !LONG_DIGITS.test(value)) {
      out[key] = value;
    }
  }
  return out as LogContext;
}

export function setLogSink(next: LogSink): void {
  sink = next;
  // Deliver anything logged before the sink existed (app startup)
  pending.splice(0).forEach((entry) => {
    try {
      next(entry);
    } catch {
      /* ignore */
    }
  });
}

function log(level: LogLevel, event: LogEvent, ctx?: LogContext): void {
  try {
    const entry: LogEntry = { level, event, context: sanitize(ctx), timestamp: Date.now() };
    if (sink) {
      sink(entry);
      return;
    }
    if (pending.length >= MAX_PENDING) pending.shift(); // keep only the newest 50
    pending.push(entry);
  } catch {
    // Logging must never break the app
  }
}

export const logger = {
  info: (event: LogEvent, ctx?: LogContext) => log('info', event, ctx),
  warn: (event: LogEvent, ctx?: LogContext) => log('warn', event, ctx),
  error: (event: LogEvent, ctx?: LogContext) => log('error', event, ctx),
};

/** Test-only: clears the sink and the startup buffer. */
export function resetLoggerForTests(): void {
  sink = null;
  pending.length = 0;
}
