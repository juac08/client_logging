/**
 * Monitoring via YOUR backend (in your monorepo: packages/app/src/monitoring/initMonitoring.ts).
 *
 * Compared with the Azure POC, only this file and config.ts change: no vendor SDK,
 * no connection string. Events go to POST /telemetry/v1/batch on your Spring Boot
 * backend, which validates them again and writes them to your existing logs.
 */
import { AppState, Platform } from 'react-native';
import { createHttpSink, logger, setLogSink } from '@poc/common';
import { config } from '../config';

const sessionId = Math.random().toString(36).slice(2, 12); // per launch, not a user ID
let started = false;

export function initMonitoring(): void {
  if (started) return;
  started = true;

  const { url, sendInDev } = config.telemetry;

  if (__DEV__ && !sendInDev) {
    setLogSink((e) => console.log(`[telemetry:${e.level}] ${e.event}`, e.context));
    return;
  }
  if (!url) return;

  try {
    const sink = createHttpSink({
      url,
      app: {
        version: config.appVersion,
        platform: Platform.OS,
        osVersion: String(Platform.Version),
        environment: config.environment,
        sessionId,
      },
      // In your real app: return your existing auth header, e.g.
      // getHeaders: async () => ({ Authorization: `Bearer ${await tokenStore.getAccessToken()}` }),
      intervalMs: __DEV__ ? 2000 : 15000, // quick feedback while testing locally
      onResult: __DEV__ ? (r) => console.log('[telemetry] batch', r) : undefined,
    });

    setLogSink((entry) => {
      if (__DEV__) console.log(`[telemetry:${entry.level}] ${entry.event}`, entry.context);
      sink.write(entry);
    });

    // Send the queue before the OS can kill the app
    AppState.addEventListener('change', (state) => {
      if (state !== 'active') void sink.flush();
    });

    installGlobalHandlers(() => void sink.flush());
    logger.info('app.started');
  } catch {
    // Monitoring must never block startup
  }
}

function installGlobalHandlers(flush: () => void): void {
  const g = globalThis as any;
  const nameOf = (e: unknown) => (e instanceof Error ? e.name : undefined);

  // 1. Unhandled JS errors (the previous handler keeps React Native's default behaviour)
  const previous = g.ErrorUtils?.getGlobalHandler?.();
  g.ErrorUtils?.setGlobalHandler?.((error: unknown, isFatal?: boolean) => {
    logger.error('app.js.error', {
      errorCode: isFatal ? 'JS_FATAL' : 'JS_NON_FATAL',
      errorName: nameOf(error),
    });
    flush();
    previous?.(error, isFatal);
  });

  // 2. Unhandled promise rejections (Hermes).
  //    In debug builds this replaces React Native's own tracker while sendInDev is true.
  g.HermesInternal?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (_id: number, rejection: unknown) =>
      logger.error('app.js.error', {
        errorCode: 'UNHANDLED_REJECTION',
        errorName: nameOf(rejection),
      }),
    onHandled: () => {},
  });
}
