import { keepOwnBreadcrumbs, REDACTED, scrubEvent } from '../src/app/monitoring/scrub';

const makeEvent = () => ({
  message: 'Payment failed for 12345678901',
  exception: {
    values: [
      {
        type: 'TypeError',
        value: 'Cannot read amount of loan 12345678901',
        stacktrace: { frames: [{ function: 'LendingWidget', lineno: 42, vars: { accountNumber: '12345678901' } }] },
      },
    ],
  },
  request: { url: 'https://api.bank.no/loans/12345678901' },
  user: { id: 'customer-1', ip_address: '10.0.0.1' },
  extra: { body: '{"amount":250000}' },
  contexts: { react: { componentStack: '<LoanForm accountNumber="12345678901">' }, os: { name: 'iOS' } },
  breadcrumbs: [
    { category: 'telemetry', message: 'api.request.failed' },
    { category: 'console', message: 'debug 12345678901' },
    { category: 'touch', message: 'Pressed "Pay 250 000 kr"' },
    { category: 'fetch', data: { url: 'https://api.bank.no/loans/12345678901' } },
  ],
});

describe('scrubEvent', () => {
  it('keeps type and stack, removes messages and data', () => {
    const out = scrubEvent(makeEvent());
    const ex = out.exception.values[0];
    expect(ex.type).toBe('TypeError');
    expect(ex.value).toBe(REDACTED);
    expect(ex.stacktrace.frames[0]).toEqual({ function: 'LendingWidget', lineno: 42 });
    expect(out.message).toBe(REDACTED);
    expect(out.request).toBeUndefined();
    expect(out.user).toBeUndefined();
    expect(out.extra).toBeUndefined();
    expect(out.contexts).toEqual({ os: { name: 'iOS' } });
    expect(out.breadcrumbs).toEqual([{ category: 'telemetry', message: 'api.request.failed' }]);
    expect(JSON.stringify(out)).not.toContain('12345678901');
  });

  it('keeps our own event names as messages', () => {
    const out = scrubEvent({ message: 'api.request.failed' });
    expect(out.message).toBe('api.request.failed');
  });

  it('can keep messages when redaction is turned off (personal test only)', () => {
    const out = scrubEvent(makeEvent(), false);
    expect(out.exception.values[0].value).toContain('Cannot read amount');
    expect(out.request).toBeUndefined(); // data removal still applies
  });
});

describe('keepOwnBreadcrumbs', () => {
  it('drops automatic breadcrumbs', () => {
    expect(keepOwnBreadcrumbs({ category: 'telemetry' })).toEqual({ category: 'telemetry' });
    expect(keepOwnBreadcrumbs({ category: 'touch' })).toBeNull();
    expect(keepOwnBreadcrumbs({ category: 'fetch' })).toBeNull();
    expect(keepOwnBreadcrumbs({})).toBeNull();
  });
});
