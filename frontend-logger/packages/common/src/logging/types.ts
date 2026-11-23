import type { LogContext } from './context';
import type { LogEvent } from './events';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export type LogEntry = {
  level: LogLevel;
  event: LogEvent;
  context: LogContext; // already sanitized
  timestamp: number; // epoch ms
  seq: number; // per-session sequence number: ordering on the server
  /**
   * The raw error, if one was passed. Built-in transports NEVER send it: the console
   * transport prints it in dev builds only. It exists so a future crash-reporting
   * transport could use it deliberately.
   */
  error?: unknown;
};

/** A destination for log entries: console, your backend, ... */
export interface Transport {
  readonly name: string;
  log(entry: LogEntry): void;
  flush?(): Promise<void>;
}

export interface Logger {
  debug(event: LogEvent, context?: LogContext): void;
  info(event: LogEvent, context?: LogContext): void;
  warn(event: LogEvent, context?: LogContext, error?: unknown): void;
  error(event: LogEvent, context?: LogContext, error?: unknown): void;
  /** A logger that adds the given context to every event, e.g. { feature: 'lending' }. */
  child(context: LogContext): Logger;
}
