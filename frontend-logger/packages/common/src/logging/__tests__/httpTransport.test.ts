import {
  createFetchSender,
  createHttpTransport,
  type HttpTransport,
  type LogEntry,
  type QueueStorage,
  type SendResult,
  type WireEntry,
} from '..';

const meta = { appVersion: '1.4.0', platform: 'ios', environment: 'test', sessionId: 'abc123' };

const entry = (i = 0): LogEntry => ({
  level: 'error',
  event: 'api.request.failed',
  context: { endpoint: 'getLoans', status: 503 },
  timestamp: 1000 + i,
  seq: i + 1,
  error: new TypeError('must never be sent'),
});

const wire = (i = 0): WireEntry => {
  const { error: _error, ...rest } = entry(i);
  return rest;
};

const ok = (): Promise<SendResult> => Promise.resolve({ status: 202 });

describe('createHttpTransport', () => {
  let t: HttpTransport | undefined;
  let clock = 0;
  const now = () => clock;
  afterEach(() => t?.dispose());
  beforeEach(() => {
    clock = 0;
  });

  it('sends { schemaVersion, meta, entries } without the raw error', async () => {
    const send = jest.fn(ok);
    t = createHttpTransport({ send, meta, flushIntervalMs: 1e9 });
    t.log(entry(0));
    await t.flush();
    expect(send.mock.calls[0][0]).toEqual({ schemaVersion: 1, meta, entries: [wire(0)] });
    expect(JSON.stringify(send.mock.calls[0][0])).not.toContain('must never be sent');
    expect(t.size()).toBe(0);
  });

  it('uses a custom serializer for the backend contract', async () => {
    const send = jest.fn(ok);
    t = createHttpTransport({
      send, meta, flushIntervalMs: 1e9,
      serialize: (entries, m) => ({ logs: entries.map((e) => ({ ...e, ...m })) }),
    });
    t.log(entry(0));
    await t.flush();
    expect((send.mock.calls[0][0] as { logs: { appVersion: string }[] }).logs[0].appVersion).toBe('1.4.0');
  });

  it('retries 5xx with backoff and honours retryAfterMs', async () => {
    const send = jest
      .fn()
      .mockImplementationOnce(() => Promise.resolve({ status: 503 }))
      .mockImplementationOnce(() => Promise.resolve({ status: 429, retryAfterMs: 30_000 }))
      .mockImplementation(ok);
    t = createHttpTransport({ send, meta, flushIntervalMs: 1e9, now, random: () => 1, backoffBaseMs: 2000 });
    t.log(entry(0));

    await t.tick(); // 503 -> wait 2 s
    expect(t.size()).toBe(1);
    clock = 1000;
    await t.tick(); // still backing off: no request
    expect(send).toHaveBeenCalledTimes(1);

    clock = 2000;
    await t.tick(); // 429 with Retry-After 30 s
    expect(send).toHaveBeenCalledTimes(2);
    clock = 20_000;
    await t.tick();
    expect(send).toHaveBeenCalledTimes(2);

    clock = 32_000;
    await t.tick(); // delivered
    expect(send).toHaveBeenCalledTimes(3);
    expect(t.size()).toBe(0);
  });

  it('drops a batch refused with another 4xx', async () => {
    t = createHttpTransport({ send: jest.fn(() => Promise.resolve({ status: 400 })), meta, flushIntervalMs: 1e9 });
    t.log(entry(0));
    await t.flush();
    expect(t.size()).toBe(0);
  });

  it('treats a throwing sender like a network error', async () => {
    t = createHttpTransport({ send: jest.fn(() => Promise.reject(new Error('boom'))), meta, flushIntervalMs: 1e9 });
    t.log(entry(0));
    await t.flush();
    expect(t.size()).toBe(1);
  });

  it('keeps entries offline, bounds the queue, and drains in batches when back online', async () => {
    let online = false;
    const send = jest.fn(() => Promise.resolve<SendResult>({ status: online ? 202 : 'NETWORK_ERROR' }));
    t = createHttpTransport({ send, meta, flushIntervalMs: 1e9, maxBatch: 5, maxQueue: 12, now });
    for (let i = 0; i < 30; i++) t.log(entry(i));
    await t.flush();
    expect(t.size()).toBe(12);

    online = true;
    await t.flush(); // a manual flush ignores backoff
    expect(t.size()).toBe(0);
  });

  it('persists unsent entries and restores them on the next start', async () => {
    let saved: WireEntry[] = [];
    const storage: QueueStorage = { load: async () => saved, save: async (e) => { saved = e; } };
    t = createHttpTransport({ send: jest.fn(() => Promise.resolve({ status: 'NETWORK_ERROR' as const })), meta, flushIntervalMs: 1e9, storage });
    t.log(entry(0));
    await t.flush();
    await t.persist();
    t.dispose();
    expect(saved).toEqual([wire(0)]);

    t = createHttpTransport({ send: jest.fn(ok), meta, flushIntervalMs: 1e9, storage });
    await Promise.resolve(); // let restore finish
    await Promise.resolve();
    expect(t.size()).toBe(1);
    await t.flush();
    expect(saved).toEqual([]); // cleared after delivery
  });
});

describe('createFetchSender', () => {
  const respond = (status: number, headers: Record<string, string> = {}) =>
    Promise.resolve({ status, headers: { get: (k: string) => headers[k] ?? null } } as unknown as Response);

  it('POSTs JSON with auth headers and reports the status', async () => {
    const fetchImpl = jest.fn(() => respond(202));
    const send = createFetchSender('https://api/logs', async () => ({ Authorization: 'Bearer t' }), fetchImpl);
    expect(await send({ a: 1 })).toEqual({ status: 202, retryAfterMs: undefined });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api/logs');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer t' });
  });

  it('reads Retry-After and maps fetch failures to NETWORK_ERROR', async () => {
    expect(await createFetchSender('u', undefined, jest.fn(() => respond(429, { 'Retry-After': '30' })))({})).toEqual({
      status: 429,
      retryAfterMs: 30_000,
    });
    expect(await createFetchSender('u', undefined, jest.fn(() => Promise.reject(new TypeError('offline'))))({})).toEqual({
      status: 'NETWORK_ERROR',
    });
  });
});
