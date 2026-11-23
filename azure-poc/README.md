# React Native Client Logging: Runnable POC

A small React Native app you can run on your own machine to try the client-side
logging design end to end. You don't need an Azure account.

It contains:

| Folder | What it is |
|---|---|
| `app-files/` | Files you copy into a fresh React Native app: the logger, the RTK Query wrapper, Azure setup, error boundary, and a **Playground** screen with one button per scenario |
| `dev-server/` | A zero-dependency Node server that acts as **both** a fake backend API and a **fake Azure Application Insights collector** |

## How it works without Azure

The app uses the real Azure SDK (`@microsoft/applicationinsights-web`). The SDK
sends to whatever `IngestionEndpoint` the connection string names. In
`src/app/config.ts` that is your own machine:

```text
InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=http://localhost:4040
```

So the SDK posts its normal payload to `http://localhost:4040/v2/track`. The dev
server receives it, prints each event, flags anything that looks like customer
data, and saves everything to `dev-server/telemetry.jsonl`. When you later switch
to real Azure, you change only the connection string.

```text
Playground button
  → RTK Query → baseQueryWithLogging → logger (sanitize)
  → Azure SDK → POST localhost:4040/v2/track → dev-server terminal
```

## Prerequisites

- Node 20 or newer
- A working React Native environment (Xcode for iOS, Android Studio and an emulator for Android)

## Setup (about 10 minutes)

Put this `rn-logging-poc` folder next to where you'll create the app:

```text
workspace/
├── rn-logging-poc/   ← this folder
└── LoggingPoc/       ← created in step 1
```

### 1. Create a fresh React Native app

```bash
cd workspace
npx @react-native-community/cli@latest init LoggingPoc
```

To match your work app, you can pin the version, for example `--version 0.86.2`.

### 2. Install the three JS dependencies

```bash
cd LoggingPoc
npm install @reduxjs/toolkit react-redux @microsoft/applicationinsights-web
```

All three are pure JavaScript, so there are no new native modules. If the template
set the project up with Yarn, use `yarn add` instead.

### 3. Copy the POC files into the app

```bash
cp -R ../rn-logging-poc/app-files/. .
rm -f __tests__/App.test.tsx   # the template's test isn't needed here
```

This overwrites `App.tsx`, `index.js`, `metro.config.js`, `tsconfig.json` and
`jest.config.js`, and adds `src/` and two test files.

### 4. iOS only: install pods

```bash
cd ios && bundle install && bundle exec pod install && cd ..
```

### 5. Start the dev server (keep this terminal open)

```bash
node ../rn-logging-poc/dev-server/server.mjs
```

### 6. Android only: forward the port

```bash
adb reverse tcp:4040 tcp:4040
```

This makes `localhost:4040` on the emulator reach your computer. You need to run
it again whenever the emulator restarts.

### 7. Run the app

```bash
npm run ios        # or: npm run android
```

Tap the buttons and watch the dev-server terminal.

## What you should see

Events arrive within about 2 seconds in debug builds (`maxBatchInterval` is 2 s in dev).

| Button | Dev-server terminal shows |
|---|---|
| Load loans: success | only `api GET /api/loans` (nothing logged; that's correct) |
| Server error 503 | `ERROR api.request.failed endpoint=getServerError status=503 errorCode=SERVER_ERROR` |
| Slow request 3 s | `WARN api.request.slow endpoint=getSlowLoans durationMs=30xx` |
| Timeout 5 s | `ERROR api.request.failed status=TIMEOUT_ERROR errorCode=TIMEOUT` |
| Bad JSON | `ERROR api.request.failed status=PARSING_ERROR errorCode=PARSING_ERROR` |
| Not found 404 | `WARN api.request.failed status=404 errorCode=CLIENT_ERROR` |
| Session expired 401 | `WARN api.request.failed status=401 errorCode=UNAUTHORIZED` |
| Network error | `WARN api.request.failed status=FETCH_ERROR errorCode=NETWORK_ERROR` |
| Submit loan 422 | `WARN api.request.failed endpoint=submitLoan status=422 errorCode=CLIENT_ERROR` |
| Render crash | fallback screen inside the Lending box, plus `ERROR ui.render.failed feature=lending errorName=TypeError` |
| Async error → showBoundary | fallback, plus `ERROR ui.render.failed errorName=SyntaxError` |
| Clear crash | the Lending box recovers (`resetKeys` changed) |
| Throw in onPress | red LogBox screen in debug, plus `ERROR app.js.error errorName=TypeError` |
| Unhandled promise rejection | `ERROR app.js.error errorCode=UNHANDLED_REJECTION errorName=RangeError` |
| Handled error | `ERROR feature.operation.failed feature=lending errorCode=SUBMISSION_FAILED` |
| Privacy test | `ERROR feature.operation.failed feature=lending` and **nothing else**: the account number and free text were dropped on the device |

You also get one `INFO app.started` event on launch. Every event shows a grey line
with platform, OS version, app version and session.

**The privacy check:** the error messages in the Playground deliberately contain
fake account numbers (for example `Cannot read amount of loan 12345678901`). They
must never appear in the terminal. If anything unexpected arrives, the server prints
a red `⚠ privacy check:` line.

You can also open `http://localhost:4040/telemetry` in a browser to see the raw
envelopes exactly as Azure would receive them.

## Run the unit tests

```bash
npx jest
```

These run `__tests__/logger.test.ts` (the sanitizer, startup buffer, and never
throwing) and `__tests__/withLogging.test.ts` (status classification, slow calls,
aborted requests, rethrowing, and no payload leaks).

## Testing variations

**Debug console only, no SDK:** set `telemetry.sendInDev: false` in
`src/app/config.ts`. Events are then only printed to the Metro console as
`[telemetry:error] ...`.

**Physical device:** replace `localhost` in `src/app/config.ts` with your computer's
LAN IP (for example `http://192.168.1.20:4040`). The phone and computer must be on
the same Wi-Fi. If iOS blocks plain HTTP to that address, add a temporary App
Transport Security exception for local testing only.

**Release-like build:** run `npx react-native run-ios --mode Release` or
`npx react-native run-android --mode release`. In release builds, `__DEV__` is false
and nothing is printed to the console. Android release builds block plain HTTP by
default, so for a local-only test you'd need to allow cleartext traffic temporarily.
Debug builds with `sendInDev: true` already exercise the same SDK path.

## Switching to real Azure later (free)

**Cost:** a personal test costs nothing. Sign up for an Azure free account. It
needs a phone number and a credit or debit card for identity verification, but you
aren't charged (you may see a temporary verification hold). The first 5 GB of log
data per month is free, and this POC sends a few kilobytes. As a safety net, set a
**daily cap** (for example 0.1 GB) on the Log Analytics workspace under
Usage and estimated costs.

1. Create an Application Insights resource in an EU region (for example Norway East
   or West Europe). Make sure **local authentication** is enabled on it, because the
   JavaScript SDK doesn't support Entra ID ingestion.
2. Copy its connection string from the Overview page into
   `telemetry.connectionString` in `src/app/config.ts`.
3. Run the app, wait 2–5 minutes, then in Azure open **Logs** and run:

```kusto
AppTraces
| where TimeGenerated > ago(1h) and Properties.source == "react-native"
| project TimeGenerated, Message, SeverityLevel,
    Endpoint = tostring(Properties.endpoint),
    ErrorCode = tostring(Properties.errorCode),
    Status = tostring(Properties.status),
    AppVersion = tostring(Properties.appVersion)
| order by TimeGenerated desc
```

## Moving the code into your monorepo

The POC imports `@poc/common` and `@poc/api` just as your packages would, through
aliases in `metro.config.js`, `tsconfig.json` and `jest.config.js`.

| POC file | In your monorepo |
|---|---|
| `src/common/logging/logger.ts`, `src/common/index.ts` | `packages/common/src/...` |
| `src/api/withLogging.ts`, `src/api/baseQueryWithLogging.ts` | `packages/api/src/...` |
| `src/api/customBaseQuery.ts` | **Don't copy**: keep your existing one |
| `src/api/api.ts` | **Don't copy**: in your own `createApi` file, change only `baseQuery: baseQueryWithLogging` |
| `src/app/monitoring`, `components`, `hooks` | `packages/app/src/...` |
| `src/app/config.ts` | merge the 3 telemetry values into your existing config |
| `src/app/screens/PlaygroundScreen.tsx`, `dev-server/` | POC only; optionally keep as a dev-only screen |

Then replace `@poc/` with your real package scope. Your Yarn workspaces resolve the
packages, so the alias settings in `metro.config.js`, `tsconfig.json` and
`jest.config.js` are not needed there.

## Troubleshooting

| Symptom | Check |
|---|---|
| Nothing in the dev-server terminal at all | Is the server running? On Android, did you run `adb reverse tcp:4040 tcp:4040`? |
| API lines appear, but no telemetry events | Look for `[telemetry:...]` lines in the Metro console. If they're there, the logger works and the SDK isn't sending: check `connectionString` and `sendInDev: true`, and look for SDK errors in Metro. |
| A yellow `unknown request:` line | The SDK posted to an unexpected path. The collector accepts any path ending in `/track`; send me the path shown. |
| Every API failure is `UNKNOWN_ERROR` | Your real `customBaseQuery` returns errors without a `status` field: adjust `classify()` in `withLogging.ts`. |
| Can't resolve `@poc/common` | Restart Metro with `npx react-native start --reset-cache` after copying the config files. |
| "Throw in onPress" closes the app | Expected in release builds: React Native treats an uncaught error in a handler as fatal. Use debug builds for that button. |

## Verified vs. not verified

- **Verified:** the dev server was run and tested: every API route returns the
  expected status, and the collector parses JSON arrays, NDJSON and gzip payloads,
  stores the events, answers like Azure, and flags privacy problems. The logger and
  `withLogging` logic was type-checked and passed 9 tests in Node.
- **Not verified:** the app has not been run on a simulator or device yet, and the
  Azure SDK's behaviour inside React Native has not been tested against this server.
  That is exactly what this POC is for. If something doesn't work on the first run,
  the Troubleshooting table covers the likely causes.
