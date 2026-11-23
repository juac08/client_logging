# Client Logging via Your Own Backend (Spring Boot relay)

The app sends its log events to **your existing Spring Boot backend**. The backend
validates them again and writes them to **the logs you already have**, through the
same pipeline as your backend logs (for example the Application Insights Java agent).

```text
Mobile app                                   Your Spring Boot backend
──────────                                   ────────────────────────
logger.error(...)                            POST /telemetry/v1/batch
  → sanitize (layer 1)                         → size limit, rate limit
  → HTTP sink: batch, retry, bounded queue ──►  → validate every field (layer 2)
                                               → SLF4J log line with client.* MDC fields
                                                 → your existing log pipeline
                                                   (App Insights Java agent / OTel / ELK)
```

## Why this is the bank-friendly option

- **No third-party SDK or connection string in the app.** The phone only talks to your own API, as it already does.
- **Two privacy layers.** The app sanitizes events, and the server enforces its own allowlist. The server never trusts the client: anyone can call an endpoint.
- **Authentication, rate limiting and data residency are under your control.**
- **Client and backend logs in one place.** Each client event also carries the request's existing MDC, such as your backend's trace ID.
- **No new infrastructure:** one controller package in a service you already run.

## What's in this folder

| Folder | What it is |
|---|---|
| `backend/` | A small Spring Boot app containing the **`com.yourorg.telemetry` package**. That package is what you copy into your real backend. It has JUnit tests. |
| `mobile/` | Files to copy into a fresh React Native app: the logger, the RTK Query wrapper, error boundary and Playground, plus the new **HTTP sink**. There's no vendor SDK. |
| `dev-server/` | The fake loan API that the Playground's buttons call. Its fake Azure collector isn't used here. |

### The backend package

| File | Responsibility |
|---|---|
| `TelemetryController` | `POST /telemetry/v1/batch`: checks the batch, applies rate limits, validates each entry and logs it. Returns accepted and rejected counts. |
| `TelemetryValidator` | **Server-side allowlist** (plain Java): known events, levels and error codes only, safe identifiers, timestamps in range, no unknown fields |
| `TelemetryRateLimiter` | Per-session and per-IP limits (in memory; see "Several instances" below) |
| `TelemetryRequestSizeFilter` | Rejects bodies over 32 KB (413), or of unknown length (411), before JSON parsing |
| `ClientEventLogger` | One SLF4J line per event on logger `client-telemetry`, with `client.*` fields in the MDC |
| `TelemetryProperties`, `TelemetryConfig` | Configuration (including a kill switch) and Spring wiring |
| `TelemetryModels` | Wire format records |

### Response contract (the app's sink relies on this)

| Status | Meaning | App's sink |
|---|---|---|
| 202 | Accepted. The body says how many entries were kept and dropped: `{"accepted":1,"rejected":0}` | done |
| 400 | Invalid batch (schema, app block, too many entries, bad JSON) | drops it |
| 411 / 413 | Body length unknown or too large | drops it |
| 429 | Rate limited (`Retry-After: 60`) | keeps it, retries later |
| 5xx / no network | Backend or network problem | keeps it, retries later (the queue is bounded at 200) |

## Run it locally

### 1. Start the backend

You need Java 21 and Maven:

```bash
cd backend
mvn spring-boot:run
```

Or open `backend/` in IntelliJ and run `TelemetryDemoApplication`. If your backend
uses Gradle, the package needs only `spring-boot-starter-web`.

Run the tests:

```bash
mvn test
```

This runs `TelemetryValidatorTest`, `TelemetryRateLimiterTest` and
`TelemetryControllerTest`. The controller test also checks that a planted account
number never reaches the log output.

### 2. Try the endpoint with curl

```bash
curl -i -X POST http://localhost:8080/telemetry/v1/batch \
  -H 'Content-Type: application/json' \
  -d '{"schemaVersion":1,
       "app":{"version":"0.1.0","platform":"ios","osVersion":"18.2","environment":"local","sessionId":"curltest1"},
       "entries":[
         {"level":"error","event":"api.request.failed","timestamp":'$(date +%s000)',
          "context":{"endpoint":"getServerError","status":503,"errorCode":"SERVER_ERROR","durationMs":42}},
         {"level":"error","event":"feature.operation.failed","timestamp":'$(date +%s000)',
          "context":{"feature":"lending","accountNumber":"12345678901"}}]}'
```

The response is `202 {"accepted":1,"rejected":1}`. The backend terminal shows:

```text
ERROR client-telemetry : client api.request.failed  client.event=api.request.failed, client.level=error, client.endpoint=getServerError, client.status=503, client.errorCode=SERVER_ERROR, client.durationMs=42, client.appVersion=0.1.0, client.platform=ios, ...
 WARN TelemetryController : Dropped 1 client telemetry entries: {unknown context field=1}
```

The account number never appears. The warning names only the rule that was broken,
never the value.

To see the JSON your log pipeline would ship, run
`mvn spring-boot:run -Dspring-boot.run.profiles=json`. That turns on Spring Boot's
structured ECS logging.

### 3. Start the fake loan API (second terminal)

```bash
node dev-server/server.mjs
```

### 4. Create the React Native app and copy the files in

```bash
cd ../..   # your workspace folder
npx @react-native-community/cli@latest init LoggingPocRelay
cd LoggingPocRelay
npm install @reduxjs/toolkit react-redux        # no telemetry SDK needed
cp -R ../client_logging/backend-relay-poc/mobile/. .
rm -f __tests__/App.test.tsx
cd ios && bundle exec pod install && cd ..
```

### 5. Run on the simulator

```bash
adb reverse tcp:4040 tcp:4040 && adb reverse tcp:8080 tcp:8080   # Android only
npm run ios        # or: npm run android
```

Tap the buttons and watch the **Spring Boot terminal**. In debug builds, the Metro
console also prints each event and each batch result, for example
`[telemetry] batch { status: 202, sent: 1, requeued: false }`.

## What you should see in the backend log

| Button | Backend log line |
|---|---|
| Load loans: success | nothing (correct) |
| Server error 503 | `ERROR ... client api.request.failed`, with `client.endpoint=getServerError client.status=503 client.errorCode=SERVER_ERROR` |
| Slow request 3 s | `WARN ... client api.request.slow`, with `client.durationMs=30xx` |
| Timeout / Bad JSON | `ERROR ... client api.request.failed`, with `client.errorCode=TIMEOUT` or `PARSING_ERROR` |
| 404 / 401 / Network / 422 | `WARN ... client api.request.failed` with the matching code |
| Render crash, Async error | `ERROR ... client ui.render.failed`, with `client.feature=lending client.errorName=TypeError` (or `SyntaxError`) |
| Throw in onPress / Unhandled rejection | `ERROR ... client app.js.error`, with `client.errorCode=JS_NON_FATAL` / `UNHANDLED_REJECTION` |
| Handled error | `ERROR ... client feature.operation.failed`, with `client.errorCode=SUBMISSION_FAILED` |
| Privacy test | `ERROR ... client feature.operation.failed`, with **only** `client.feature=lending` |

**Test the retry behaviour:** stop the Spring Boot app, tap a few buttons, then start
it again. The queued events arrive within a few seconds. Metro shows
`requeued: true` while the backend is down.

## Integrating into your real backend

1. **Copy the package.** Put `backend/src/main/java/com/yourorg/telemetry/` into your
   backend, under a package your `@SpringBootApplication` already scans. Rename it to
   your package. You need no extra dependencies beyond `spring-boot-starter-web`.
   Copy the three tests too.
2. **Add the config.** Put the `telemetry:` block from `application.yml` into your
   config. `telemetry.enabled: false` is your kill switch: the endpoint then answers
   202 and keeps nothing, so apps stop retrying.
3. **Spring Security.** If your backend uses it, add a chain for the endpoint. Make
   sure it's ordered before your main chain:

   ```java
   @Bean
   @Order(1)
   SecurityFilterChain telemetrySecurity(HttpSecurity http) throws Exception {
       return http.securityMatcher("/telemetry/**")
               // Option A: require the app's normal access token
               .authorizeHttpRequests(a -> a.anyRequest().authenticated())
               // Option B: allow pre-login events too (login failures matter most):
               // .authorizeHttpRequests(a -> a.anyRequest().permitAll())
               .csrf(c -> c.disable())
               .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
               .build();
   }
   ```

   A common compromise is to allow anonymous calls with a lower rate limit, and
   authenticated calls with the normal one.
4. **Client IP behind a proxy or gateway.** Set
   `server.forward-headers-strategy: framework` (or `native`), so that
   `getRemoteAddr()` returns the real client IP for the per-IP limit. The IP is never
   logged.
5. **Several instances.** The in-memory rate limiter counts per instance. That's
   fine to start with; later, use your API gateway's rate limiting or Bucket4j with
   Redis.
6. **Getting the events into Azure:** nothing to do if your backend already ships
   its logs.
   - **Application Insights Java agent:** the events arrive as traces, and the MDC
     fields become custom properties. Check that the agent's log capture level
     includes INFO if you want `app.started`.
   - **OpenTelemetry or Logback JSON:** the `client.*` fields appear in each JSON
     log record.
7. **Alerts.** Client errors are logged at ERROR on logger `client-telemetry`.
   Include or exclude that logger name in your backend's alert rules, depending on
   whether client errors should page your on-call.

Example query, if your backend uses the Application Insights Java agent. Check the
exact property names in your workspace:

```kusto
AppTraces
| where TimeGenerated > ago(1h)
| where Properties["LoggerName"] == "client-telemetry"
| project TimeGenerated, SeverityLevel,
    Event      = tostring(Properties["client.event"]),
    Endpoint   = tostring(Properties["client.endpoint"]),
    ErrorCode  = tostring(Properties["client.errorCode"]),
    Status     = tostring(Properties["client.status"]),
    AppVersion = tostring(Properties["client.appVersion"]),
    Platform   = tostring(Properties["client.platform"])
| order by TimeGenerated desc
```

## Integrating into your app (monorepo)

| POC file | In your monorepo |
|---|---|
| `src/common/logging/logger.ts`, `httpSink.ts`, `index.ts` | `packages/common/src/...` |
| `src/api/withLogging.ts`, `baseQueryWithLogging.ts` | `packages/api/src/...` (keep your own `customBaseQuery` and `createApi`, and change only the `baseQuery` line) |
| `src/app/monitoring/initMonitoring.ts`, `components/`, `hooks/` | `packages/app/src/...` |
| `src/app/config.ts` | `telemetry.url` = your normal API base URL + `/telemetry/v1/batch` |

In `initMonitoring.ts`, set `getHeaders` to return your existing access token. The
commented line shows where.

## When the two allowlists change

When you add an event or error code, add it in **both** places in the same release:
`LogEvent` and the codes in the app's logger, and `EVENTS` and `ERROR_CODES` in
`TelemetryValidator`. Until the backend knows the new value, it drops those entries
and reports `unknown event` or `unknown errorCode` in its warning line, so mismatches
are easy to spot.

## Verified vs. not verified

- **Verified:**
  - **Backend:** the telemetry package compiled with no warnings on Java 21,
    against minimal Spring, SLF4J and Servlet stand-ins (Spring itself couldn't be
    downloaded in my environment). I drove the real controller, validator, rate
    limiter, size filter and logger through 26 checks, and all passed. They
    included the log output with `client.*` fields, a planted account number never
    reaching the logs, 400, 429 with Retry-After, 413, 411, the kill switch, and
    MDC cleanup.
  - **Mobile:** the HTTP sink type-checks and passed 7 tests. One was a real HTTP
    round trip whose payload matches the backend's wire format exactly.
- **Not verified:** `mvn test` with real Spring Boot (the JUnit and MockMvc tests
  are included for you to run), and the app on a simulator against the running
  backend.
