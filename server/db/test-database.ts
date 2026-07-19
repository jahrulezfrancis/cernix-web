import { randomBytes } from "node:crypto";
import { escapeIdentifier, Pool } from "pg";
import { ApplicationError } from "@/server/errors";
import { createDatabase } from "./database";

export const TEST_DATABASE_OPT_IN = "CERNIX_INTEGRATION_TEST_DATABASE";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const BASE_NAME = /^[a-z][a-z0-9_]{0,47}_test$/;
function unsafe(): never { throw new ApplicationError("malformed_input", {}); }

export function validateTestDatabaseEnvironment(environment: NodeJS.ProcessEnv) {
  if (environment[TEST_DATABASE_OPT_IN] !== "1") unsafe();
  const value = environment.DATABASE_URL;
  if (!value || /[\s\u0000-\u001f]/.test(value)) unsafe();
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname) ||
      url.hash || url.pathname.split('/').length !== 2 || !url.username) unsafe();
    const baseName = decodeURIComponent(url.pathname.slice(1));
    if (!BASE_NAME.test(baseName)) unsafe();
    return { connectionString: value, baseName };
  } catch (error) { if (error instanceof ApplicationError) throw error; return unsafe(); }
}

export function assertDisposableDatabaseName(base: string, name: string) {
  if (!BASE_NAME.test(base) || !(new RegExp(`^${base}_[0-9a-f]{24}$`)).test(name)) unsafe();
}

type AdminPool = Pick<Pool, "query" | "end">;
export async function createDisposableTestDatabase(options: {
  environment?: NodeJS.ProcessEnv;
  createAdminPool?: (connectionString: string) => AdminPool;
} = {}) {
  const config = validateTestDatabaseEnvironment(options.environment ?? process.env);
  const admin = options.createAdminPool?.(config.connectionString) ??
    new Pool({ connectionString: config.connectionString, max: 2 });
  let name: string | undefined;
  try {
    const proof = await admin.query<{ database_name: string }>(
      "select current_database() database_name"
    );
    const row = proof.rows[0];
    if (!row || row.database_name !== config.baseName) unsafe();
    name = `${config.baseName}_${randomBytes(12).toString("hex")}`;
    assertDisposableDatabaseName(config.baseName, name);
    await admin.query(`create database ${escapeIdentifier(name)}`);
    const url = new URL(config.connectionString); url.pathname = `/${name}`;
    const child = createDatabase(url.toString());
    return { ...child, databaseName: name, async cleanup() {
      await child.db.destroy();
      assertDisposableDatabaseName(config.baseName, name!);
      await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()", [name]);
      await admin.query(`drop database ${escapeIdentifier(name!)}`);
      await admin.end();
    } };
  } catch (error) {
    if (name) {
      assertDisposableDatabaseName(config.baseName, name);
      await admin.query(`drop database if exists ${escapeIdentifier(name)}`).catch(() => undefined);
    }
    await admin.end().catch(() => undefined);
    throw error;
  }
}
