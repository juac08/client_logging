import { createHttpSink, type HttpSink, type LogEntry } from '@poc/common';

const app = { version: '0.1.0', platform: 'ios', osVersion: '18.2', environment: 'local', sessionId: 'k3j9x2m1qa' };

const entry = (i = 0): LogEntry => ({
  level: 'error',
  event: 'api.request.failed',
  context: { endpoint: 'getServerError', status: 503, durationMs: i },
  timestamp: 1_764_000_000_000 + i,
});

const respond = (status: number) => Promise.resolve({ status } as Response);

describe('createHttpSink', () => {
  let sink: HttpSink | undefined;
  afterEach(() => sink?.dispose());

  it('sends a batch with the app block and only the wire fields', async () => {
    const fetchImpl = jest.fn(() => respond(202));
    sink = createHttpSink({ url: 'http://x/telemetry/v1/batch', app, fetchImpl, intervalMs: 1e9 });
    sink.write({ ...entry(1), extra: 'must not be sent' } as LogEntry);
    await sink.flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://x/telemetry/v1/batch');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ schemaVersion: 1, app, entries: [entry(1)] });
    expect(sink.queueSize()).toBe(0);
  });

  it('keeps the batch and retries on 5xx and 429', async () => {
    const fetchImpl = jest.fn().mockImplementationOnce(() => respond(503)).mockImplementationOnce(() => respond(429)).mockImplementation(() => respond(202));
    sink = createHttpSink({ url: 'u', app, fetchImpl, intervalMs: 1e9 });
    sink.write(entry());
    await sink.flush();
    expect(sink.queueSize()).toBe(1);
    await sink.flush();
    expect(sink.queueSize()).toBe(1);
    await sink.flush();
    expect(sink.queueSize()).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('drops a batch the server refused with 400/413', async () => {
    const fetchImpl = jest.fn(() => respond(413));
    sink = createHttpSink({ url: 'u', app, fetchImpl, intervalMs: 1e9 });
    sink.write(entry());
    await sink.flush();
    expect(sink.queueSize()).toBe(0);
  });

  it('keeps the batch when offline', async () => {
    const fetchImpl = jest.fn(() => Promise.reject(new TypeError('Network request failed')));
    sink = createHttpSink({ url: 'u', app, fetchImpl, intervalMs: 1e9 });
    sink.write(entry());
    await sink.flush();
    expect(sink.queueSize()).toBe(1);
  });

  it('sends full batches in a row and bounds the queue', async () => {
    const fetchImpl = jest.fn(() => Promise.reject(new TypeError('offline')));
    sink = createHttpSink({ url: 'u', app, fetchImpl, intervalMs: 1e9, maxBatch: 5, maxQueue: 12 });
    for (let i = 0; i < 30; i++) sink.write(entry(i));
    await sink.flush();
    expect(sink.queueSize()).toBe(12); // oldest dropped

    fetchImpl.mockImplementation(() => respond(202));
    await sink.flush();
    expect(sink.queueSize()).toBe(0);
  });

  it('adds headers from getHeaders (e.g. your access token)', async () => {
    const fetchImpl = jest.fn(() => respond(202));
    sink = createHttpSink({ url: 'u', app, fetchImpl, intervalMs: 1e9, getHeaders: async () => ({ Authorization: 'Bearer t' }) });
    sink.write(entry());
    await sink.flush();
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer t' });
  });
});
