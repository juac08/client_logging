# React Native Client Logging: Sentry POC

The same POC as the Azure version (same logger, RTK Query wrapper, error boundary
and Playground screen), but events go to **Sentry**. You run the app on the
simulator and see the results as Issues in your own sentry.io project.

**Only the monitoring layer changes.** Compared with the Azure POC, the differences
are `src/app/monitoring/initMonitoring.ts`, a new `src/app/monitoring/scrub.ts`, the
Sentry section in `src/app/config.ts`, and `Sentry.wrap(App)` in `App.tsx`. That's the
point of the sink design.

## What Sentry adds over the Azure POC

| | Azure POC | Sentry POC |
|---|---|---|
| Stack traces (file, function, line) | No, the error name only | **Yes**, with the message redacted |
| Native crashes (Objective-C, Swift, Kotlin, Java) | No | **Yes**: the "Native crash" button |
| Grouping into issues, counts, first/last seen | Write KQL queries | Built in |
| Breadcrumbs (what happened before the error) | No | Yes: our sanitized events only |
| Crash-free sessions per release | No | Yes (Releases page) |
| Custom queries and dashboards | Strong (KQL) | Basic |
| Backend correlation with Spring Boot (Azure) | Natural fit | Possible, but a separate tool |

## Cost: it's free for this

Sign up at sentry.io. The **Developer plan is free forever**: one user and about
5,000 errors a month, far more than this POC needs. You don't need a credit card.
If a new organization starts on a Business trial, it moves to the free plan when the
trial ends.

When you create the organization, choose the **EU data storage location**. That's
a good habit for a Norwegian bank, even in a personal test.

## Setup (about 15 minutes)

```text
workspace/
├── rn-logging-poc-sentry/   ← this folder
└── LoggingPocSentry/        ← created in step 2
```

### 1. Create the Sentry project and copy its DSN

1. On sentry.io, create a project and pick **React Native** as the platform.
2. Copy the **DSN**: Project Settings → Client Keys (DSN). It looks like
   `https://abc123@o123456.ingest.de.sentry.io/4567`.
3. Recommended: in Project Settings → **Security & Privacy**, turn on **Prevent
   Storing of IP Addresses**, and keep the Data Scrubber on (it is on by default).
   This adds server-side protection on top of what the app removes.

### 2. Create a fresh React Native app

```bash
cd workspace
npx @react-native-community/cli@latest init LoggingPocSentry
cd LoggingPocSentry
```

### 3. Install dependencies

```bash
npm install @reduxjs/toolkit react-redux @sentry/react-native
```

`@sentry/react-native` includes native code (that's how it catches native crashes),
so it is linked automatically and needs a pod install on iOS.

### 4. Copy the POC files and install pods

```bash
cp -R ../rn-logging-poc-sentry/app-files/. .
rm -f __tests__/App.test.tsx
cd ios && bundle install && bundle exec pod install && cd ..
```

### 5. Paste your DSN

Open `src/app/config.ts` and set `sentry.dsn` to the value from step 1. Without a DSN,
the app only prints events to the Metro console.

### 6. Start the fake API (keep this terminal open)

```bash
node ../rn-logging-poc-sentry/dev-server/server.mjs
```

The Playground's API buttons call this local server, so you can trigger 503s,
timeouts and so on. Its fake Azure collector part isn't used in this POC.

On Android, also run `adb reverse tcp:4040 tcp:4040`.

### 7. Run on the simulator

```bash
npm run ios        # or: npm run android
```

Tap the buttons, then open **Issues** in Sentry. Events usually appear within
seconds.

## What you should see in Sentry

**How the mapping works:** errors become **Issues**. Warnings and info events
become **breadcrumbs**, which appear in the trail of the next issue. That keeps
expected problems (offline, 4xx) from creating noise.

| Button | In Sentry |
|---|---|
| Load loans: success | nothing |
| Server error 503 | Issue `api.request.failed`, with tags `endpoint=getServerError`, `errorCode=SERVER_ERROR` and `status=503` |
| Timeout 5 s | Issue `api.request.failed` with `errorCode=TIMEOUT` |
| Bad JSON | Issue `api.request.failed` with `errorCode=PARSING_ERROR` |
| Slow, 404, 401, Network error, Submit 422 | No issue: breadcrumbs only (trigger an error afterwards to see them in its trail) |
| Render crash | Issue **TypeError: [redacted]**, with a stack trace pointing at `LendingWidget` and tag `feature=lending` |
| Async error → showBoundary | Issue **SyntaxError: [redacted]** |
| Throw in onPress | Issue **TypeError: [redacted]**, captured automatically by Sentry (red screen in debug) |
| Unhandled promise rejection | Issue **RangeError: [redacted]** |
| Native crash | The app closes. **Open it again**; the native SDK sends the crash on the next launch (for example `EXC_BAD_ACCESS` on iOS) |
| Handled error | Issue `feature.operation.failed`, tag `errorCode=SUBMISSION_FAILED` |
| Warning only | No issue: a `api.request.slow` breadcrumb |
| Privacy test | Issue `feature.operation.failed` with **only** `feature=lending` as a tag |

**Repeated presses are grouped into one issue.** API and feature errors use a
fingerprint of event, endpoint or feature, and error code. Press "Server error"
five times and you'll see one issue with five events, not five issues.

**What to check on each issue:**
- **Message:** the exception value is `[redacted]`. The fake account numbers in the
  Playground's error messages must never appear.
- **Breadcrumbs:** only `telemetry` entries. There should be no console logs, no
  fetch URLs, and no touch events with button text.
- **Tags:** our tags plus Sentry's device, OS and release tags.
- **Stack trace:** readable function names and lines in debug builds.

## Run the unit tests

```bash
npx jest
```

Three test files run: `logger.test.ts`, `withLogging.test.ts` and `scrub.test.ts`.
The scrub tests feed a realistic event full of fake account numbers through the
scrubbing and check that none survive.

## Privacy: what reaches Sentry

| Sent | Not sent |
|---|---|
| Error type (`TypeError`) and stack trace (file, function, line) | Error messages (replaced by `[redacted]`) |
| Our event names and sanitized tags (`endpoint`, `errorCode`, `status`, `feature`) | URLs, request and response bodies, headers |
| Device model, OS version, app release, an anonymous installation ID | User ID, IP address (`sendDefaultPii: false`, plus the project setting), cookies |
| Our own breadcrumbs | Automatic breadcrumbs: console, fetch/XHR, touches, navigation params |
| | Screenshots and view hierarchy (both off) |
| | Local variables in stack frames, React component stack |

**About native crashes:** they are captured and sent by the native iOS and Android
SDKs, so the JavaScript `beforeSend` doesn't run for them. Native crash reports
contain native stack frames and device state, not JS error messages. Review them in
the POC and, if needed, add native-side filtering or rely on the server-side Data
Scrubber.

**Personal comparison only:** set `redactMessages: false` in `src/app/config.ts` to
see what Sentry would receive without redaction. Keep it `true` for anything
work-related.

## Next steps after the POC

- **Readable stacks in release builds:** run `npx @sentry/wizard@latest -i reactNative`.
  It sets up source map and debug symbol upload in the Xcode and Gradle builds. Do
  this after the POC works, because the wizard also edits `App.tsx` and
  `metro.config.js`. Keep our `initMonitoring` and remove the `Sentry.init` it adds.
- **Self-hosted or EU:** for a bank, Security will decide between Sentry's EU region
  under a DPA and self-hosted Sentry.
- **Both tools:** the sink design allows Azure for metrics and backend correlation,
  and Sentry for crashes. Register a sink that calls both.

## Moving the code into your monorepo

| POC file | In your monorepo |
|---|---|
| `src/common/...` | `packages/common/src/...` (the logger now has an optional `error` argument) |
| `src/api/withLogging.ts`, `baseQueryWithLogging.ts` | `packages/api/src/...` |
| `src/api/customBaseQuery.ts`, `src/api/api.ts` | **Don't copy**: keep yours, and change only the `baseQuery` line |
| `src/app/monitoring/initMonitoring.ts`, `scrub.ts` | `packages/app/src/monitoring/...` |
| `src/app/components`, `hooks` | `packages/app/src/...` |
| `src/app/screens/PlaygroundScreen.tsx`, `dev-server/` | POC only |

Replace `@poc/` with your package scope and remove the alias settings in
`metro.config.js`, `tsconfig.json` and `jest.config.js`.

## Troubleshooting

| Symptom | Check |
|---|---|
| Nothing in Sentry | Is `sentry.dsn` set? Set `debug: true` in config and watch the Metro console for Sentry's own logs. Check the issue list's environment filter (it should be `local`). |
| "Native module not found" or a crash at startup | Run `pod install` again (iOS) or rebuild the app. A Metro reload isn't enough after adding a native package. |
| API buttons all show "Network" | The dev server isn't running, or on Android `adb reverse` wasn't run. |
| Stack traces show only bundle positions | Expected in release builds without source maps; see Next steps. |
| Native crash didn't appear | You must reopen the app after the crash; the report is sent on the next launch. |

## Verified vs. not verified

- **Verified:** the logger, the wrapper, the scrubbing and the Sentry sink logic were
  type-checked against Sentry-shaped types. They passed tests with a fake Sentry
  module: init options, which events become issues or breadcrumbs, tags,
  fingerprints, `captureException` vs `captureMessage`, and a realistic event
  scrubbed with no account number surviving.
- **Not verified:** the app hasn't been run on a simulator against a real Sentry
  project. Real SDK typings may differ slightly by version; if TypeScript complains
  about an option, check the SDK's docs for your installed version.
