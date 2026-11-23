import { configureLogger, resetLoggerForTests, type LogEntry } from '@your-org/common';
import { withLogging } from '../withLogging';

const makeApi = (overrides: Record<string, unknown> = {}) =>
  ({
    endpoint: 'getLoans',
    type: 'query',
    signal: new AbortController().signal,
    abort: jest.fn(),
    dispatch: jest.fn(),
    getState: jest.fn(),
    extra: undefined,
    ...overrides,
  }) as any;

const clock = (...times: number[]) => {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)];
};

let entries: LogEntry[];
beforeEach(() => {
  resetLoggerForTests();
  entries = [];
  configureLogger({ transports: [{ name: 'memory', log: (e) => entries.push(e) }] });
});

describe('withLogging', () => {
  it('logs a 5xx as error with endpoint and operation; result unchanged; no payload', async () => {
    const result = { error: { status: 503, data: { accountNumber: '12345678901' } } };
    const out = await withLogging(jest.fn().mockResolvedValue(result), { now: clock(0, 42) })('/loans', makeApi(), {});
    expect(out).toBe(result);
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('error');
    expect(entries[0].context).toEqual({
      endpoint: 'getLoans', operation: 'query', status: 503, errorCode: 'SERVER_ERROR', durationMs: 42,
    });
    expect(JSON.stringify(entries)).not.toContain('12345678901');
  });

  it('logs offline and 4xx as warn', async () => {
    await withLogging(jest.fn().mockResolvedValue({ error: { status: 'FETCH_ERROR' } }))('/x', makeApi(), {});
    await withLogging(jest.fn().mockResolvedValue({ error: { status: 422 } }))('/x', makeApi(), {});
    expect(entries.map((e) => [e.level, e.context.errorCode])).toEqual([
      ['warn', 'NETWORK_ERROR'],
      ['warn', 'CLIENT_ERROR'],
    ]);
  });

  it('warns on slow success; silent on fast success', async () => {
    await withLogging(jest.fn().mockResolvedValue({ data: 1 }), { now: clock(0, 2500) })('/x', makeApi(), {});
    await withLogging(jest.fn().mockResolvedValue({ data: 1 }), { now: clock(0, 100) })('/x', makeApi(), {});
    expect(entries.map((e) => e.event)).toEqual(['api.request.slow']);
  });

  it('ignores aborted requests', async () => {
    const controller = new AbortController();
    controller.abort();
    await withLogging(jest.fn().mockResolvedValue({ error: { status: 500 } }))('/x', makeApi({ signal: controller.signal }), {});
    expect(entries).toHaveLength(0);
  });

  it('logs the error name and rethrows unexpected throws', async () => {
    const baseQuery = jest.fn().mockRejectedValue(new TypeError('secret 12345678901'));
    await expect(withLogging(baseQuery)('/x', makeApi(), {})).rejects.toThrow('secret');
    expect(entries[0].context.errorCode).toBe('UNEXPECTED_THROW');
    expect(entries[0].context.errorName).toBe('TypeError');
    expect(JSON.stringify(entries.map((e) => e.context))).not.toContain('12345678901');
  });
});
