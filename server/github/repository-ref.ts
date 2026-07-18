import { ApplicationError } from "@/server/errors";

const GITHUB_ORIGIN = "https://github.com";
const INVALID_MESSAGE = "Enter a valid GitHub repository URL.";
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const WHITESPACE = /\s/u;
const MALFORMED_PERCENT_ESCAPE = /%(?![0-9a-f]{2})/i;

export type GitHubRepositoryRef = {
  owner: string;
  repo: string;
  canonicalUrl: string;
};

function invalidRepositoryUrl(cause?: unknown): ApplicationError {
  return new ApplicationError("invalid_repository_url", {
    message: INVALID_MESSAGE,
    issues: [
      {
        field: "repositoryUrl",
        code: "invalid_repository_url",
        message: INVALID_MESSAGE,
      },
    ],
    cause,
  });
}

function decodeAndValidateSegment(rawSegment: string): string {
  if (!rawSegment || rawSegment === "." || rawSegment === "..") {
    throw invalidRepositoryUrl();
  }
  if (rawSegment.includes("\\") || CONTROL_CHARACTER.test(rawSegment) || WHITESPACE.test(rawSegment)) {
    throw invalidRepositoryUrl();
  }
  if (MALFORMED_PERCENT_ESCAPE.test(rawSegment)) {
    throw invalidRepositoryUrl();
  }

  let decoded = rawSegment;
  for (let depth = 0; depth < 4; depth += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch (cause) {
      throw invalidRepositoryUrl(cause);
    }
    if (
      next.includes("/") ||
      next.includes("\\") ||
      CONTROL_CHARACTER.test(next) ||
      WHITESPACE.test(next) ||
      next === "." ||
      next === ".."
    ) {
      throw invalidRepositoryUrl();
    }
    if (next === decoded) return next;
    decoded = next;
  }

  if (decoded.includes("%")) {
    throw invalidRepositoryUrl();
  }
  return decoded;
}

export function parseGitHubRepositoryRef(input: string): GitHubRepositoryRef {
  if (
    typeof input !== "string" ||
    !input ||
    CONTROL_CHARACTER.test(input) ||
    WHITESPACE.test(input) ||
    input.includes("\\") ||
    input.includes("?") ||
    input.includes("#")
  ) {
    throw invalidRepositoryUrl();
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch (cause) {
    throw invalidRepositoryUrl(cause);
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.toLowerCase() !== "github.com" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash
  ) {
    throw invalidRepositoryUrl();
  }

  const authorityAndPath = input.slice("https://".length);
  const firstSlash = authorityAndPath.indexOf("/");
  if (firstSlash < 0) throw invalidRepositoryUrl();
  const authority = authorityAndPath.slice(0, firstSlash);
  if (authority.toLowerCase() !== "github.com") throw invalidRepositoryUrl();

  const rawPath = authorityAndPath.slice(firstSlash + 1);
  const rawSegments = rawPath.split("/");
  if (rawSegments.at(-1) === "") rawSegments.pop();
  if (rawSegments.length !== 2) throw invalidRepositoryUrl();

  const owner = decodeAndValidateSegment(rawSegments[0]);
  let repo = decodeAndValidateSegment(rawSegments[1]);
  if (repo.endsWith(".git")) repo = repo.slice(0, -4);
  if (!repo) throw invalidRepositoryUrl();

  return {
    owner,
    repo,
    canonicalUrl: `${GITHUB_ORIGIN}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
  };
}
