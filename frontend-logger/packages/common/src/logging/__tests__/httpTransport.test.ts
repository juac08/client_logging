import { createHttpTransport, type HttpTransport, type LogEntry, type QueueStorage, type WireEntry } from '..';

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

const respond = (status: number, headers: Record<string, string> = {}) =>
  Promise.resolve({ status, headers: { get: (k: string) => headers[k] ?? null } } as unknown as Response);

describe('createHttpTransport', () => {
  let t: HttpTransport | undefined;
  let clock = 0;
  const now = () => clock;
  afterEach(() => t?.dispose());
  beforeEach(() => {
    clock = 0;
  });

  it('sends { schemaVersion, meta, entries } without the raw error', async () => {
    const fetchImpl = jest.fn(() => respond(202));
    t = createHttpTransport({ url: 'https://api/logs', meta, fetchImpl, flushIntervalMs: 1e9 });
    t.log(entry(0));
    await t.flush();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api/logs');
    expect(JSON.parse(init.body as string)).toEqual({ schemaVersion: 1, meta, entries: [wire(0)] });
    expect(String(init.body)).not.toContain('must never be sent');
    expect(t.size()).toBe(0);
  });

  it('uses a custom serializer for the backend contract', async () => {
    const fetchImpl = jest.fn(() => respond(200));
    t = createHttpTransport({
      url: 'u', meta, fetchImpl, flushIntervalMs: 1e9,
      serialize: (entries, m) => ({ logs: entries.map((e) => ({ ...e, ...m })) }),
    });
    t.log(entry(0));
    await t.flush();
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.logs[0].appVersion).toBe('1.4.0');
  });

  it('retries 5xx with backoff and honours Retry-After on 429', async () => {
    const fetchImpl = jest
      .fn()
      .mockImplementationOnce(() => respond(503))
      .mockImplementationOnce(() => respond(429, { 'Retry-After': '30' }))
      .mockImplementation(() => respond(202));
    t = createHttpTransport({ url: 'u', meta, fetchImpl, flushIntervalMs: 1e9, now, random: () => 1, backoffBaseMs: 2000 });
    t.log(entry(0));

    await t.tick(); // 503 -> wait 2 s
    expect(t.size()).toBe(1);
    clock = 1000;
    await t.tick(); // still backing off: no request
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    clock = 2000;
    await t.tick(); // 429 with Retry-After: 30 s
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    clock = 20_000;
    await t.tick();
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    clock = 32_000;
    await t.tick(); // delivered
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(t.size()).toBe(0);
  });

  it('drops a batch refused with another 4xx', async () => {
    t = createHttpTransport({ url: 'u', meta, fetchImpl: jest.fn(() => respond(400)), flushIntervalMs: 1e9 });
    t.log(entry(0));
    await t.flush();
    expect(t.size()).toBe(0);
  });

  it('keeps entries offline, bounds the queue, and drains in batches when back online', async () => {
    let online = false;
    const fetchImpl = jest.fn(() => (online ? respond(202) : Promise.reject(new TypeError('offline'))));
    t = createHttpTransport({ url: 'u', meta, fetchImpl, flushIntervalMs: 1e9, maxBatch: 5, maxQueue: 12, now });
    for (let i = 0; i < 30; i++) t.log(entry(i));
    await t.flush();
    expect(t.size()).toBe(12);

    online = true;
    await t.flush(); // a manual flush ignores backoff
    expect(t.size()).toBe(0);
  });

  it('adds headers from getHeaders', async () => {
    const fetchImpl = jest.fn(() => respond(202));
    t = createHttpTransport({ url: 'u', meta, fetchImpl, flushIntervalMs: 1e9, getHeaders: async () => ({ Authorization: 'Bearer t' }) });
    t.log(entry(0));
    await t.flush();
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer t' });
  });

  it('persists unsent entries and restores them on the next start', async () => {
    let saved: WireEntry[] = [];
    const storage: QueueStorage = { load: async () => saved, save: async (e) => { saved = e; } };
    const offline = jest.fn(() => Promise.reject(new TypeError('offline')));
    t = createHttpTransport({ url: 'u', meta, fetchImpl: offline, flushIntervalMs: 1e9, storage });
    t.log(entry(0));
    await t.flush();
    await t.persist();
    t.dispose();
    expect(saved).toEqual([wire(0)]);

    const fetchImpl = jest.fn(() => respond(202));
    t = createHttpTransport({ url: 'u', meta, fetchImpl, flushIntervalMs: 1e9, storage });
    await Promise.resolve(); // let restore finish
    await Promise.resolve();
    expect(t.size()).toBe(1);
    await t.flush();
    expect(saved).toEqual([]); // cleared after delivery
  });
});
