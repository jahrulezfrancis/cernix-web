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
URL uses the numeric `127.0.0.1` host with no query string or fragment, and the
configured base database name ends in `_test`. The harness reconstructs an explicit
PostgreSQL configuration object rather than passing the URL to the driver. Rootless
Docker port forwarding means PostgreSQL reports internal bridge addresses even though
the validated client endpoint is numeric loopback; `current_database()` must also
match the guarded base before child creation.
Each run creates a randomized child database, migrates it from empty, and drops only
that exact child database during cleanup.
Job execution, retry scheduling, and production deployment are intentionally deferred.

## Deferred persistence policies

- Idempotency retention and expiry are not implemented.
- The repository exposes append-only investigation events, but database-role or
  trigger-level prevention of event updates/deletes is deferred.
- PostgreSQL verifies that qualifiers are an array; runtime validation enforces the
  per-element constraints and maximum count.
- Production Alibaba RDS TLS and CA verification must be configured before deployment.
  Never use `rejectUnauthorized: false`.
- Job retry states and status expansion require a later migration.
