# Cernix

## Backend database development

The persistence slice uses PostgreSQL 17. All checked-in credentials are demo-only
and bind only to the local loopback interface.

```bash
docker compose up -d postgres
export DATABASE_URL=postgresql://cernix_demo:cernix_demo@127.0.0.1:54329/cernix
npm run db:migrate
npm run test:integration
docker compose stop postgres
```

Use `npm run db:rollback` to roll back one migration during development. Migrations
never execute during import or application builds.
