import { createRtkLogSender, toSendResult } from '../createRtkLogSender';

/** A stand-in for a generated mutation endpoint and store.dispatch. */
function fakeEndpoint(result: { data?: unknown; error?: unknown }) {
  const initiate = jest.fn((arg: unknown, options?: { track?: boolean }) => ({ type: 'thunk', arg, options }));
  const dispatch = jest.fn(() => Promise.resolve(result));
  return { endpoint: { initiate }, dispatch, initiate };
}

describe('createRtkLogSender', () => {
  it('dispatches the generated endpoint with the mapped argument, untracked', async () => {
    const { endpoint, dispatch, initiate } = fakeEndpoint({ data: null });
    const send = createRtkLogSender(dispatch, endpoint, (body) => ({ clientLogBatch: body }));
    expect(await send({ entries: [] })).toEqual({ status: 200 });
    expect(initiate.mock.calls[0]).toEqual([{ clientLogBatch: { entries: [] } }, { track: false }]);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('maps RTK errors to the transport retry rules', async () => {
    const { endpoint, dispatch } = fakeEndpoint({ error: { status: 503, data: {} } });
    expect(await createRtkLogSender(dispatch, endpoint, (b) => b)({})).toEqual({ status: 503 });
  });
});

describe('toSendResult', () => {
  it('uses numeric status, originalStatus for parsing errors, NETWORK_ERROR otherwise', () => {
    expect(toSendResult({ status: 400 })).toEqual({ status: 400 });
    expect(toSendResult({ status: 'PARSING_ERROR', originalStatus: 202 })).toEqual({ status: 202 });
    expect(toSendResult({ status: 'FETCH_ERROR' })).toEqual({ status: 'NETWORK_ERROR' });
    expect(toSendResult({ status: 'TIMEOUT_ERROR' })).toEqual({ status: 'NETWORK_ERROR' });
  });
});
