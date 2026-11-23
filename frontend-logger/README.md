# Frontend Logger: Production Implementation

An app-wide logger for the React Native app. You can call it from anywhere
(`logger.info(...)`, `logger.error(...)`), and it sends events to a backend endpoint
that the backend team provides. It needs no third-party library. It uses `fetch` today and can switch to the
backend's **generated RTK Query endpoint** with one change when that arrives.

The folders mirror your monorepo: `packages/common`, `packages/api` and `packages/app`.

## Usage

```ts
import { logger } from '@your-org/common';

logger.info('loan.application.started', { feature: 'lending', step: 'amount' });
logger.warn('api.request.slow', { endpoint: 'getLoans', durationMs: 3100 });
logger.error('loan.application.failed', { feature: 'lending', errorCode: 'SUBMISSION_FAILED' }, error);
logger.debug('screen.viewed', { screen: 'LoanApplication' }); // dev builds only
```

**Feature-scoped logger:** every event gets the bound context.

```ts
const log = logger.child({ feature: 'lending' });
log.info('loan.application.submitted', { result: 'success', durationMs: 840 });
```

**In components:** a logger that stays the same across renders.

```tsx
const log = useLogger({ feature: 'lending', screen: 'LoanApplication' });
log.info('loan.application.step.completed', { step: 'income' });
```

**With an error:** pass it as the third argument. Only its type name (`TypeError`)
is kept, never the message or the stack.

```ts
try {
  await submitLoan(values).unwrap();
} catch (e) {
  log.error('loan.application.failed', { errorCode: 'SUBMISSION_FAILED' }, e);
}
```

## Design

```text
any code ── logger.info / warn / error / debug(event, context, error?)
              │
              ▼
        Logger core (packages/common)
         • level filter (debug off in production)
         • sampling for chatty events (errors never sampled)
         • storm throttling (30 per event per minute, then a log.throttled summary)
         • sanitizer: allowed keys and safe values only
         • startup buffer (before configureLogger)
         • kill switch
              │
      ┌───────┴──────────┐
      ▼                  ▼
 Console transport   HTTP transport (packages/common)
 (dev only)           • send(): fetch now; the generated RTK endpoint later
                      • batches of 20, every 15 s, or on flush
                      • retry with exponential backoff + jitter, Retry-After on 429
                      • drops batches the server refuses (4xx)
                      • bounded queue (500), optional persistence across restarts
                      • serialize(): the ONLY place that knows the backend's format
```

**Design decisions:**

| Decision | Why |
|---|---|
| A fixed **event catalog** (`events.ts`) | Typos fail to compile, dashboards stay consistent, and one file shows everything that leaves the device |
| A fixed list of **context fields** (`context.ts`) with identifier, number or boolean values only | The privacy rule is enforced in code: log *what kind* of thing happened, never the data. Unknown fields are dropped at runtime, even through `as any`. |
| Transports behind an interface | Where logs go is decided in one file (`initMonitoring.ts`). Adding Sentry or a second endpoint later doesn't touch any call site. |
| `serialize()` in the HTTP transport | The backend contract isn't final yet. When it is, you change one function. |
| A pluggable `send()` | Today plain `fetch`; later the generated endpoint, which goes through your `customBaseQuery` (auth, token refresh) |
| The log endpoint is excluded from API logging | Otherwise a failing log request logs a failure, which is sent and fails again, in a loop |
| Never throws, never blocks | Logging must not break a loan application |
| Throttling | A render loop or retry storm can't flood the backend or the battery |
| The raw `error` is never sent | Error messages and stacks can contain customer data. Only `error.name` is kept. |

## Files

```text
packages/common/src/logging/
├── events.ts                  # catalog of allowed event names: add new events here
├── context.ts                 # allowed context fields: add new fields here
├── types.ts                   # Logger, LogEntry, Transport, LogLevel
├── sanitize.ts                # runtime privacy filter + errorNameOf
├── logger.ts                  # core: levels, child loggers, buffer, sampling, throttling, kill switch
├── transports/
│   ├── consoleTransport.ts    # Metro console (dev)
│   └── httpTransport.ts       # batching + retry; createFetchSender
├── index.ts
└── __tests__/                 # logger.test.ts, httpTransport.test.ts

packages/api/src/
├── withLogging.ts             # wraps your customBaseQuery
├── baseQueryWithLogging.ts    # ignores the log endpoint itself (LOG_ENDPOINT_NAME)
├── createRtkLogSender.ts      # sends batches through the generated RTK endpoint
└── __tests__/                 # withLogging.test.ts, createRtkLogSender.test.ts

packages/app/src/monitoring/
├── profiles.ts                # logging behaviour per environment: dev / st / pt / pr
├── config.ts                  # picks the profile; endpoint URL (fetch only) and app info
├── logSender.ts               # HOW batches are sent: fetch now, generated endpoint later
├── initMonitoring.ts          # wires transports, AppState, global handlers, kill switch
├── globalErrorHandlers.ts     # unhandled JS errors + promise rejections
├── AppErrorBoundary.tsx       # render crashes (class component: React requires it)
├── hooks.ts                   # useLogger, useShowBoundary
├── screenTracking.ts          # screen.viewed from React Navigation (route name only)
└── index.ts
```

## Integration, step by step

### 1. Copy the files

Copy the three folders into your packages, then replace `@your-org/common` with your
real package name. In `packages/common/src/index.ts`, add:

```ts
export * from './logging';
```

### 2. Wrap your base query (`packages/api`)

```ts
// packages/api/src/api.ts: your createApi
baseQuery: baseQueryWithLogging, // was: customBaseQuery
```

This logs failed calls (5xx and timeouts as `error`; offline and 4xx as `warn`) and
calls slower than 2 seconds. Your base query, its token refresh and retries stay as
they are. If your `customBaseQuery` returns errors without a `status` field, pass
your own `classify` function to `withLogging`.

### 3. Configure (`packages/app/src/monitoring/config.ts` and `logSender.ts`)

Connect `config.ts` to your existing app config. Until the generated API exists,
`logSender.ts` sends with `fetch` to `url`. Replace `tokenStore.getAccessToken()`
there with your real token source.

### 4. Start it first (`packages/app/index.js`)

```js
import { initMonitoring } from './src/monitoring';
initMonitoring();
AppRegistry.registerComponent(appName, () => App);
```

### 5. Error boundaries (`App.tsx` and critical flows)

```tsx
<AppErrorBoundary feature="app">                 {/* outermost, outside all providers */}
  <Providers><Navigation /></Providers>
</AppErrorBoundary>

<AppErrorBoundary feature="lending" resetKeys={[route.key]}>
  <LoanApplicationScreen />
</AppErrorBoundary>
```

For errors in event handlers or async code that should show the fallback screen:

```ts
const showBoundary = useShowBoundary();
// inside catch: showBoundary(e);
```

### 6. Screen views (optional)

```tsx
const navigationRef = useNavigationContainerRef();
const onStateChange = useScreenTracking(navigationRef);

<NavigationContainer ref={navigationRef} onReady={onStateChange} onStateChange={onStateChange}>
```

### 7. Kill switch (when remote config loads)

```ts
applyRemoteLoggingFlag(remoteConfig.clientLoggingEnabled);
```

### 8. Keep logs across app restarts (optional)

Without storage, logs that haven't been sent are lost when the app is killed.
To keep them, pass a `storage` adapter in `initMonitoring.ts`, using a storage
library your app probably already has:

```ts
// MMKV
const mmkvQueueStorage: QueueStorage = {
  load: async () => JSON.parse(storage.getString('client-logs') ?? '[]'),
  save: async (entries) => storage.set('client-logs', JSON.stringify(entries)),
};

// AsyncStorage
const asyncQueueStorage: QueueStorage = {
  load: async () => JSON.parse((await AsyncStorage.getItem('client-logs')) ?? '[]'),
  save: (entries) => AsyncStorage.setItem('client-logs', JSON.stringify(entries)),
};
```

## Environments: dev, st, pt, pr

Each environment gets a profile in `packages/app/src/monitoring/profiles.ts`. The
app's existing `config.environment` value picks it; the endpoint comes from each
environment's own `apiBaseUrl`.

| | dev | st (system test) | pt (production test) | pr (production) |
|---|---|---|---|---|
| Sends to backend | No (console only) | Yes | Yes | Yes |
| Lowest level | `debug` | `debug` | `info` | `info` |
| Sampling | none | none | as pr | `screen.viewed` 25% |
| Send interval | 3 s | 5 s | 15 s | 15 s |
| Throttle (per event per minute) | 100 | 60 | 30 | 30 |
| Console output | Yes | No | No | No |
| Dropped-field warnings | Yes | No | No | No |
| Global error handlers | No (LogBox handles them) | Yes | Yes | Yes |

**Why it's set up this way:**
- **st** sends full detail, including `debug`, so testers' bug reports come with the
  whole trail.
- **pt is identical to pr on purpose.** A test checks this, so production behaviour,
  volume and sampling can be validated before release.
- **An unknown or misspelled environment gets production rules.** That's the safe
  default.
- **To test the endpoint from a debug build,** set `dev.sendToBackend: true`
  temporarily.
- Console output, dropped-field warnings and the choice of global handlers follow
  `__DEV__` (debug vs release build), not the environment name.

`meta.environment` in every batch is the environment name, so the backend can keep
st and pt logs apart from pr.

## When the backend's generated API arrives

When the codegen script adds the log endpoint (for example `sendLog`, with a
`useSendLogMutation` hook), make these switches:

**1. Change one function in `packages/app/src/monitoring/logSender.ts`:**

```ts
import { api, createRtkLogSender, type ClientLogBatch } from '@your-org/api';
import { store } from '../store';

export function createLogSender(): LogSender {
  return createRtkLogSender(store.dispatch, api.endpoints.sendLog, (body) => ({
    clientLogBatch: body as ClientLogBatch, // the argument shape your codegen generated
  }));
}
```

Then delete the fetch sender and `url` in `config.ts`. Batching, retry, backoff and
privacy filtering all stay as they are.

**2. Check the endpoint name.** `LOG_ENDPOINT_NAME` in
`packages/api/src/baseQueryWithLogging.ts` must match the generated endpoint, so its
own failures are never logged.

**3. Adjust `serialize()`, if needed,** so the body matches the generated
`ClientLogBatch` type. If the generated types are exported, type it as
`(entries, meta): ClientLogBatch => ...` and TypeScript will check the mapping.

**Why the endpoint and not the hook?** Hooks only work inside React components. The
logger also runs outside React: in global error handlers, at startup and when
flushing as the app goes to the background. `api.endpoints.sendLog.initiate()`
through `store.dispatch` makes the same request from anywhere. **Don't call
`useSendLogMutation` from components to log**: that would skip batching, retries,
throttling and the privacy filter. Components keep using `logger.info(...)`.

**Two things to check in your `customBaseQuery` once logs go through it:**
- If a 401 refresh fails, make sure your reauth logic doesn't **log the user out**
  because of a background log request. For example, skip reauth for
  `LOG_ENDPOINT_NAME`, or treat it as best effort.
- Decide whether the endpoint is called before login, without a token. Agree this
  with the backend team.

## Adding events and fields

**A new event:** add one line to `events.ts`, then use it. Follow the naming pattern
`<area>.<subject>.<past-tense verb>`, for example `loan.offer.accepted`.

**A new context field:** add it to `context.ts`. If a value is dropped in a debug
build, the console says which **field** was dropped and why (never its value):

```text
[logger] "loan.application.failed": dropped field(s) amount. See context.ts for allowed fields.
```

### Rules for the team

| Do | Don't |
|---|---|
| `{ feature: 'lending', step: 'income' }` | `{ amount: 250000 }`, `{ accountNumber }`, `{ name }` |
| `errorCode: 'SUBMISSION_FAILED'` | `error.message`, `String(error)`, `JSON.stringify(error)` |
| Pass the error as the 3rd argument | Copy the stack or `componentStack` into the context |
| `screen: route.name` | Route params |
| `warn` for expected problems (offline, validation) | `error` for everything (alerts become noise) |

The sanitizer catches mistakes, but the rule is still to never pass customer data.

## What to agree with the backend team

The transport sends this by default. If the backend wants a different shape, change
`serialize()` in `createHttpTransport`; nothing else changes. With the generated
endpoint, your base query adds the auth header.

```json
POST <endpoint>   Authorization: Bearer <token>   Content-Type: application/json
{
  "schemaVersion": 1,
  "meta": { "appVersion": "1.4.0", "buildNumber": "120", "environment": "production",
            "platform": "ios", "osVersion": "18.2", "sessionId": "m3x9k2abc123" },
  "entries": [
    { "seq": 2, "level": "error", "event": "loan.application.failed", "timestamp": 1764000000000,
      "context": { "feature": "lending", "errorCode": "SUBMISSION_FAILED", "errorName": "TypeError" } }
  ]
}
```

| Question for the backend | What the app expects |
|---|---|
| Endpoint URL | Set in `monitoring/config.ts` |
| Success response | Any 2xx |
| "Your batch is invalid" | Any 4xx except 408 and 429: the app drops the batch and doesn't retry |
| "Try later" | 408, 429 (with `Retry-After` if possible) or 5xx: the app retries with backoff |
| Max batch size | The app sends at most 20 entries per request (`maxBatch`) |
| Auth before login | Decide whether the endpoint accepts requests without a token. Login problems are worth logging. |
| Duplicates | Rare (for example, a retry after a lost response). `sessionId` + `seq` identify each entry uniquely. |
| Allowed values | Share `events.ts` and `context.ts` with them if they validate on their side |

## Tests

```bash
yarn jest packages/common/src/logging packages/api/src packages/app/src/monitoring
```

There are 34 tests:

- **Sanitizer:** what is kept and dropped, including fake account numbers.
- **Logger:** levels, child loggers, startup buffer, sampling, throttling, kill
  switch, a broken transport, and dev warnings.
- **HTTP transport:** payload shape, the raw error never sent, custom serializer,
  backoff, Retry-After, drop on 4xx, a throwing sender, offline queue and bound,
  and persistence.
- **Fetch sender:** method, body, auth headers, Retry-After, and network failure.
- **RTK sender:** dispatches the generated endpoint untracked, and maps RTK errors
  to the retry rules.
- **API wrapper:** classification, slow calls, the ignored log endpoint (no loop),
  aborted requests, rethrowing, and no payload leaks.
- **Environment profiles:** pt equals pr, production never logs `debug`, dev stays
  local, st sends full detail, and an unknown environment falls back to production.

### Release-build checks before rollout

- [ ] A forced 5xx produces one `api.request.failed` error; airplane mode produces a `warn`, and it's delivered after reconnecting.
- [ ] A render crash shows the fallback and logs `ui.render.failed`.
- [ ] Backgrounding the app right after an event still delivers it.
- [ ] A proxy (Proxyman or Charles) shows only allowed fields: no URLs, messages, amounts or IDs.
- [ ] The kill switch stops all requests.

## Verified vs. not verified

- **Verified:**
  - The code type-checks in strict mode, with `noUnusedLocals`, against RTK Query
    and React Native type stand-ins (the real packages couldn't be installed in my
    environment).
  - All 34 tests above were run, unchanged, with a Jest-compatible runner, and all
    passed.
  - An end-to-end run (logger → HTTP transport → real local HTTP server) delivered
    one batch with the auth header and merged child context, filtered out the debug
    call, and removed a planted account number and loan amount.
- **Not verified:**
  - `AppErrorBoundary.tsx` wasn't type-checked, because React's JSX types weren't
    available.
  - `createRtkLogSender` was tested against a fake endpoint, not real
    codegen output: check the generated argument shape when it arrives.
  - Nothing was run inside a React Native app or against the real backend endpoint.
    Run the tests in your repo and the release-build checks above.
