/**
 * Logging settings, derived from your existing per-environment app config.
 * The environment ('dev' | 'st' | 'pt' | 'pr') selects the profile in profiles.ts.
 */
import { config as appConfig } from '../config'; // your existing config
import { getLoggingProfile } from './profiles';

export const loggingConfig = {
  environment: appConfig.environment, // 'dev' | 'st' | 'pt' | 'pr'
  profile: getLoggingProfile(appConfig.environment),
  /** Only used by the fetch sender (Step 1 in logSender.ts). Each environment has its own apiBaseUrl. */
  url: `${appConfig.apiBaseUrl}/client-logs`,
  appVersion: appConfig.appVersion,
  buildNumber: appConfig.buildNumber,
};
