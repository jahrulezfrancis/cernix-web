import { describe, expect, it } from "vitest";
import { ApplicationError } from "@/server/errors";
import { createDatabase, closeDatabase } from "@/server/db/database";

describe("DATABASE_POOL_MAX", () => {
  it("rejects unsafe pool sizes", () => {
    const previous = process.env.DATABASE_POOL_MAX;
    try {
      process.env.DATABASE_POOL_MAX = "0";
      expect(() => createDatabase("postgresql://cernix:x@127.0.0.1:1/cernix")).toThrow(ApplicationError);
      process.env.DATABASE_POOL_MAX = "999";
      expect(() => createDatabase("postgresql://cernix:x@127.0.0.1:1/cernix")).toThrow(ApplicationError);
    } finally {
      if (previous === undefined) delete process.env.DATABASE_POOL_MAX;
      else process.env.DATABASE_POOL_MAX = previous;
      void closeDatabase();
    }
  });
});
