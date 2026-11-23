/**
 * Local POC config. In your real app these come from your per-environment config.
 *
 * DEV_SERVER is the local fake API (dev-server/server.mjs):
 *  - iOS simulator: localhost works as-is.
 *  - Android emulator: run `adb reverse tcp:4040 tcp:4040` once, then localhost works.
 */
const DEV_SERVER = 'http://localhost:4040';

export const config = {
  apiBaseUrl: `${DEV_SERVER}/api`,
  environment: 'local' as 'local' | 'staging' | 'production',
  sentry: {
    // Paste your project's DSN: sentry.io → Project Settings → Client Keys (DSN).
    // The DSN is not a secret; it only allows sending events to this project.
    dsn: '',
    // true = error messages are replaced with "[redacted]" before leaving the device
    // (bank-safe default). Set false only in a personal test project if you want to
    // compare what Sentry would otherwise receive.
    redactMessages: true,
    // Prints what the SDK is doing to the Metro console. Handy while setting up.
    debug: false,
  },
};
