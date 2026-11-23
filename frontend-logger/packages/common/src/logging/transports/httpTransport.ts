/**
 * Queues log entries and delivers them to your backend in batches.
 *
 * HOW a batch is sent is pluggable (`send`):
 *  - `createFetchSender(url, getHeaders)`: plain fetch, before the backend's generated
 *    API exists.
 *  - Your generated RTK Query endpoint (see packages/app/src/monitoring/rtkLogSender.ts):
 *    reuses your base query, so auth and token refresh come for free.
 *
 * Delivery rules (the same for any sender):
 *  - Sends every `flushIntervalMs`, as soon as `maxBatch` entries are queued, or on
 *    flush() (when the app goes to the background).
 *  - 2xx: delivered.
 *  - 408, 429, 5xx, or no network: keeps the batch and retries with exponential
 *    backoff and jitter (honouring Retry-After when the sender reports it).
 *  - Any other 4xx: the server refused the batch on purpose, so it is dropped.
 *  - Bounded queue (`maxQueue`): the oldest entries are dropped first.
 *  - Optional `storage`: keeps unsent entries across app restarts.
 *  - `serialize`: the ONLY place that knows the backend's body format.
 *
 * Only `seq`, `level`, `event`, `timestamp` and `context` are ever sent. The raw
 * `error` object never leaves the device.
 */
import type { LogEntry, Transport } from '../types';

export type WireEntry = Pick<LogEntry, 'seq' | 'level' | 'event' | 'timestamp' | 'context'>;

/** What a sender reports back. Use 'NETWORK_ERROR' for offline, DNS, timeout and the like. */
export type SendResult = { status: number | 'NETWORK_ERROR'; retryAfterMs?: number };

/** Sends one serialized batch. May also throw: that counts as a network error. */
export type LogSender = (body: unknown) => Promise<SendResult>;

export type HttpResult = { status: number | 'NETWORK_ERROR'; sent: number; retrying: boolean };

/** Adapter for AsyncStorage, MMKV, ... (see README). */
export interface QueueStorage {
  load(): Promise<WireEntry[]>;
  save(entries: WireEntry[]): Promise<void>;
}

export type HttpTransportOptions = {
  /** How to send a batch. */
  send: LogSender;
  /** Sent once per batch: app version, platform, OS version, environment, session id. */
  meta: Record<string, string>;
  /** Builds the request body. Default: { schemaVersion: 1, meta, entries }. */
  serialize?: (entries: WireEntry[], meta: Record<string, string>) => unknown;
  maxBatch?: number;
  maxQueue?: number;
  flushIntervalMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  storage?: QueueStorage;
  onResult?: (result: HttpResult) => void;
  now?: () => number;
  random?: () => number;
};

export type HttpTransport = Transport & {
  flush(): Promise<void>;
  /** Save unsent entries to `storage` (call when the app goes to the background). */
  persist(): Promise<void>;
  dispose(): void;
  /** Runs one scheduled attempt (respects backoff). Used by the timer; exposed for tests. */
  tick(): Promise<void>;
  size(): number;
};

const defaultSerialize = (entries: WireEntry[], meta: Record<string, string>) => ({
  schemaVersion: 1,
  meta,
  entries,
});

const isRetryable = (status: SendResult['status']) =>
  status === 'NETWORK_ERROR' || status === 408 || status === 429 || status >= 500;

export function createHttpTransport(options: HttpTransportOptions): HttpTransport {
  const {
    send,
    meta,
    serialize = defaultSerialize,
    maxBatch = 20,
    maxQueue = 500,
    flushIntervalMs = 15_000,
    backoffBaseMs = 2_000,
    backoffMaxMs = 5 * 60_000,
    storage,
    onResult,
    now = Date.now,
    random = Math.random,
  } = options;

  let queue: WireEntry[] = [];
  let inFlight: Promise<void> | null = null;
  let failures = 0;
  let nextAttemptAt = 0;

  const trim = () => {
    if (queue.length > maxQueue) queue.splice(0, queue.length - maxQueue);
  };

  const scheduleRetry = (retryAfterMs?: number) => {
    failures += 1;
    const exp = Math.min(backoffMaxMs, backoffBaseMs * 2 ** (failures - 1));
    const jittered = exp / 2 + random() * (exp / 2); // spread retries from many devices
    nextAttemptAt = now() + Math.max(jittered, retryAfterMs ?? 0);
  };

  async function sendOnce(): Promise<boolean> {
    const batch = queue.splice(0, maxBatch);
    if (batch.length === 0) return false;

    let result: SendResult;
    try {
      result = await send(serialize(batch, meta));
    } catch {
      result = { status: 'NETWORK_ERROR' };
    }

    const retrying = isRetryable(result.status);
    onResult?.({ status: result.status, sent: batch.length, retrying });
    if (retrying) {
      queue = [...batch, ...queue];
      trim();
      scheduleRetry(result.retryAfterMs);
      return false;
    }
    failures = 0;
    nextAttemptAt = 0;
    return true; // 2xx, or 4xx = refused on purpose: either way, don't resend
  }

  function drain(): Promise<void> {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        while (queue.length > 0 && (await sendOnce())) {
          /* keep sending while the server accepts */
        }
        if (queue.length === 0) await storage?.save([]).catch(() => {});
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  const tick = async () => {
    if (now() >= nextAttemptAt) await drain();
  };

  const timer = setInterval(() => void tick(), flushIntervalMs);

  // Restore entries left from a previous run (before anything new is queued)
  if (storage) {
    void storage
      .load()
      .then((saved) => {
        if (Array.isArray(saved) && saved.length) {
          queue = [...saved, ...queue];
          trim();
        }
      })
      .catch(() => {});
  }

  return {
    name: 'http',
    log({ seq, level, event, timestamp, context }: LogEntry) {
      queue.push({ seq, level, event, timestamp, context }); // never the raw error
      trim();
      if (queue.length >= maxBatch && now() >= nextAttemptAt) void drain();
    },
    flush: drain, // a manual flush ignores backoff: it's the last chance before backgrounding
    persist: async () => {
      if (storage) await storage.save(queue).catch(() => {});
    },
    dispose: () => clearInterval(timer),
    tick,
    size: () => queue.length,
  };
}

/**
 * Plain-fetch sender, for use until the backend's generated API is available.
 *
 *   send: createFetchSender('https://api.example.no/client-logs', async () => ({ Authorization: ... }))
 */
export function createFetchSender(
  url: string,
  getHeaders?: () => Record<string, string> | Promise<Record<string, string>>,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): LogSender {
  return async (body) => {
    try {
      const headers = { 'Content-Type': 'application/json', ...((await getHeaders?.()) ?? {}) };
      const res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body) });
      const seconds = Number(res.headers?.get?.('Retry-After'));
      return { status: res.status, retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined };
    } catch {
      return { status: 'NETWORK_ERROR' };
    }
  };
}
