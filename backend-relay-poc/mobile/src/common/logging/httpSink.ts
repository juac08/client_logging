/**
 * Sends log entries to YOUR backend in small batches
 * (in your monorepo: packages/common/src/logging/httpSink.ts).
 *
 * No React Native or vendor SDK: just fetch. Behaviour:
 *  - Batches up to `maxBatch` entries; sends every `intervalMs`, when a batch is full, or on flush().
 *  - 2xx: delivered.
 *  - 429 or 5xx, or no network: keeps the batch and retries on the next tick.
 *  - Any other 4xx (400/411/413): the server refused it on purpose, so drop it (never retry forever).
 *  - The queue is bounded (`maxQueue`); when full, the oldest entries are dropped.
 */
import type { LogEntry, LogSink } from './logger';

export type AppInfo = {
  version: string;
  platform: string; // 'ios' | 'android'
  osVersion: string;
  environment: string;
  sessionId: string;
};

export type HttpSinkOptions = {
  url: string;
  app: AppInfo;
  /** Auth or app-attestation headers, e.g. your existing access token. */
  getHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  maxBatch?: number;
  maxQueue?: number;
  intervalMs?: number;
  fetchImpl?: typeof fetch;
  /** Called after each send attempt; handy for a dev console line. */
  onResult?: (result: { status: number | 'NETWORK_ERROR'; sent: number; requeued: boolean }) => void;
};

export type HttpSink = {
  write: LogSink;
  flush: () => Promise<void>;
  dispose: () => void;
  /** Test/debug only. */
  queueSize: () => number;
};

type WireEntry = Pick<LogEntry, 'level' | 'event' | 'timestamp' | 'context'>;

export function createHttpSink({
  url,
  app,
  getHeaders,
  maxBatch = 20,
  maxQueue = 200,
  intervalMs = 15000,
  fetchImpl = fetch,
  onResult,
}: HttpSinkOptions): HttpSink {
  let queue: WireEntry[] = [];
  let inFlight: Promise<void> | null = null;

  const requeue = (batch: WireEntry[]) => {
    queue = [...batch, ...queue].slice(-maxQueue); // bounded: oldest go first
  };

  async function sendOnce(): Promise<boolean> {
    const batch = queue.splice(0, maxBatch);
    if (batch.length === 0) return false;
    try {
      const headers = { 'Content-Type': 'application/json', ...((await getHeaders?.()) ?? {}) };
      const res = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ schemaVersion: 1, app, entries: batch }),
      });
      const retry = res.status === 429 || res.status >= 500;
      if (retry) requeue(batch);
      onResult?.({ status: res.status, sent: batch.length, requeued: retry });
      return !retry; // keep draining only after a success
    } catch {
      requeue(batch); // offline: try again later
      onResult?.({ status: 'NETWORK_ERROR', sent: batch.length, requeued: true });
      return false;
    }
  }

  function drain(): Promise<void> {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        while (queue.length > 0 && (await sendOnce())) {
          /* keep sending full batches while the server accepts them */
        }
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  const timer = setInterval(() => void drain(), intervalMs);

  return {
    write(entry) {
      const { level, event, timestamp, context } = entry; // never send anything else
      queue.push({ level, event, timestamp, context });
      if (queue.length > maxQueue) queue.splice(0, queue.length - maxQueue);
      if (queue.length >= maxBatch) void drain();
    },
    flush: drain,
    dispose: () => clearInterval(timer),
    queueSize: () => queue.length,
  };
}
