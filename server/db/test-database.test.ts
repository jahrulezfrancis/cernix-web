import { describe, expect, it, vi } from "vitest";
import { assertDisposableDatabaseName, createDisposableTestDatabase, validateTestDatabaseEnvironment } from "./test-database";

const safe = { NODE_ENV: "test", CERNIX_INTEGRATION_TEST_DATABASE: "1", DATABASE_URL: "postgresql://demo:demo@127.0.0.1:54329/cernix_test" } as const;

describe("test database safety boundary", () => {
  it.each([
    [{ ...safe, CERNIX_INTEGRATION_TEST_DATABASE: undefined }],
    [{ ...safe, CERNIX_INTEGRATION_TEST_DATABASE: "true" }],
    [{ ...safe, DATABASE_URL: "postgresql://demo:demo@db.example.com/cernix_test" }],
    [{ ...safe, DATABASE_URL: "postgresql://demo:demo@127.0.0.1/cernix" }],
    [{ ...safe, DATABASE_URL: "not a url" }],
  ])("rejects unsafe configuration before opening a pool", (environment) => {
    expect(() => validateTestDatabaseEnvironment(environment)).toThrow();
  });

  it("does not construct an admin pool when opt-in validation fails", async () => {
    const createAdminPool = vi.fn();
    await expect(createDisposableTestDatabase({ environment: { NODE_ENV: "test" }, createAdminPool })).rejects.toThrow();
    expect(createAdminPool).not.toHaveBeenCalled();
  });

  it("accepts only exact randomized children of the validated base", () => {
    expect(() => assertDisposableDatabaseName("cernix_test", "cernix_test_0123456789abcdef01234567")).not.toThrow();
    expect(() => assertDisposableDatabaseName("cernix_test", "cernix_test")).toThrow();
    expect(() => assertDisposableDatabaseName("cernix_test", "other_test_0123456789abcdef01234567")).toThrow();
  });
});
