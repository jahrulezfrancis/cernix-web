import { createDatabase } from "./database";
import { migrateToLatest, rollbackOne } from "./migrate";

const { db } = createDatabase();
try {
  if (process.argv[2] === "up") await migrateToLatest(db);
  else if (process.argv[2] === "down") await rollbackOne(db);
  else throw new Error("Expected migration command: up or down.");
} catch {
  process.exitCode = 1;
  console.error("Database migration failed.");
} finally {
  await db.destroy();
}
