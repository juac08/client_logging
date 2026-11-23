/**
 * The fields an event may carry. Anything else is removed before it leaves the device.
 *
 * Every value must be a short identifier, a number or a boolean. That is the privacy
 * rule: log WHAT kind of thing happened ('SUBMISSION_FAILED'), never the data
 * involved (an amount, an account number, a name, a message).
 *
 * To add a field, add it here in a reviewed PR.
 */
export const CONTEXT_KEYS = [
  'feature', // 'lending', 'accounts'
  'screen', // route name: 'LoanApplication' (never route params)
  'step', // 'amount', 'income', 'summary'
  'operation', // 'query' | 'mutation', or a named operation: 'submitApplication'
  'endpoint', // RTK Query endpoint name: 'getLoans' (never a URL)
  'status', // HTTP status or RTK status: 503, 'FETCH_ERROR'
  'errorCode', // your own codes: 'SERVER_ERROR', 'SUBMISSION_FAILED'
  'errorName', // 'TypeError' (set automatically when you pass an error)
  'result', // 'success' | 'cancelled' | 'failed'
  'source', // what produced the event: 'boundary', 'global_handler'
  'durationMs',
  'count',
  'retry', // boolean
] as const;

export type ContextKey = (typeof CONTEXT_KEYS)[number];
export type ContextValue = string | number | boolean;
export type LogContext = Partial<Record<ContextKey, ContextValue>>;
