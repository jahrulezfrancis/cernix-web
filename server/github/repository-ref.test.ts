import { describe, expect, it } from "vitest";
import { ApplicationError } from "@/server/errors";
import { parseGitHubRepositoryRef } from "./repository-ref";

describe("parseGitHubRepositoryRef", () => {
  it.each([
    ["https://github.com/owner/repo", "owner", "repo"],
    ["https://github.com/owner/repo/", "owner", "repo"],
    ["https://github.com/owner/repo.git", "owner", "repo"],
    ["https://github.com/owner/repo.git/", "owner", "repo"],
    ["https://GITHUB.COM/Owner/Repo", "Owner", "Repo"],
  ])("accepts and canonicalizes %s", (input, owner, repo) => {
    expect(parseGitHubRepositoryRef(input)).toEqual({
      owner,
      repo,
      canonicalUrl: `https://github.com/${owner}/${repo}`,
    });
  });

  it.each([
    "http://github.com/owner/repo",
    "ssh://github.com/owner/repo",
    "git://github.com/owner/repo",
    "github.com/owner/repo",
    "https://user@github.com/owner/repo",
    "https://user:secret@github.com/owner/repo",
    "https://github.com:443/owner/repo",
    "https://github.com/owner/repo?tab=readme",
    "https://github.com/owner/repo#readme",
    "https://www.github.com/owner/repo",
    "https://api.github.com/owner/repo",
    "https://github.com.evil.test/owner/repo",
    "https://github．com/owner/repo",
    "https://github.com/owner",
    "https://github.com//repo",
    "https://github.com/owner/",
    "https://github.com/owner/repo/tree/main",
    "https://github.com/owner/repo/issues",
    "https://github.com/./repo",
    "https://github.com/../repo",
    "https://github.com/owner/.",
    "https://github.com/owner/..",
    "https://github.com/own\\er/repo",
    "https://github.com/owner/re\\po",
    "https://github.com/owner%2Frepo/name",
    "https://github.com/owner/repo%2fextra",
    "https://github.com/owner/repo%2Fextra",
    "https://github.com/owner/repo%5cextra",
    "https://github.com/owner/repo%5Cextra",
    "https://github.com/owner/repo%252fextra",
    "https://github.com/owner/repo%252Fextra",
    "https://github.com/owner/repo%255cextra",
    "https://github.com/owner/repo%255Cextra",
    "https://github.com/owner/repo%20name",
    "https://github.com/owner/repo%09name",
    "https://github.com/owner/%252e%252e",
    "https://github.com/owner/repo%00",
    "https://github.com/owner/repo%0a",
    " https://github.com/owner/repo",
    "https://github.com/owner/repo ",
    "https://github.com/own er/repo",
    "https://github.com/owner/re po",
    "https://github.com/owner/.git",
    "https://github.com/owner/%2Egit",
    "https://github.com/owner/repo%2",
    "https://github.com/owner/repo%zz",
    "not a url",
    "",
  ])("rejects unsafe or ambiguous input %j", (input) => {
    expect(() => parseGitHubRepositoryRef(input)).toThrow(ApplicationError);
    try {
      parseGitHubRepositoryRef(input);
    } catch (error) {
      expect(error).toMatchObject({
        code: "invalid_repository_url",
        httpStatus: 422,
        message: "Enter a valid GitHub repository URL.",
      });
    }
  });

  it.each([
    "https://github.com./owner/repo",
    "https://github.com:444/owner/repo",
    "https://www.github.com/owner/repo",
    "https://raw.github.com/owner/repo",
    "https://github.com.evil.test/owner/repo",
    "https://xn--gthub-cta.com/owner/repo",
    "https://githսb.com/owner/repo",
    "https://github.com\r/owner/repo",
    "https://github.com\n/owner/repo",
    "https://github.com\t/owner/repo",
    "https://github.com\r\n/owner/repo",
    "https://github.com/owner\t/repo",
    "https://github.com%3F@evil.test/owner/repo",
    "https://github.com%23@evil.test/owner/repo",
    "https://github.com%40evil.test/owner/repo",
    "https://user%40name@github.com/owner/repo",
    "https://github.com@@evil.test/owner/repo",
    "https://github.com:443@evil.test/owner/repo",
    "https://github.com/owner/repo%25252fextra",
    "https://github.com/owner/repo%2525252Fextra",
    "https://github.com/owner/repo%25255cextra",
    "https://github.com/owner/repo%2525255Cextra",
    "https://github.com/owner/%25252e%25252e",
    "https://github.com/owner/%2525252E%2525252E",
    "https://github.com/owner/repo//",
    "https://github.com/owner//repo",
    "https://github.com//owner/repo",
    "https://github.com/owner%2f/repo\\extra",
    "https://github.com/owner\\%252frepo",
  ])("rejects additional raw parser hazards %j", (input) => {
    expect(() => parseGitHubRepositoryRef(input)).toThrow(ApplicationError);
  });

  it.each([
    ["https://github.com/owner/repo%3Ftab", "repo?tab", "https://github.com/owner/repo%3Ftab"],
    ["https://github.com/owner/repo%23anchor", "repo#anchor", "https://github.com/owner/repo%23anchor"],
    ["https://github.com/owner/repo%40scope", "repo@scope", "https://github.com/owner/repo%40scope"],
  ])(
    "keeps encoded path delimiters confined to one canonical segment for %s",
    (input, repo, canonicalUrl) => {
      expect(parseGitHubRepositoryRef(input)).toEqual({
        owner: "owner",
        repo,
        canonicalUrl,
      });
    }
  );

  it("removes exactly one terminal .git suffix", () => {
    expect(parseGitHubRepositoryRef("https://github.com/Owner/Repo.git.git")).toEqual({
      owner: "Owner",
      repo: "Repo.git",
      canonicalUrl: "https://github.com/Owner/Repo.git",
    });
  });
});
