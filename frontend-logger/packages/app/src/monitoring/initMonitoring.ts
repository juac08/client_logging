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
import { tokenStore } from '../auth/tokenStore'; // your existing token source
import { loggingConfig } from './config';
import { installGlobalErrorHandlers } from './globalErrorHandlers';

let http: HttpTransport | undefined;
let started = false;

export function initMonitoring(): void {
  if (started) return;
  started = true;

  try {
    const transports: Transport[] = [];
    if (__DEV__) transports.push(createConsoleTransport());

    if (loggingConfig.url && (!__DEV__ || loggingConfig.sendInDev)) {
      http = createHttpTransport({
        url: loggingConfig.url,
        meta: {
          appVersion: loggingConfig.appVersion,
          buildNumber: String(loggingConfig.buildNumber),
          environment: loggingConfig.environment,
          platform: Platform.OS,
          osVersion: String(Platform.Version),
          sessionId: newSessionId(), // per launch; not a user or device ID
        },
        getHeaders: async (): Promise<Record<string, string>> => {
          const token = await tokenStore.getAccessToken().catch(() => undefined);
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
        // storage: mmkvQueueStorage,  // optional: keep unsent logs across restarts (see README)
        flushIntervalMs: __DEV__ ? 3_000 : 15_000,
      });
      transports.push(http);
    }

    configureLogger({
      transports,
      minLevel: __DEV__ ? 'debug' : 'info',
      devWarnings: __DEV__,
      sampleRates: { 'screen.viewed': 1 }, // lower this if screen views get too chatty
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
