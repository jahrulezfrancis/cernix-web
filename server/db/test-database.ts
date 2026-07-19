import { randomBytes } from "node:crypto";
import { escapeIdentifier, Pool, type PoolConfig } from "pg";
import { ApplicationError } from "@/server/errors";
import { createDatabase, type DatabaseInstance } from "./database";

export const TEST_DATABASE_OPT_IN = "CERNIX_INTEGRATION_TEST_DATABASE";
const BASE_NAME = /^[a-z][a-z0-9_]{0,47}_test$/;
const TEST_URL = /^(postgres(?:ql)?):\/\/([A-Za-z0-9_][A-Za-z0-9_.-]{0,127}):([A-Za-z0-9_][A-Za-z0-9_.-]{0,127})@127\.0\.0\.1:(\d{1,5})\/([a-z][a-z0-9_]{0,47}_test)$/;
function unsafe(): never { throw new ApplicationError("malformed_input", {}); }

export type TestDatabasePoolConfig = Readonly<{
  host: "127.0.0.1"; port: number; user: string; password: string;
  database: string; ssl: false;
}>;

export function validateTestDatabaseEnvironment(environment: NodeJS.ProcessEnv): {
  poolConfig: TestDatabasePoolConfig; baseName: string;
} {
  if (environment[TEST_DATABASE_OPT_IN] !== "1") unsafe();
  const value = environment.DATABASE_URL;
  if (!value || /[\s\u0000-\u001f]/.test(value)) unsafe();
  const match = TEST_URL.exec(value);
  if (!match) unsafe();
  try {
    const url = new URL(value);
    if (url.search || url.hash || url.hostname !== "127.0.0.1" || url.pathname.split("/").length !== 2) unsafe();
    const [, , user, password, rawPort, baseName] = match;
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65_535 || !BASE_NAME.test(baseName)) unsafe();
    return { poolConfig: Object.freeze({ host: "127.0.0.1", port, user, password, database: baseName, ssl: false }), baseName };
  } catch (error) { if (error instanceof ApplicationError) throw error; return unsafe(); }
}

export function assertDisposableDatabaseName(base: string, name: string) {
  if (!BASE_NAME.test(base) || !(new RegExp(`^${base}_[0-9a-f]{24}$`)).test(name)) unsafe();
}

type QueryResult<Row> = { rows: Row[] };
export type AdminPool = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
  end(): Promise<void>;
};
type TargetProof = Readonly<{ databaseName: string; serverAddress: string | null; clientAddress: string | null }>;

function throwCleanupFailures(failures: unknown[]): void {
  if (failures.length) throw new AggregateError(failures, "Disposable test database cleanup failed.");
}

export async function createDisposableTestDatabase(options: {
  environment?: NodeJS.ProcessEnv;
  createAdminPool?: (config: TestDatabasePoolConfig) => AdminPool;
  createChildDatabase?: (config: PoolConfig) => DatabaseInstance;
} = {}) {
  const config = validateTestDatabaseEnvironment(options.environment ?? process.env);
  const admin = options.createAdminPool?.(config.poolConfig) ?? new Pool(config.poolConfig) as AdminPool;
  const createChild = options.createChildDatabase ?? createDatabase;
  let name: string | undefined;
  let child: DatabaseInstance | undefined;
  let cleanupPromise: Promise<void> | undefined;

  async function performCleanup(): Promise<void> {
    const failures: unknown[] = [];
    if (child) {
      // Child deletion intentionally terminates any straggling idle client. Prevent
      // node-postgres from re-emitting that expected teardown signal as uncaught.
      child.pool.on("error", () => {});
      try { await child.db.destroy(); } catch (error) { failures.push(error); }
    }
    if (name) {
      try {
        assertDisposableDatabaseName(config.baseName, name);
        await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()", [name]);
      } catch (error) { failures.push(error); }
      try {
        assertDisposableDatabaseName(config.baseName, name);
        await admin.query(`drop database if exists ${escapeIdentifier(name)}`);
      } catch (error) { failures.push(error); }
    }
    try { await admin.end(); } catch (error) { failures.push(error); }
    throwCleanupFailures(failures);
  }

  const cleanup = () => cleanupPromise ??= performCleanup();
  try {
    const proof = await admin.query<{ database_name: string; server_address: string | null; client_address: string | null }>(
      "select current_database() database_name, inet_server_addr()::text server_address, inet_client_addr()::text client_address"
    );
    const row = proof.rows[0];
    if (!row || row.database_name !== config.baseName) unsafe();
    const targetProof: TargetProof = Object.freeze({
      databaseName: row.database_name, serverAddress: row.server_address, clientAddress: row.client_address,
    });
    name = `${config.baseName}_${randomBytes(12).toString("hex")}`;
    assertDisposableDatabaseName(config.baseName, name);
    await admin.query(`create database ${escapeIdentifier(name)}`);
    child = createChild({ ...config.poolConfig, database: name });
    return { ...child, databaseName: name, targetProof, cleanup };
  } catch (error) {
    const failures = [error];
    try { await cleanup(); } catch (cleanupError) {
      if (cleanupError instanceof AggregateError) failures.push(...cleanupError.errors);
      else failures.push(cleanupError);
    }
    if (failures.length === 1) throw error;
    throw new AggregateError(failures, "Disposable test database setup failed.");
  }
}
