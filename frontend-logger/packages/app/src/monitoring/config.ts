/**
 * Logging settings. Merge into your existing per-environment config.
 * The endpoint path is a placeholder until the backend team confirms it.
 */
import { config as appConfig } from '../config'; // your existing config

export const loggingConfig = {
  /** Full URL of the backend's log endpoint. Empty = only console logging. */
  url: appConfig.apiBaseUrl ? `${appConfig.apiBaseUrl}/client-logs` : '',
  appVersion: appConfig.appVersion,
  buildNumber: appConfig.buildNumber,
  environment: appConfig.environment,
  /** Send to the backend from debug builds too (to test the endpoint locally). */
  sendInDev: false,
};
