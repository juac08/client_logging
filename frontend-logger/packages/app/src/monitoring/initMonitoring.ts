/**
 * Wires the logger to its transports. Call once, first thing in index.js.
 * This is the only file that decides WHERE logs go.
 */
import { AppState, Platform } from 'react-native';
import {
  configureLogger,
  createConsoleTransport,
  createHttpTransport,
  flushLogs,
  logger,
  setLoggingEnabled,
  type HttpTransport,
  type Transport,
} from '@your-org/common';
import { loggingConfig } from './config';
import { createLogSender } from './logSender';
import { installGlobalErrorHandlers } from './globalErrorHandlers';

let http: HttpTransport | undefined;
let started = false;

export function initMonitoring(): void {
  if (started) return;
  started = true;

  try {
    const { profile, environment } = loggingConfig; // dev / st / pt / pr: see profiles.ts
    const transports: Transport[] = [];
    if (__DEV__) transports.push(createConsoleTransport());

    if (profile.sendToBackend) {
      http = createHttpTransport({
        send: createLogSender(), // fetch now; the generated RTK endpoint later (logSender.ts)
        meta: {
          appVersion: loggingConfig.appVersion,
          buildNumber: String(loggingConfig.buildNumber),
          environment,
          platform: Platform.OS,
          osVersion: String(Platform.Version),
          sessionId: newSessionId(), // per launch; not a user or device ID
        },
        // storage: mmkvQueueStorage,  // optional: keep unsent logs across restarts (see README)
        flushIntervalMs: profile.flushIntervalMs,
      });
      transports.push(http);
    }

    configureLogger({
      transports,
      minLevel: profile.minLevel,
      sampleRates: profile.sampleRates,
      maxPerEventPerMinute: profile.maxPerEventPerMinute,
      devWarnings: __DEV__,
    });

    let current = AppState.currentState;
    AppState.addEventListener('change', (next) => {
      if (current === 'active' && next.match(/inactive|background/)) {
        logger.info('app.backgrounded');
        void flushLogs();
        void http?.persist();
      } else if (current.match(/inactive|background/) && next === 'active') {
        logger.info('app.foregrounded');
      }
      current = next;
    });

    if (!__DEV__) installGlobalErrorHandlers(() => void flushLogs());
    logger.info('app.started');
  } catch {
    // Monitoring must never block startup
  }
}

/** Call when remote config / feature flags load: a kill switch without a release. */
export function applyRemoteLoggingFlag(enabled: boolean): void {
  setLoggingEnabled(enabled);
}

function newSessionId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
