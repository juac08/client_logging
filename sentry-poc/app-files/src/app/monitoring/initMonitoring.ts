/**
 * The only file that knows about Sentry
 * (in your monorepo: packages/app/src/monitoring/initMonitoring.ts).
 *
 * Compared with the Azure POC, ONLY this file (plus config and App.tsx's
 * Sentry.wrap) is different. The logger, the RTK Query wrapper, the error
 * boundary and every call site stay exactly the same.
 */
import * as Sentry from '@sentry/react-native';
import { logger, setLogSink, type LogEntry, type LogLevel } from '@poc/common';
import { config } from '../config';
import { keepOwnBreadcrumbs, scrubEvent, TELEMETRY_CATEGORY } from './scrub';

const SENTRY_LEVEL: Record<LogLevel, Sentry.SeverityLevel> = {
  info: 'info',
  warn: 'warning',
  error: 'error',
};

let started = false;

export function initMonitoring(): void {
  if (started) return;
  started = true;

  const { dsn, redactMessages, debug } = config.sentry;

  if (!dsn) {
    // No DSN yet: behave like the Azure POC's dev mode and print to the console
    setLogSink((e) => console.log(`[telemetry:${e.level}] ${e.event}`, e.context));
    console.warn('[telemetry] No Sentry DSN in src/app/config.ts; events are only printed.');
    return;
  }

  try {
    Sentry.init({
      dsn,
      environment: config.environment,
      debug,

      // Privacy
      sendDefaultPii: false, // no IP address, cookies or user data
      attachScreenshot: false, // screenshots would show customer data
      attachViewHierarchy: false, // the view tree contains on-screen text
      beforeSend: (event) => scrubEvent(event, redactMessages),
      beforeBreadcrumb: (breadcrumb) => keepOwnBreadcrumbs(breadcrumb),

      // Keep the POC to errors only (no performance tracing)
      tracesSampleRate: 0,
    });

    // Note: no installGlobalHandlers() here. Sentry installs its own handlers for
    // unhandled JS errors and promise rejections, with full stack traces, and they
    // also pass through beforeSend. Installing ours too would report them twice.

    setLogSink(sendToSentry);
    logger.info('app.started');
  } catch {
    // Monitoring must never block startup
  }
}

function sendToSentry({ level, event, context, error }: LogEntry): void {
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined) data[key] = String(value);
  }

  // Every event becomes a breadcrumb: the trail you see leading up to an issue
  Sentry.addBreadcrumb({ category: TELEMETRY_CATEGORY, level: SENTRY_LEVEL[level], message: event, data });

  // Only errors become Sentry issues; warn/info stay breadcrumbs (less noise)
  if (level !== 'error') return;

  Sentry.withScope((scope) => {
    scope.setLevel('error');
    scope.setTag('event', event);
    scope.setTags(data); // searchable in Sentry: endpoint, errorCode, feature, status
    // One issue per event + endpoint/feature + errorCode, instead of one per message
    scope.setFingerprint([event, context.endpoint ?? context.feature ?? 'none', context.errorCode ?? 'none']);

    if (error instanceof Error) {
      Sentry.captureException(error); // stack trace; message redacted in beforeSend
    } else {
      Sentry.captureMessage(event); // e.g. an API 503: there is no JS stack to send
    }
  });
}
