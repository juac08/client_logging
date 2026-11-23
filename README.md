# React Native Client-Side Logging POCs

Three runnable proofs of concept for client-side logging in a React Native app that
uses RTK Query with a custom base query.

All three share the same design:
- a framework-free logger with a privacy filter
- a wrapper around the RTK Query base query
- a class error boundary
- a Playground screen with one button per failure scenario

Only the destination of the events differs.

**Start here:** [`frontend-logger/`](frontend-logger/README.md) is the production
implementation for the app. It's an app-wide logger (`logger.info/warn/error/debug`,
child loggers, error boundary, RTK Query wrapper) that sends to your backend endpoint
with no third-party library. The POCs below explore the options that led to it.

| Folder | Sends to | Highlights |
|---|---|---|
| [`frontend-logger/`](frontend-logger/README.md) | Your backend endpoint | **Production version:** event catalog, privacy filter, batching with retry and backoff, throttling, kill switch, 24 tests |
| [`backend-relay-poc/`](backend-relay-poc/README.md) | **Your own Spring Boot backend**, then your existing logs | No vendor SDK in the app, a server-side allowlist, and your own auth and rate limits. The bank-friendly option. |
| [`azure-poc/`](azure-poc/README.md) | Azure Application Insights, directly from the app | Runs fully locally with a fake Azure collector. Switch to real Azure by changing the connection string. |
| [`sentry-poc/`](sentry-poc/README.md) | Sentry (sentry.io) | Stack traces with redacted messages, native crash reports, issue grouping, breadcrumbs |
| [`docs/`](docs/rn-logging-poc-guide.pdf) | n/a | Step-by-step implementation guide (PDF) |

All three can be tested at no cost:
- **backend-relay-poc** runs entirely on your machine.
- **azure-poc** needs no account for local testing.
- **sentry-poc** works on Sentry's free Developer plan.

Each folder has its own README with:
- setup steps
- the expected result for every Playground button
- privacy notes
- a map for moving the code into a monorepo (`packages/common`, `packages/api`, `packages/app`)
