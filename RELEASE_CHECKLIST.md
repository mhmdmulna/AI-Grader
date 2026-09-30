# AI Grader Release Checklist

## Configuration

- Set a production PostgreSQL `DATABASE_URL` and apply the committed Prisma schema/migrations.
- Set `AI_PROVIDER` and only the matching server-side API key. Do not use `NEXT_PUBLIC_` for secrets.
- Confirm the selected model/base URL and provider account quota independently; readiness does not
  make a paid AI request.
- Mount a persistent, writable `SPREADSHEET_STORAGE_PATH` that is not publicly served.
- Set an appropriate `SPREADSHEET_EXPORT_RETENTION_HOURS`; `0` disables expiry.
- Optionally set `APP_VERSION` and `BUILD_SHA` for deployment traceability.

## Verification

Run from a clean checkout with production-like environment configuration:

```bash
npx prisma validate
npx prisma generate
npx tsc --noEmit
npm run lint
npm run test:ai
npm run test:phase2
npm run test:phase3
npm run test:phase4
npm run test:phase5
npm run test:phase6
npm run test:phase7
npm run test:phase8
npm run test:phase9
npm run test:phase10
npm run build
npm audit
```

After deployment, verify `GET /api/health` returns HTTP 200 and `status: "ready"`. A 503 indicates
configuration, database, or spreadsheet-storage readiness failure. The response reports presence,
not values, for credentials.

## Data and Operations

- Back up the database before applying production migrations.
- Generate and download one test export through the controlled download route.
- Inspect expired exports with `npm run cleanup:exports`.
- Delete expired exports only through an explicit operator action:

```bash
npm run cleanup:exports -- --delete
```

- Review cleanup failures. Unsafe paths, symlinks, and files outside the configured root are not
  removed, and their database records are preserved.
- Keep batches small enough for the platform request timeout. Batches of 20 or more emit a warning.

## Current Operational Limits

- Batch work is synchronous and sequential; there is no background job queue or automatic retry.
- Duplicate-operation detection is best-effort and not a cross-instance distributed lock.
- Export cleanup is not automatic and must be scheduled by an operator if desired.
- Human approval remains mandatory before finalization; batch grading never auto-finalizes.
