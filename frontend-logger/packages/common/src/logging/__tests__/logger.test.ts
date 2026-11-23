import {
  configureLogger,
  logger,
  resetLoggerForTests,
  sanitizeContext,
  setLoggingEnabled,
  type LogEntry,
  type Transport,
} from '..';

function memoryTransport() {
  const entries: LogEntry[] = [];
  const transport: Transport = { name: 'memory', log: (e) => entries.push(e) };
  return { entries, transport };
}

beforeEach(() => resetLoggerForTests());

describe('sanitizeContext', () => {
  it('keeps allowed identifiers, numbers and booleans', () => {
    expect(sanitizeContext({ feature: 'lending', status: 503, durationMs: 12.6, retry: true })).toEqual({
      context: { feature: 'lending', status: 503, durationMs: 13, retry: true },
      dropped: [],
    });
  });

  it('drops unknown keys, free text, long digit runs and objects, reporting keys only', () => {
    const result = sanitizeContext({
      feature: 'lending',
      accountNumber: '12345678901',
      errorCode: 'Card 4111 1111 declined',
      endpoint: 'loan12345678901',
      step: { nested: true },
    });
    expect(result.context).toEqual({ feature: 'lending' });
    expect(result.dropped).toEqual(['accountNumber', 'errorCode', 'endpoint', 'step']);
    expect(JSON.stringify(result)).not.toContain('12345678901');
  });
});

describe('logger', () => {
  it('delivers sanitized entries with level, timestamp and sequence', () => {
    const { entries, transport } = memoryTransport();
    configureLogger({ transports: [transport], now: () => 1000 });
    logger.info('loan.application.started', { feature: 'lending', step: 'amount' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      level: 'info',
      event: 'loan.application.started',
      context: { feature: 'lending', step: 'amount' },
      timestamp: 1000,
      seq: 1,
      error: undefined,
    });
  });

  it('child loggers add their context; call-site values win', () => {
    const { entries, transport } = memoryTransport();
    configureLogger({ transports: [transport] });
    const log = logger.child({ feature: 'lending', screen: 'LoanApplication' }).child({ step: 'income' });
    log.info('loan.application.step.completed', { step: 'summary' });
    expect(entries[0].context).toEqual({ feature: 'lending', screen: 'LoanApplication', step: 'summary' });
  });

  it('extracts only the error name when an error is passed', () => {
    const { entries, transport } = memoryTransport();
    configureLogger({ transports: [transport] });
    logger.error('loan.application.failed', { errorCode: 'SUBMISSION_FAILED' }, new TypeError('loan 12345678901'));
    expect(entries[0].context).toEqual({ errorCode: 'SUBMISSION_FAILED', errorName: 'TypeError' });
    expect(JSON.stringify(entries[0].context)).not.toContain('12345678901');
  });

  it('filters below minLevel', () => {
    const { entries, transport } = memoryTransport();
    configureLogger({ transports: [transport], minLevel: 'info' });
    logger.debug('app.started');
    logger.info('app.started');
    expect(entries).toHaveLength(1);
  });

  it('buffers before configuration and drops buffered debug if minLevel is higher', () => {
    logger.debug('app.started');
    logger.info('app.started');
    logger.error('app.js.error');
    const { entries, transport } = memoryTransport();
    configureLogger({ transports: [transport], minLevel: 'info' });
    expect(entries.map((e) => e.level)).toEqual(['info', 'error']);
  });

  it('samples chatty events but never errors', () => {
    const { entries, transport } = memoryTransport();
    configureLogger({
      transports: [transport],
      sampleRates: { 'screen.viewed': 0, 'api.request.failed': 0 },
      random: () => 0.5,
    });
    logger.info('screen.viewed', { screen: 'Home' });
    logger.error('api.request.failed');
    expect(entries.map((e) => e.event)).toEqual(['api.request.failed']);
  });

  it('throttles an event storm and reports it in the next window', () => {
    let t = 0;
    const { entries, transport } = memoryTransport();
    configureLogger({ transports: [transport], maxPerEventPerMinute: 3, now: () => t });
    for (let i = 0; i < 10; i++) logger.error('ui.render.failed');
    expect(entries).toHaveLength(3);

    t = 61_000;
    logger.error('ui.render.failed');
    const throttled = entries.find((e) => e.event === 'log.throttled');
    expect(throttled?.context).toEqual({ source: 'ui.render.failed', count: 7 });
  });

  it('kill switch stops everything', () => {
    const { entries, transport } = memoryTransport();
    configureLogger({ transports: [transport] });
    setLoggingEnabled(false);
    logger.error('app.js.error');
    expect(entries).toHaveLength(0);
  });

  it('never throws, even when a transport throws; other transports still receive', () => {
    const { entries, transport } = memoryTransport();
    const broken: Transport = { name: 'broken', log: () => { throw new Error('boom'); } };
    configureLogger({ transports: [broken, transport] });
    expect(() => logger.error('app.js.error')).not.toThrow();
    expect(entries).toHaveLength(1);
  });

  it('warns developers about dropped fields (keys only)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    configureLogger({ transports: [], devWarnings: true });
    logger.info('app.started', { amount: 250000 } as never);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('amount');
    expect(String(warn.mock.calls[0][0])).not.toContain('250000');
    warn.mockRestore();
  });
});
