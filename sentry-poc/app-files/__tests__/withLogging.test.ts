import * as common from '@poc/common';
import { withLogging } from '@poc/api';

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
  const fn = jest.fn();
  times.forEach((t) => fn.mockReturnValueOnce(t));
  return fn;
};

describe('withLogging', () => {
  let error: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    error = jest.spyOn(common.logger, 'error').mockImplementation(() => {});
    warn = jest.spyOn(common.logger, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('logs a 5xx as error and returns the result unchanged', async () => {
    const result = { error: { status: 503, data: { accountNumber: '12345678901' } } };
    const out = await withLogging(jest.fn().mockResolvedValue(result))('/loans', makeApi(), {});
    expect(out).toBe(result);
    expect(error).toHaveBeenCalledWith(
      'api.request.failed',
      expect.objectContaining({ endpoint: 'getLoans', status: 503, errorCode: 'SERVER_ERROR' }),
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain('12345678901');
  });

  it('logs offline as warn, not error', async () => {
    await withLogging(jest.fn().mockResolvedValue({ error: { status: 'FETCH_ERROR' } }))('/x', makeApi(), {});
    expect(warn).toHaveBeenCalledWith('api.request.failed', expect.objectContaining({ errorCode: 'NETWORK_ERROR' }));
    expect(error).not.toHaveBeenCalled();
  });

  it('warns on slow success and stays silent on fast success', async () => {
    const slow = withLogging(jest.fn().mockResolvedValue({ data: 1 }), { now: clock(0, 2500) });
    await slow('/x', makeApi(), {});
    expect(warn).toHaveBeenCalledWith('api.request.slow', expect.objectContaining({ durationMs: 2500 }));

    warn.mockClear();
    const fast = withLogging(jest.fn().mockResolvedValue({ data: 1 }), { now: clock(0, 100) });
    await fast('/x', makeApi(), {});
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('ignores aborted requests', async () => {
    const controller = new AbortController();
    controller.abort();
    await withLogging(jest.fn().mockResolvedValue({ error: { status: 500 } }))(
      '/x',
      makeApi({ signal: controller.signal }),
      {},
    );
    expect(error).not.toHaveBeenCalled();
  });

  it('logs the error name and rethrows unexpected throws', async () => {
    const baseQuery = jest.fn().mockRejectedValue(new TypeError('secret detail'));
    await expect(withLogging(baseQuery)('/x', makeApi(), {})).rejects.toThrow(TypeError);
    expect(error).toHaveBeenCalledWith(
      'api.request.failed',
      expect.objectContaining({ errorCode: 'UNEXPECTED_THROW', errorName: 'TypeError' }),
      expect.any(TypeError), // raw error for the sink; the context itself has no message
    );
    expect(JSON.stringify(error.mock.calls[0][1])).not.toContain('secret detail');
  });
});
