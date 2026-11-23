/**
 * Local POC config. In your real app these come from your per-environment config.
 *
 *  - iOS simulator: localhost works as-is.
 *  - Android emulator: run `adb reverse tcp:4040 tcp:4040` and `adb reverse tcp:8080 tcp:8080`.
 *  - Physical device: replace localhost with your computer's LAN IP.
 */
const FAKE_API = 'http://localhost:4040'; // dev-server/server.mjs: fake loan API for the Playground
const BACKEND = 'http://localhost:8080'; // your Spring Boot backend (the demo app in ../backend)

export const config = {
  apiBaseUrl: `${FAKE_API}/api`,
  appVersion: '0.1.0',
  environment: 'local',
  telemetry: {
    // In your real app: your normal API base URL + this path
    url: `${BACKEND}/telemetry/v1/batch`,
    // true = send to the backend even in debug builds (for local testing)
    sendInDev: true,
  },
};
