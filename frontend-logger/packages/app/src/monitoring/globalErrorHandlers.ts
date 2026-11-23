import { logger } from '@your-org/common';

let installed = false;

/**
 * Catches errors no component or try/catch handled:
 *  1. Unhandled JS errors (ErrorUtils). The previous handler is still called, so React
 *     Native's default behaviour, the red screen in debug and any crash reporter keep working.
 *  2. Unhandled promise rejections (Hermes).
 *
 * Install in release builds; in debug, React Native's LogBox already uses these hooks.
 */
export function installGlobalErrorHandlers(onFatal: () => void): void {
  if (installed) return;
  installed = true;
  const g = globalThis as any;

  const previous = g.ErrorUtils?.getGlobalHandler?.();
  g.ErrorUtils?.setGlobalHandler?.((error: unknown, isFatal?: boolean) => {
    logger.error(
      'app.js.error',
      { source: 'global_handler', errorCode: isFatal ? 'JS_FATAL' : 'JS_NON_FATAL' },
      error,
    );
    if (isFatal) onFatal(); // best effort: send before the app closes
    previous?.(error, isFatal);
  });

  g.HermesInternal?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (_id: number, rejection: unknown) =>
      logger.error('app.js.error', { source: 'promise', errorCode: 'UNHANDLED_REJECTION' }, rejection),
    onHandled: () => {},
  });
}
