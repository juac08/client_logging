/**
 * Sends log batches through the backend's GENERATED RTK Query endpoint
 * (e.g. from @rtk-query/codegen-openapi), so your customBaseQuery handles the base
 * URL, auth headers and token refresh exactly as for every other call.
 *
 * Why the endpoint and not the generated hook (useSendLogMutation)?
 * The logger runs outside React (global error handlers, startup, background
 * flush), and hooks only work inside components. `api.endpoints.x.initiate()`
 * is the same request, usable anywhere through `store.dispatch`.
 *
 *   createRtkLogSender(store.dispatch, api.endpoints.sendLog, (body) => ({ clientLogBatch: body as ClientLogBatch }))
 */
import type { LogSender, SendResult } from '@your-org/common';

type MutationEndpoint<Arg> = {
  initiate: (arg: Arg, options?: { track?: boolean }) => unknown;
};

export function createRtkLogSender<Arg>(
  // store.dispatch. Typed loosely so any store type fits.
  dispatch: (action: any) => any,
  endpoint: MutationEndpoint<Arg>,
  /** Map the serialized batch to the generated argument type (often { someBody: body }). */
  toArg: (body: unknown) => Arg,
): LogSender {
  return async (body) => {
    // track: false = the request result isn't stored in Redux state
    const result: { data?: unknown; error?: unknown } = await dispatch(
      endpoint.initiate(toArg(body), { track: false }),
    );
    if (result && 'error' in result && result.error !== undefined) return toSendResult(result.error);
    return { status: 200 };
  };
}

/** Maps an RTK Query error (FetchBaseQueryError shape) to the transport's retry rules. */
export function toSendResult(error: unknown): SendResult {
  const e = error as { status?: unknown; originalStatus?: unknown } | null;
  if (typeof e?.status === 'number') return { status: e.status };
  // e.g. 202 with a non-JSON body: the request itself worked, use the real HTTP status
  if (e?.status === 'PARSING_ERROR' && typeof e.originalStatus === 'number') return { status: e.originalStatus };
  return { status: 'NETWORK_ERROR' }; // FETCH_ERROR, TIMEOUT_ERROR, CUSTOM_ERROR: retry later
}
