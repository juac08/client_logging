/**
 * Sends log entries to your backend endpoint. Plain `fetch`, no dependencies.
 *
 *  - Batches: sends every `flushIntervalMs`, as soon as `maxBatch` entries are queued,
 *    or on flush() (call it when the app goes to the background).
 *  - 2xx: delivered.
 *  - 408, 429, 5xx, or no network: keeps the batch and retries with exponential
 *    backoff and jitter (honouring Retry-After on 429).
 *  - Any other 4xx: the server refused the batch on purpose, so it is dropped
 *    (never retried forever).
 *  - Bounded queue (`maxQueue`): the oldest entries are dropped first.
 *  - Optional `storage`: keeps unsent entries across app restarts.
 *  - `serialize`: the ONLY place that knows the backend's body format. When the
 *    backend contract is final, change this one function.
 *
 * Only `seq`, `level`, `event`, `timestamp` and `context` are ever sent. The raw
 * `error` object never leaves the device.
 */
import type { LogEntry, Transport } from '../types';

export type WireEntry = Pick<LogEntry, 'seq' | 'level' | 'event' | 'timestamp' | 'context'>;

export type HttpResult = { status: number | 'NETWORK_ERROR'; sent: number; retrying: boolean };

/** Adapter for AsyncStorage, MMKV, ... (see README). */
export interface QueueStorage {
  load(): Promise<WireEntry[]>;
  save(entries: WireEntry[]): Promise<void>;
}

export type HttpTransportOptions = {
  url: string;
  /** Sent once per batch: app version, platform, OS version, environment, session id. */
  meta: Record<string, string>;
  /** Your auth header, e.g. the access token. Called before every request. */
  getHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Builds the request body. Default: { schemaVersion: 1, meta, entries }. */
  serialize?: (entries: WireEntry[], meta: Record<string, string>) => unknown;
  maxBatch?: number;
  maxQueue?: number;
  flushIntervalMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  storage?: QueueStorage;
  onResult?: (result: HttpResult) => void;
  fetchImpl?: typeof fetch;
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

export function createHttpTransport(options: HttpTransportOptions): HttpTransport {
  const {
    url,
    meta,
    getHeaders,
    serialize = defaultSerialize,
    maxBatch = 20,
    maxQueue = 500,
    flushIntervalMs = 15_000,
    backoffBaseMs = 2_000,
    backoffMaxMs = 5 * 60_000,
    storage,
    onResult,
    fetchImpl = (...args) => fetch(...args),
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
    try {
      const headers = { 'Content-Type': 'application/json', ...((await getHeaders?.()) ?? {}) };
      const res = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(serialize(batch, meta)),
      });
      const retrying = res.status === 408 || res.status === 429 || res.status >= 500;
      onResult?.({ status: res.status, sent: batch.length, retrying });
      if (retrying) {
        queue = [...batch, ...queue];
        trim();
        scheduleRetry(retryAfterMs(res));
        return false;
      }
      failures = 0;
      nextAttemptAt = 0;
      return true; // 2xx, or 4xx = refused on purpose: either way, don't resend
    } catch {
      queue = [...batch, ...queue];
      trim();
      scheduleRetry();
      onResult?.({ status: 'NETWORK_ERROR', sent: batch.length, retrying: true });
      return false;
    }
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

function retryAfterMs(res: Response): number | undefined {
  const value = res.headers?.get?.('Retry-After');
  const seconds = value ? Number(value) : NaN;
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}
