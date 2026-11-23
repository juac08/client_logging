/**
 * The only file that knows about Application Insights
 * (in your monorepo: packages/app/src/monitoring/initMonitoring.ts).
 */
import { ApplicationInsights } from '@microsoft/applicationinsights-web';
import { AppState, Platform } from 'react-native';
import { logger, setLogSink, type LogEntry } from '@poc/common';
import { config } from '../config';

const SEVERITY = { info: 1, warn: 2, error: 3 } as const;
const sessionId = Math.random().toString(36).slice(2, 12); // per launch, not a user ID
let started = false;

export function initMonitoring(): void {
  if (started) return;
  started = true;

  const { connectionString, sendInDev } = config.telemetry;

  if (__DEV__ && !sendInDev) {
    setLogSink((e) => console.log(`[telemetry:${e.level}] ${e.event}`, e.context));
    return;
  }
  if (!connectionString) return;

  try {
    const appInsights = new ApplicationInsights({
      config: {
        connectionString,
        disableAjaxTracking: true, // we log API calls ourselves, safely
        disableFetchTracking: true,
        disableExceptionTracking: true, // would upload raw messages and stacks
        disableCookiesUsage: true, // no cookies in React Native
        isStorageUseDisabled: true, // no localStorage/sessionStorage in React Native
        isBeaconApiDisabled: true, // no sendBeacon in React Native
        maxBatchInterval: __DEV__ ? 2000 : 15000, // quick feedback while testing locally
      },
    });
    appInsights.loadAppInsights();

    const common = {
      source: 'react-native',
      appVersion: config.appVersion,
      environment: config.environment,
      platform: Platform.OS,
      osVersion: String(Platform.Version),
      sessionId,
    };

    setLogSink(({ level, event, context }: LogEntry) => {
      if (__DEV__) console.log(`[telemetry:${level}] ${event}`, context);

      const properties: Record<string, string> = { ...common, event };
      for (const [key, value] of Object.entries(context)) {
        if (value !== undefined) properties[key] = String(value);
      }
      appInsights.trackTrace({ message: event, severityLevel: SEVERITY[level], properties });
    });

    // Send the batch before the OS can kill the app
    AppState.addEventListener('change', (state) => {
      if (state !== 'active') appInsights.flush();
    });

    installGlobalHandlers(() => appInsights.flush());
    logger.info('app.started');
  } catch {
    // Monitoring must never block startup
  }
}

function installGlobalHandlers(flush: () => void): void {
  const g = globalThis as any;
  const nameOf = (e: unknown) => (e instanceof Error ? e.name : undefined);

  // 1. Unhandled JS errors. We call the previous handler, so React Native's
  //    default behaviour (and the red LogBox screen in debug) still happens.
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
  //    Note: in debug builds this replaces React Native's own tracker, so LogBox
  //    no longer warns about unhandled rejections while sendInDev is true.
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
