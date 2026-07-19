export const MANIFEST_SCHEMA_VERSION = 1 as const;
export const ADMISSION_POLICY_VERSION = 1 as const;
export const GITHUB_API_ORIGIN = "https://api.github.com" as const;

export type GitObjectType = "blob" | "tree" | "commit";
export type GitMode = "100644" | "100755" | "040000" | "120000" | "160000";

export type ExclusionReason =
  | "tree"
  | "submodule"
  | "symlink"
  | "malformed_git_entry"
  | "unsafe_path"
  | "generated_directory"
  | "dependency_directory"
  | "secret_path"
  | "unsupported_file_type"
  | "lockfile"
  | "minified_bundle"
  | "source_map"
  | "reported_file_too_large"
  | "file_count_limit"
  | "total_bytes_limit"
  | "blob_mismatch"
  | "unsupported_encoding"
  | "content_size_mismatch"
  | "file_too_large"
  | "binary_content"
  | "invalid_utf8"
  | "secret_detected"
  | "line_count_limit";

export type SnapshotEntry = {
  path: string;
  mode: string;
  type: string;
  objectSha: string;
  reportedSize: string | null;
  decision: "admitted" | "excluded";
  exclusionReason: ExclusionReason | null;
  rawSha256: string | null;
  normalizedSha256: string | null;
  byteCount: number | null;
  lineCount: number | null;
  rawContent?: Uint8Array;
  normalizedText?: string;
  detectedLanguage?: string | null;
};

export type RepositoryIdentity = {
  githubRepositoryId: string;
  canonicalOwner: string;
  canonicalRepository: string;
  canonicalUrl: string;
  defaultBranch: string;
};

export type SnapshotArtifact = RepositoryIdentity & {
  requestedRef: string | null;
  resolvedRef: string;
  commitSha: string;
  rootTreeSha: string;
  manifestSchemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  admissionPolicyVersion: typeof ADMISSION_POLICY_VERSION;
  manifestHashSha256: string;
  canonicalManifest: Uint8Array;
  inspectedEntryCount: number;
  admittedFileCount: number;
  excludedEntryCount: number;
  totalAdmittedBytes: string;
  entries: SnapshotEntry[];
};

export type GitHubRateMetadata = Readonly<{
  remaining: string | null;
  reset: string | null;
  retryAfter: string | null;
  requestId: string | null;
}>;
