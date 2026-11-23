import { logger, resetLoggerForTests, sanitize, setLogSink, type LogEntry } from '@poc/common';

beforeEach(resetLoggerForTests);

describe('sanitize', () => {
  it('keeps allowed identifier fields', () => {
    expect(sanitize({ feature: 'lending', endpoint: 'getLoans', status: 503, durationMs: 12.6 })).toEqual({
      feature: 'lending',
      endpoint: 'getLoans',
      status: 503,
      durationMs: 13,
    });
  });

  it('drops unknown keys, free text and long digit runs', () => {
    const dirty = {
      feature: 'lending',
      errorCode: 'Card 4111 1111 1111 1111 declined',
      endpoint: 'loan12345678901',
      accountNumber: '12345678901',
    } as Record<string, unknown>;
    expect(sanitize(dirty as never)).toEqual({ feature: 'lending' });
  });

  it('drops non-finite numbers', () => {
    expect(sanitize({ durationMs: Number.NaN })).toEqual({});
  });
});

describe('logger', () => {
  it('buffers events until a sink exists, then delivers them in order', () => {
    logger.info('app.started');
    logger.warn('api.request.slow', { endpoint: 'getLoans', durationMs: 2500 });
    const received: LogEntry[] = [];
    setLogSink((e) => received.push(e));
    expect(received.map((e) => e.event)).toEqual(['app.started', 'api.request.slow']);
  });

  it('keeps only the newest 50 buffered events', () => {
    for (let i = 0; i < 60; i++) logger.info('app.started', { durationMs: i });
    const received: LogEntry[] = [];
    setLogSink((e) => received.push(e));
    expect(received).toHaveLength(50);
    expect(received[0].context.durationMs).toBe(10);
  });

  it('never throws when the sink throws', () => {
    setLogSink(() => {
      throw new Error('boom');
    });
    expect(() => logger.error('ui.render.failed')).not.toThrow();
  });
});
