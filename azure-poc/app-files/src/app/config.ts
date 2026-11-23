/**
 * Local POC config. In your real app these come from your per-environment config.
 *
 * DEV_SERVER is the local dev server (fake API + fake Azure collector):
 *  - iOS simulator: localhost works as-is.
 *  - Android emulator: run `adb reverse tcp:4040 tcp:4040` once, then localhost works.
 *  - Physical device: replace localhost with your computer's LAN IP, e.g. http://192.168.1.20:4040
 */
const DEV_SERVER = 'http://localhost:4040';

export const config = {
  apiBaseUrl: `${DEV_SERVER}/api`,
  appVersion: '0.1.0',
  environment: 'local' as 'local' | 'staging' | 'production',
  telemetry: {
    // Points the REAL Azure SDK at the local collector. The all-zero key is a dummy.
    // For real Azure, paste the connection string from the portal instead.
    connectionString: `InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=${DEV_SERVER}`,
    // true = send through the Azure SDK even in debug builds (for local testing).
    // false = debug builds only print events to the Metro console.
    sendInDev: true,
  },
};
