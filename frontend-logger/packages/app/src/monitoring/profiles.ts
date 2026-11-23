/**
 * Logging behaviour per environment. Pure data: no imports from the app, easy to test.
 *
 *   dev: local development: console only, everything visible, dropped-field warnings.
 *   st:  system test: send to the backend with full detail (debug), quick delivery,
 *        so testers' bug reports have the whole trail.
 *   pt:  production test / pre-production: IDENTICAL to pr on purpose, so volume,
 *        sampling and level behave exactly as they will in production.
 *   pr:  production: info and above, chatty events sampled.
 */
import type { LogEvent, LogLevel } from '@your-org/common';

export type AppEnvironment = 'dev' | 'st' | 'pt' | 'pr';

export type LoggingProfile = {
  /** Send to the backend log endpoint. */
  sendToBackend: boolean;
  minLevel: LogLevel;
  sampleRates: Partial<Record<LogEvent, number>>;
  flushIntervalMs: number;
  maxPerEventPerMinute: number;
};

const production: LoggingProfile = {
  sendToBackend: true,
  minLevel: 'info',
  sampleRates: { 'screen.viewed': 0.25 }, // tune once you see real volume
  flushIntervalMs: 15_000,
  maxPerEventPerMinute: 30,
};

export const LOGGING_PROFILES: Record<AppEnvironment, LoggingProfile> = {
  dev: {
    sendToBackend: false, // set true temporarily to test the endpoint from a debug build
    minLevel: 'debug',
    sampleRates: {},
    flushIntervalMs: 3_000,
    maxPerEventPerMinute: 100,
  },
  st: {
    sendToBackend: true,
    minLevel: 'debug',
    sampleRates: {},
    flushIntervalMs: 5_000,
    maxPerEventPerMinute: 60,
  },
  pt: production,
  pr: production,
};

export function getLoggingProfile(environment: string): LoggingProfile {
  // An unknown or missing environment gets production rules: the safe default
  return LOGGING_PROFILES[environment as AppEnvironment] ?? production;
}
