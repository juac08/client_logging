import type { LogEntry, Transport } from '../types';

/** Prints events to the Metro console. Use in development builds only. */
export function createConsoleTransport(): Transport {
  return {
    name: 'console',
    log({ level, event, context, error }: LogEntry) {
      const line = `[${level}] ${event}`;
      const args: unknown[] = Object.keys(context).length ? [line, context] : [line];
      if (error !== undefined) args.push(error); // local only: never sent anywhere
      (console[level] ?? console.log)(...args);
    },
  };
}
