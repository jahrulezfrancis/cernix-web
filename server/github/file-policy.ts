import { ADMISSION_POLICY_VERSION, type ExclusionReason, type SnapshotEntry } from "./contracts";
import type { GitHubSnapshotConfig } from "./config";

export { ADMISSION_POLICY_VERSION };
export const MAX_SNAPSHOT_PATH_BYTES = 1_024;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const DEPENDENCY_DIRECTORIES = new Set(["node_modules", "vendor", "bower_components", ".pnpm", ".yarn", "packages_cache"]);
const GENERATED_DIRECTORIES = new Set([".git", ".next", "dist", "build", "coverage", "target", ".turbo", ".cache", "out", "tmp"]);
const SECRET_NAMES = /^(?:\.env(?:\..+)?|\.npmrc|\.pypirc|credentials(?:\.json)?|service[-_]?account(?:\.json)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|.*\.(?:pem|p12|pfx|key))$/i;
const LOCKFILES = new Set(["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb", "composer.lock", "cargo.lock", "poetry.lock", "pipfile.lock", "gemfile.lock", "go.sum"]);
const UNSUPPORTED_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp", "tiff", "mp3", "wav", "ogg", "flac", "mp4", "mov", "avi", "mkv", "webm",
  "woff", "woff2", "ttf", "otf", "eot", "zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "jar", "war", "exe", "dll", "so", "dylib",
  "o", "obj", "a", "class", "pyc", "wasm", "bin", "iso", "dmg", "deb", "rpm", "apk", "cab",
  "db", "sqlite", "sqlite3", "mdb", "pdf", "psd", "ai",
]);

export type InspectedTreeEntry = Readonly<{
  path: string; mode: string; type: string; sha: string; reportedSize: string | null;
}>;

export function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function isUnambiguouslyNormalizedPath(path: string): boolean {
  if (!path || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.includes("\\") || CONTROL.test(path)) return false;
  if (path.normalize("NFC") !== path || Buffer.byteLength(path, "utf8") > MAX_SNAPSHOT_PATH_BYTES) return false;
  if (/\p{Surrogate}/u.test(path)) return false;
  const segments = path.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== ".." && Buffer.byteLength(segment, "utf8") <= 255);
}

function extension(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function primaryExclusion(entry: InspectedTreeEntry, config: GitHubSnapshotConfig): ExclusionReason | null {
  if (!isUnambiguouslyNormalizedPath(entry.path)) return "unsafe_path";
  if (entry.mode === "040000" && entry.type === "tree") return "tree";
  if (entry.mode === "160000" && entry.type === "commit") return "submodule";
  if (entry.mode === "120000" && entry.type === "blob") return "symlink";
  if (!(["100644", "100755"].includes(entry.mode) && entry.type === "blob")) return "malformed_git_entry";
  const segments = entry.path.toLowerCase().split("/");
  if (segments.some((segment) => GENERATED_DIRECTORIES.has(segment))) return "generated_directory";
  if (segments.some((segment) => DEPENDENCY_DIRECTORIES.has(segment))) return "dependency_directory";
  const name = segments.at(-1)!;
  if (SECRET_NAMES.test(name) || segments.some((segment) => segment === ".aws" || segment === ".ssh" || segment === ".gnupg")) return "secret_path";
  if (LOCKFILES.has(name)) return "lockfile";
  const ext = extension(entry.path);
  if (ext === "map") return "source_map";
  if (/\.min\.(?:js|css|mjs|cjs)$/i.test(name)) return "minified_bundle";
  if (UNSUPPORTED_EXTENSIONS.has(ext)) return "unsupported_file_type";
  if (entry.reportedSize !== null && BigInt(entry.reportedSize) > BigInt(config.maxFileBytes)) return "reported_file_too_large";
  return null;
}

export function applyAdmissionPolicy(entries: readonly InspectedTreeEntry[], config: GitHubSnapshotConfig): SnapshotEntry[] {
  let admitted = 0;
  return [...entries].sort((a, b) => compareUtf8(a.path, b.path)).map((entry) => {
    let reason = primaryExclusion(entry, config);
    if (!reason && admitted >= config.maxAdmittedFiles) reason = "file_count_limit";
    // Aggregate admission is deliberately deferred until verified bytes are
    // consumed in canonical path order. Tree sizes are only advisory.
    if (!reason) admitted++;
    return {
      path: entry.path, mode: entry.mode, type: entry.type, objectSha: entry.sha,
      reportedSize: entry.reportedSize, decision: reason ? "excluded" : "admitted",
      exclusionReason: reason, rawSha256: null, normalizedSha256: null,
      byteCount: null, lineCount: null,
    };
  });
}
