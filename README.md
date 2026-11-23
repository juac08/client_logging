# React Native Client-Side Logging POCs

Two runnable proofs of concept for client-side logging in a React Native app that
uses RTK Query with a custom base query.

Both share the same design:
- a framework-free logger with a privacy filter
- a wrapper around the RTK Query base query
- a class error boundary
- a Playground screen with one button per failure scenario

Only the monitoring layer differs between them.

| Folder | Sends to | Highlights |
|---|---|---|
| [`azure-poc/`](azure-poc/README.md) | Azure Application Insights | Runs fully locally with a fake Azure collector. Switch to real Azure by changing the connection string. |
| [`sentry-poc/`](sentry-poc/README.md) | Sentry (sentry.io) | Stack traces with redacted messages, native crash reports, issue grouping, breadcrumbs |
| [`docs/`](docs/rn-logging-poc-guide.pdf) | n/a | Step-by-step implementation guide (PDF) |

Both can be tested at no cost. The Azure POC needs no account for local testing,
and Sentry's free Developer plan is enough for the Sentry POC.

Each folder has its own README with:
- setup steps
- the expected result for every Playground button
- privacy notes
- a map for moving the code into a monorepo (`packages/common`, `packages/api`, `packages/app`)
