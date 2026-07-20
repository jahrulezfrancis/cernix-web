import { Kysely, PostgresDialect } from "kysely";
import { Pool, type PoolConfig } from "pg";
import { ApplicationError } from "@/server/errors";
import type { Database } from "./types";
import { readDatabaseUrl } from "./config";

export type DatabaseInstance = { db: Kysely<Database>; pool: Pool };
type DatabaseFactory = () => DatabaseInstance;
const DATABASE_KEY = Symbol.for("cernix.database.instance");
type DatabaseGlobal = typeof globalThis & { [DATABASE_KEY]?: DatabaseInstance };
let productionSingleton: DatabaseInstance | undefined;
let databaseFactory: DatabaseFactory = () => createDatabase();

function readPoolMax(environment: NodeJS.ProcessEnv = process.env): number {
  const raw = environment.DATABASE_POOL_MAX;
  if (raw === undefined || raw === "") return 10;
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) throw new ApplicationError("dependency_unavailable", {});
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 50) {
    throw new ApplicationError("dependency_unavailable", {});
  }
  return value;
}

export function createDatabase(connection: string | PoolConfig = readDatabaseUrl()): DatabaseInstance {
  const base: PoolConfig =
    typeof connection === "string" ? { connectionString: connection } : { ...connection };
  if (base.max === undefined) base.max = readPoolMax();
  if (base.idleTimeoutMillis === undefined) base.idleTimeoutMillis = 30_000;
  const pool = new Pool(base);
  return { db: new Kysely<Database>({ dialect: new PostgresDialect({ pool }) }), pool };
}

function currentInstance(): DatabaseInstance | undefined {
  return process.env.NODE_ENV === "production"
    ? productionSingleton
    : (globalThis as DatabaseGlobal)[DATABASE_KEY];
}

function setInstance(instance: DatabaseInstance | undefined): void {
  if (process.env.NODE_ENV === "production") productionSingleton = instance;
  else (globalThis as DatabaseGlobal)[DATABASE_KEY] = instance;
}

export function getDatabase(): Kysely<Database> {
  let instance = currentInstance();
  if (!instance) {
    instance = databaseFactory();
    setInstance(instance);
  }
  return instance.db;
}

export async function closeDatabase(): Promise<void> {
  const instance = currentInstance();
  if (!instance) return;
  setInstance(undefined);
  await instance.db.destroy();
}

export function setDatabaseFactoryForTests(factory?: DatabaseFactory): void {
  databaseFactory = factory ?? (() => createDatabase());
}
