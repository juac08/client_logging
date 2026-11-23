/**
 * The app-wide logger. Import it anywhere:
 *
 *   import { logger } from '@your-org/common';
 *   logger.info('loan.application.started', { feature: 'lending', step: 'amount' });
 *
 *   const log = logger.child({ feature: 'lending' });
 *   log.error('loan.application.failed', { errorCode: 'SUBMISSION_FAILED' }, error);
 *
 * Guarantees:
 *  - Never throws and never blocks: logging can't break a customer flow.
 *  - Every event is sanitized before any transport sees it.
 *  - Events logged before configureLogger() are buffered (newest 100) and delivered later.
 *  - An event logged too often (a loop, a re-render storm) is throttled.
 *  - debug/info calls below minLevel cost almost nothing.
 */
import type { LogContext } from './context';
import type { LogEvent } from './events';
import { errorNameOf, sanitizeContext } from './sanitize';
import { LEVEL_RANK, type LogEntry, type Logger, type LogLevel, type Transport } from './types';

export type LoggerConfig = {
  transports: Transport[];
  /** Lowest level that is processed. Typical: 'debug' in dev, 'info' in production. */
  minLevel?: LogLevel;
  /** 0..1 per event, for chatty events. Errors are never sampled. */
  sampleRates?: Partial<Record<LogEvent, number>>;
  /** Max entries of one event (per level) per minute before throttling. */
  maxPerEventPerMinute?: number;
  /** Warn in the console when fields are dropped by the sanitizer (dev builds). */
  devWarnings?: boolean;
  now?: () => number;
  random?: () => number;
};

const MAX_PENDING = 100;
const THROTTLE_WINDOW_MS = 60_000;

type State = {
  transports: Transport[];
  minLevel: LogLevel;
  sampleRates: Partial<Record<LogEvent, number>>;
  maxPerEventPerMinute: number;
  devWarnings: boolean;
  now: () => number;
  random: () => number;
};

const defaults = (): State => ({
  transports: [],
  minLevel: 'debug', // before configuration, keep everything in the buffer
  sampleRates: {},
  maxPerEventPerMinute: 30,
  devWarnings: false,
  now: Date.now,
  random: Math.random,
});

let state: State = defaults();
let configured = false;
let enabled = true;
let seq = 0;
const pending: LogEntry[] = [];
const windows = new Map<string, { start: number; count: number; dropped: number }>();

export function configureLogger(config: LoggerConfig): void {
  state = {
    ...defaults(),
    ...stripUndefined(config),
    transports: [...config.transports],
  };
  configured = true;
  // Deliver startup events that still pass the configured level
  pending.splice(0).forEach((entry) => {
    if (LEVEL_RANK[entry.level] >= LEVEL_RANK[state.minLevel]) dispatch(entry);
  });
}

/** Kill switch, e.g. from remote config. Disabling also clears the startup buffer. */
export function setLoggingEnabled(value: boolean): void {
  enabled = value;
  if (!value) pending.length = 0;
}

/** Ask every transport to send what it has queued (e.g. when the app is backgrounded). */
export async function flushLogs(): Promise<void> {
  await Promise.all(
    state.transports.map(async (t) => {
      try {
        await t.flush?.();
      } catch {
        /* never throw from logging */
      }
    }),
  );
}

function dispatch(entry: LogEntry): void {
  for (const transport of state.transports) {
    try {
      transport.log(entry);
    } catch {
      /* one broken transport must not affect the others or the app */
    }
  }
}

function throttled(level: LogLevel, event: LogEvent, now: number): boolean {
  const key = `${level}:${event}`;
  const w = windows.get(key);
  if (!w || now - w.start >= THROTTLE_WINDOW_MS) {
    if (w && w.dropped > 0 && event !== 'log.throttled') {
      // Report the previous window's storm once, as a normal event
      emit('warn', 'log.throttled', { source: event, count: w.dropped });
    }
    windows.set(key, { start: now, count: 1, dropped: 0 });
    return false;
  }
  w.count += 1;
  if (w.count > state.maxPerEventPerMinute) {
    w.dropped += 1;
    return true;
  }
  return false;
}

function emit(level: LogLevel, event: LogEvent, rawContext?: LogContext, error?: unknown): void {
  try {
    if (!enabled) return;
    if (configured && LEVEL_RANK[level] < LEVEL_RANK[state.minLevel]) return;

    const rate = level === 'error' ? 1 : (state.sampleRates[event] ?? 1);
    if (rate < 1 && state.random() >= rate) return;

    const now = state.now();
    if (throttled(level, event, now)) return;

    const merged =
      error !== undefined && rawContext?.errorName === undefined
        ? { ...rawContext, errorName: errorNameOf(error) }
        : rawContext;
    const { context, dropped } = sanitizeContext(merged);

    if (state.devWarnings && dropped.length > 0) {
      console.warn(`[logger] "${event}": dropped field(s) ${dropped.join(', ')}. See context.ts for allowed fields.`);
    }

    const entry: LogEntry = { level, event, context, timestamp: now, seq: ++seq, error };

    if (!configured) {
      if (pending.length >= MAX_PENDING) pending.shift(); // keep the newest
      pending.push(entry);
      return;
    }
    dispatch(entry);
  } catch {
    /* logging must never break the app */
  }
}

function createLogger(bound: LogContext): Logger {
  const withBound = (ctx?: LogContext): LogContext | undefined =>
    Object.keys(bound).length ? { ...bound, ...ctx } : ctx;

  return {
    debug: (event, ctx) => emit('debug', event, withBound(ctx)),
    info: (event, ctx) => emit('info', event, withBound(ctx)),
    warn: (event, ctx, error) => emit('warn', event, withBound(ctx), error),
    error: (event, ctx, error) => emit('error', event, withBound(ctx), error),
    child: (ctx) => createLogger({ ...bound, ...ctx }),
  };
}

export const logger: Logger = createLogger({});

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Test-only. */
export function resetLoggerForTests(): void {
  state = defaults();
  configured = false;
  enabled = true;
  seq = 0;
  pending.length = 0;
  windows.clear();
}
