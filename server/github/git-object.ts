import { createHash } from "node:crypto";

export function gitBlobSha1(raw: Uint8Array): string {
  const header = Buffer.from(`blob ${raw.byteLength}\0`, "ascii");
  return createHash("sha1").update(header).update(raw).digest("hex");
}
