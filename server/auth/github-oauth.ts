import { getAuthConfig } from "./config";

export type GitHubUserProfile = Readonly<{
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}>;

export function buildGitHubAuthorizeUrl(state: string): string {
  const config = getAuthConfig();
  const params = new URLSearchParams({
    client_id: config.githubClientId,
    redirect_uri: `${config.appUrl}/api/auth/github/callback`,
    scope: "read:user",
    state,
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export async function exchangeGitHubCode(code: string): Promise<string> {
  const config = getAuthConfig();
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      client_id: config.githubClientId,
      client_secret: config.githubClientSecret,
      code,
      redirect_uri: `${config.appUrl}/api/auth/github/callback`,
    }),
  });
  if (!response.ok) {
    throw new Error(`GitHub token exchange failed with status ${response.status}`);
  }
  const body = await response.json() as { access_token?: string; error?: string };
  if (!body.access_token) {
    throw new Error(body.error ?? "GitHub token exchange returned no access token");
  }
  return body.access_token;
}

export async function fetchGitHubUserProfile(accessToken: string): Promise<GitHubUserProfile> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/vnd.github+json",
      "user-agent": "cernix-web",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub user profile request failed with status ${response.status}`);
  }
  const body = await response.json() as GitHubUserProfile;
  if (!body.id || !body.login) {
    throw new Error("GitHub user profile response was incomplete");
  }
  return body;
}
