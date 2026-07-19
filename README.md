# Cernix

## Backend database development

The persistence slice uses PostgreSQL 17. All checked-in credentials are demo-only
and bind only to the local loopback interface.

```bash
docker compose up -d postgres
export DATABASE_URL=postgresql://cernix_demo:cernix_demo@127.0.0.1:54329/cernix_test
export CERNIX_INTEGRATION_TEST_DATABASE=1
npm run db:migrate
npm run test:integration
docker compose stop postgres
```

Use `npm run db:rollback` to roll back one migration during development. Migrations
never execute during import or application builds.

Integration tests refuse to connect unless the explicit opt-in is exactly `1`, the
server is loopback-only, and the configured base database name ends in `_test`.
Each run creates a randomized child database, migrates it from empty, and drops only
that exact child database during cleanup.
Job execution, retry scheduling, and production deployment are intentionally deferred.
