/**
 * The catalog of everything the app is allowed to log.
 *
 * To log something new, add ONE line here (in a reviewed PR). A typo in an event
 * name then fails to compile, dashboards stay consistent, and the full list of what
 * leaves the device sits in one file that Security can review.
 *
 * Naming: <area>.<subject>.<past-tense verb>, lowercase, for example
 * 'loan.application.submitted'. Describe WHAT happened, never WHO or which data.
 */
export const LOG_EVENTS = [
  // App lifecycle
  'app.started',
  'app.backgrounded',
  'app.foregrounded',

  // Navigation
  'screen.viewed',

  // API (written by the RTK Query wrapper)
  'api.request.failed',
  'api.request.slow',

  // Errors
  'ui.render.failed', // error boundary
  'app.js.error', // global handlers: unhandled errors and promise rejections
  'feature.operation.failed', // generic handled failure

  // Logger itself
  'log.throttled', // an event was logged too often and was dropped for a while

  // Lending (examples: add your own feature events below)
  'loan.application.started',
  'loan.application.step.completed',
  'loan.application.submitted',
  'loan.application.failed',
] as const;

export type LogEvent = (typeof LOG_EVENTS)[number];
