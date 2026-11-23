import { CONTEXT_KEYS, type ContextValue, type LogContext } from './context';

const ALLOWED = new Set<string>(CONTEXT_KEYS);
const SAFE_TEXT = /^[A-Za-z0-9_.-]{1,64}$/; // identifiers only: no spaces, no @, no free text
const LONG_DIGITS = /\d{6,}/; // account numbers, card numbers, national ID numbers

export type SanitizeResult = { context: LogContext; dropped: string[] };

/**
 * Rebuilds the context from scratch, keeping only allowed keys with safe values.
 * TypeScript types disappear at runtime (and `as any` bypasses them), so this is the
 * real guard. `dropped` lists removed KEYS (never values), for dev warnings.
 */
export function sanitizeContext(input: unknown): SanitizeResult {
  const context: Record<string, ContextValue> = {};
  const dropped: string[] = [];
  if (input === null || typeof input !== 'object') return { context, dropped };

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value === undefined) continue;
    if (!ALLOWED.has(key)) {
      dropped.push(key);
      continue;
    }
    const safe = safeValue(value);
    if (safe === undefined) dropped.push(key);
    else context[key] = safe;
  }
  return { context: context as LogContext, dropped };
}

function safeValue(value: unknown): ContextValue | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : undefined;
  if (typeof value === 'string' && SAFE_TEXT.test(value) && !LONG_DIGITS.test(value)) return value;
  return undefined;
}

/** The error's type name only ('TypeError'). Messages can contain customer data. */
export function errorNameOf(error: unknown): string | undefined {
  if (error instanceof Error && SAFE_TEXT.test(error.name)) return error.name;
  return undefined;
}
