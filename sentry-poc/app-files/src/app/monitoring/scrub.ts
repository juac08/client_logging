/**
 * Privacy scrubbing for everything the Sentry JS SDK sends.
 * Pure functions (no Sentry import), so they are easy to unit test.
 *
 * Rule: Sentry may receive the error TYPE and STACK TRACE (file, function, line),
 * which is what makes it useful. It must never receive error MESSAGES, request data,
 * user data, local variables or any breadcrumb we did not create ourselves.
 */

export const REDACTED = '[redacted]';
export const TELEMETRY_CATEGORY = 'telemetry'; // breadcrumbs created by our logger sink

type FrameLike = { vars?: unknown };
type ExceptionLike = { value?: string; stacktrace?: { frames?: FrameLike[] } };
type BreadcrumbLike = { category?: string };

export type ScrubbableEvent = {
  message?: string;
  exception?: { values?: ExceptionLike[] };
  breadcrumbs?: BreadcrumbLike[];
  request?: unknown;
  user?: unknown;
  extra?: unknown;
  contexts?: Record<string, unknown>;
};

/** Messages we create ourselves are event names, which are safe to keep. */
const OUR_EVENT_NAME = /^[a-z]+(\.[a-z_]+)+$/;

export function scrubEvent<T extends ScrubbableEvent>(event: T, redactMessages = true): T {
  if (redactMessages) {
    // 1. Error messages can contain customer data ("... loan 12345678901")
    event.exception?.values?.forEach((ex) => {
      if (ex.value) ex.value = REDACTED;
    });
    if (event.message && !OUR_EVENT_NAME.test(event.message)) event.message = REDACTED;
  }

  // 2. Local variable values captured in stack frames
  event.exception?.values?.forEach((ex) => ex.stacktrace?.frames?.forEach((f) => delete f.vars));

  // 3. Request, user and free-form extra data
  delete event.request;
  delete event.user;
  delete event.extra;

  // 4. React component stack (component props can contain data)
  if (event.contexts?.react) delete event.contexts.react;

  // 5. Only our own sanitized breadcrumbs survive
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.filter((b) => b.category === TELEMETRY_CATEGORY);
  }

  return event;
}

/**
 * Sentry records breadcrumbs automatically (console logs, fetch/XHR URLs, touches
 * with button labels, navigation with params). Keep only the ones our sink adds.
 */
export function keepOwnBreadcrumbs<T extends BreadcrumbLike>(breadcrumb: T): T | null {
  return breadcrumb.category === TELEMETRY_CATEGORY ? breadcrumb : null;
}
