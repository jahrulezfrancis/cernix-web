import { describe, expect, it, vi } from "vitest";
import type { PoolConfig } from "pg";
import type { DatabaseInstance } from "./database";
import {
  assertDisposableDatabaseName, createDisposableTestDatabase,
  type AdminPool, type TestDatabasePoolConfig,
} from "./test-database";

const safe = {
  NODE_ENV: "test", CERNIX_INTEGRATION_TEST_DATABASE: "1",
  DATABASE_URL: "postgresql://demo_user:demo_password@127.0.0.1:54329/cernix_test",
} as const;

function fakeHarness(options: {
  databaseName?: string; destroyError?: Error; terminateError?: Error;
  dropError?: Error; endError?: Error;
} = {}) {
  const destroy = vi.fn(async () => { if (options.destroyError) throw options.destroyError; });
  const query = vi.fn(async (text: string) => {
    if (text.startsWith("select current_database")) return { rows: [{
      database_name: options.databaseName ?? "cernix_test",
      server_address: "172.18.0.2/32", client_address: "172.18.0.1/32",
    }] };
    if (text.startsWith("select pg_terminate") && options.terminateError) throw options.terminateError;
    if (text.startsWith("drop database") && options.dropError) throw options.dropError;
    return { rows: [] };
  });
  const end = vi.fn(async () => { if (options.endError) throw options.endError; });
  const admin = { query, end } as unknown as AdminPool;
  const createAdminPool = vi.fn((_config: TestDatabasePoolConfig) => admin);
  const createChildDatabase = vi.fn((_config: PoolConfig) => ({
    db: { destroy } as unknown as DatabaseInstance["db"], pool: { on: vi.fn() } as unknown as DatabaseInstance["pool"],
  }));
  return { destroy, query, end, createAdminPool, createChildDatabase };
}

describe("test database targeting boundary", () => {
  it.each([
    ["missing opt-in", { ...safe, CERNIX_INTEGRATION_TEST_DATABASE: undefined }],
    ["wrong opt-in", { ...safe, CERNIX_INTEGRATION_TEST_DATABASE: "true" }],
    ["host override", { ...safe, DATABASE_URL: `${safe.DATABASE_URL}?host=db.example.com` }],
    ["socket override", { ...safe, DATABASE_URL: `${safe.DATABASE_URL}?host=/var/run/postgresql` }],
    ["port override", { ...safe, DATABASE_URL: `${safe.DATABASE_URL}?port=5432` }],
    ["ssl override", { ...safe, DATABASE_URL: `${safe.DATABASE_URL}?sslmode=disable` }],
    ["service override", { ...safe, DATABASE_URL: `${safe.DATABASE_URL}?service=name` }],
    ["options override", { ...safe, DATABASE_URL: `${safe.DATABASE_URL}?options=-cstatement_timeout=0` }],
    ["repeated query", { ...safe, DATABASE_URL: `${safe.DATABASE_URL}?host=127.0.0.1&host=db.example.com` }],
    ["encoded query key", { ...safe, DATABASE_URL: `${safe.DATABASE_URL}?%68ost=db.example.com` }],
    ["encoded query value", { ...safe, DATABASE_URL: `${safe.DATABASE_URL}?host=%64b.example.com` }],
    ["fragment", { ...safe, DATABASE_URL: `${safe.DATABASE_URL}#host=db.example.com` }],
    ["localhost", { ...safe, DATABASE_URL: "postgresql://demo:demo@localhost:54329/cernix_test" }],
    ["IPv6 loopback", { ...safe, DATABASE_URL: "postgresql://demo:demo@[::1]:54329/cernix_test" }],
    ["remote DNS", { ...safe, DATABASE_URL: "postgresql://demo:demo@db.example.com:54329/cernix_test" }],
    ["remote IPv4", { ...safe, DATABASE_URL: "postgresql://demo:demo@192.0.2.10:54329/cernix_test" }],
    ["remote IPv6", { ...safe, DATABASE_URL: "postgresql://demo:demo@[2001:db8::1]:54329/cernix_test" }],
    ["authority ambiguity", { ...safe, DATABASE_URL: "postgresql://demo:demo@evil@127.0.0.1:54329/cernix_test" }],
    ["encoded path separator", { ...safe, DATABASE_URL: "postgresql://demo:demo@127.0.0.1:54329/cernix_test%2Fprod" }],
    ["unguarded database", { ...safe, DATABASE_URL: "postgresql://demo:demo@127.0.0.1:54329/cernix" }],
    ["production-like database", { ...safe, DATABASE_URL: "postgresql://demo:demo@127.0.0.1:54329/production" }],
    ["zero port", { ...safe, DATABASE_URL: "postgresql://demo:demo@127.0.0.1:0/cernix_test" }],
    ["overflow port", { ...safe, DATABASE_URL: "postgresql://demo:demo@127.0.0.1:65536/cernix_test" }],
    ["missing port", { ...safe, DATABASE_URL: "postgresql://demo:demo@127.0.0.1/cernix_test" }],
    ["nonnumeric port", { ...safe, DATABASE_URL: "postgresql://demo:demo@127.0.0.1:port/cernix_test" }],
    ["missing username", { ...safe, DATABASE_URL: "postgresql://:demo@127.0.0.1:54329/cernix_test" }],
    ["missing password", { ...safe, DATABASE_URL: "postgresql://demo@127.0.0.1:54329/cernix_test" }],
    ["encoded userinfo", { ...safe, DATABASE_URL: "postgresql://%64emo:demo@127.0.0.1:54329/cernix_test" }],
    ["extra path", { ...safe, DATABASE_URL: "postgresql://demo:demo@127.0.0.1:54329/cernix_test/extra" }],
    ["malformed URL", { ...safe, DATABASE_URL: "not a url" }],
  ])("rejects %s before pool construction or SQL", async (_label, environment) => {
    const createAdminPool = vi.fn();
    await expect(createDisposableTestDatabase({ environment, createAdminPool })).rejects.toThrow();
    expect(createAdminPool).not.toHaveBeenCalled();
  });

  it("passes only an explicit validated configuration object to pool factories", async () => {
    const fake = fakeHarness();
    const harness = await createDisposableTestDatabase({ environment: safe, ...fake });
    expect(fake.createAdminPool).toHaveBeenCalledWith({
      host: "127.0.0.1", port: 54329, user: "demo_user", password: "demo_password",
      database: "cernix_test", ssl: false,
    });
    const adminConfig = fake.createAdminPool.mock.calls[0][0];
    expect(adminConfig).not.toHaveProperty("connectionString");
    expect(Object.keys(adminConfig).sort()).toEqual(["database", "host", "password", "port", "ssl", "user"]);
    expect(fake.createChildDatabase).toHaveBeenCalledWith(expect.objectContaining({
      host: "127.0.0.1", port: 54329, database: harness.databaseName, ssl: false,
    }));
    expect(fake.createChildDatabase.mock.calls[0][0]).not.toHaveProperty("connectionString");
    await harness.cleanup();
  });

  it("aborts a live database-name mismatch before child creation", async () => {
    const fake = fakeHarness({ databaseName: "other_test" });
    await expect(createDisposableTestDatabase({ environment: safe, ...fake })).rejects.toThrow();
    expect(fake.query.mock.calls.some(([text]) => String(text).startsWith("create database"))).toBe(false);
    expect(fake.createChildDatabase).not.toHaveBeenCalled();
    expect(fake.end).toHaveBeenCalledOnce();
  });

  it("accepts only exact randomized children of the guarded base", () => {
    expect(() => assertDisposableDatabaseName("cernix_test", "cernix_test_0123456789abcdef01234567")).not.toThrow();
    expect(() => assertDisposableDatabaseName("cernix_test", "cernix_test")).toThrow();
    expect(() => assertDisposableDatabaseName("cernix_test", "other_test_0123456789abcdef01234567")).toThrow();
  });

  it("does not serialize credential-bearing invalid input", async () => {
    const url = "postgresql://private_user:private_password@127.0.0.1:54329/cernix_test?host=remote";
    const error = await createDisposableTestDatabase({ environment: { ...safe, DATABASE_URL: url } }).catch((value) => value);
    expect(JSON.stringify(error)).not.toContain("private_user");
    expect(JSON.stringify(error)).not.toContain("private_password");
  });
});

describe("disposable database cleanup", () => {
  it.each([
    ["child destroy", { destroyError: new Error("destroy") }],
    ["termination", { terminateError: new Error("terminate") }],
    ["drop", { dropError: new Error("drop") }],
    ["admin close", { endError: new Error("end") }],
  ] as const)("attempts every later safe stage after a %s failure", async (_label, errors) => {
    const fake = fakeHarness(errors);
    const harness = await createDisposableTestDatabase({ environment: safe, ...fake });
    await expect(harness.cleanup()).rejects.toBeInstanceOf(AggregateError);
    expect(fake.destroy).toHaveBeenCalledOnce();
    expect(fake.query.mock.calls.some(([text]) => String(text).startsWith("select pg_terminate"))).toBe(true);
    expect(fake.query.mock.calls.some(([text]) => String(text).startsWith("drop database if exists"))).toBe(true);
    expect(fake.end).toHaveBeenCalledOnce();
  });

  it("is idempotent and closes/drops at most once", async () => {
    const fake = fakeHarness();
    const harness = await createDisposableTestDatabase({ environment: safe, ...fake });
    await harness.cleanup();
    await harness.cleanup();
    expect(fake.destroy).toHaveBeenCalledOnce();
    expect(fake.query.mock.calls.filter(([text]) => String(text).startsWith("select pg_terminate"))).toHaveLength(1);
    expect(fake.query.mock.calls.filter(([text]) => String(text).startsWith("drop database if exists"))).toHaveLength(1);
    expect(fake.end).toHaveBeenCalledOnce();
  });
});
