import { describe, expect, it, afterEach } from "vitest";
import { GET as liveGet } from "@/app/api/health/live/route";
import { GET as readyGet } from "@/app/api/health/ready/route";
import { closeDatabase, setDatabaseFactoryForTests } from "@/server/db/database";

describe("health endpoints", () => {
  afterEach(async () => {
    setDatabaseFactoryForTests();
    await closeDatabase();
  });

  it("live returns only a stable live status", async () => {
    const response = await liveGet();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ status: "live" });
    expect(JSON.stringify(body)).not.toMatch(/secret|password|database|commit|host|version/i);
  });

  it("ready returns unavailable without leaking errors when database fails", async () => {
    setDatabaseFactoryForTests(() => {
      throw new Error("should-not-leak-connection-string-or-stack");
    });
    const response = await readyGet();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ status: "unavailable" });
    expect(JSON.stringify(body)).not.toMatch(/should-not-leak|connection|stack|ECONNREFUSED/i);
  });
});
