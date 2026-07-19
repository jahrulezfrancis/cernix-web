import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseInstance } from "./database";
import { closeDatabase, getDatabase, setDatabaseFactoryForTests } from "./database";

function fakeInstance(): DatabaseInstance {
  return {
    db: { destroy: vi.fn().mockResolvedValue(undefined) } as unknown as DatabaseInstance["db"],
    pool: {} as DatabaseInstance["pool"],
  };
}

afterEach(async () => {
  await closeDatabase();
  setDatabaseFactoryForTests();
  vi.unstubAllEnvs();
});

describe("database singleton lifecycle", () => {
  it("is lazy and reuses one development instance", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const instance = fakeInstance();
    const factory = vi.fn(() => instance);
    setDatabaseFactoryForTests(factory);
    expect(factory).not.toHaveBeenCalled();
    expect(getDatabase()).toBe(instance.db);
    expect(getDatabase()).toBe(instance.db);
    expect(factory).toHaveBeenCalledOnce();
  });

  it("clears development cache before close and creates a fresh instance later", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const first = fakeInstance(), second = fakeInstance();
    const factory = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    setDatabaseFactoryForTests(factory);
    expect(getDatabase()).toBe(first.db);
    await closeDatabase();
    await closeDatabase();
    expect(first.db.destroy).toHaveBeenCalledOnce();
    expect(getDatabase()).toBe(second.db);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("keeps production singleton creation bounded", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const instance = fakeInstance();
    const factory = vi.fn(() => instance);
    setDatabaseFactoryForTests(factory);
    expect(getDatabase()).toBe(instance.db);
    expect(getDatabase()).toBe(instance.db);
    expect(factory).toHaveBeenCalledOnce();
    await closeDatabase();
    expect(instance.db.destroy).toHaveBeenCalledOnce();
  });
});
