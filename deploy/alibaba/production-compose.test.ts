import { readFileSync, existsSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parseAuthConfig } from "@/server/auth/config";
import { readDatabaseUrl } from "@/server/db/config";
import { QWEN_API_ORIGIN_INTL, QWEN_API_ORIGINS } from "@/server/qwen/contracts";

const root = resolve(process.cwd());

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function parseMemLimitMiB(compose: string, service: string): number {
  const block = compose.split(new RegExp(`^\\s{2}${service}:`, "m"))[1]?.split(/^\s{2}[\w-]+:/m)[0] ?? "";
  const match = block.match(/mem_limit:\s*(\d+)m/);
  if (!match) throw new Error(`missing mem_limit for ${service}`);
  return Number(match[1]);
}

function runEnvCheck(envContents: string): { status: number; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "cernix-env-"));
  const envPath = join(dir, ".env.production");
  writeFileSync(envPath, envContents, { mode: 0o600 });
  chmodSync(envPath, 0o600);
  const script = `
set -Eeuo pipefail
ROOT="${root}"
ENV_FILE="${envPath}"
source "${root}/deploy/alibaba/common.sh"
cernix_require_production_env
`;
  const result = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  return { status: result.status ?? 1, stderr: result.stderr ?? "" };
}

const validEnv = `POSTGRES_DB=cernix
POSTGRES_USER=cernix
POSTGRES_PASSWORD=StrongPass_9x
DATABASE_URL=postgresql://cernix:StrongPass_9x@postgres:5432/cernix
AUTH_SECRET=${"a".repeat(32)}
AUTH_URL=http://203.0.113.10
AUTH_GITHUB_CLIENT_ID=client
AUTH_GITHUB_CLIENT_SECRET=secret
QWEN_API_KEY=qwen-key
QWEN_API_ORIGIN=https://dashscope-intl.aliyuncs.com
`;

describe("production deployment artifacts", () => {
  it("keeps local docker-compose.yml as postgres-only development", () => {
    const local = read("docker-compose.yml");
    expect(local).toMatch(/cernix_test/);
    expect(local).toMatch(/127\.0\.0\.1:54329:5432/);
    expect(local).not.toMatch(/worker-snapshot|nginx|migrate/);
  });

  it("uses one shared worker image and builds that target only via migrate", () => {
    const compose = read("compose.production.yml");
    expect(compose).toMatch(/x-worker-image: &worker-image cernix-worker:prod/);
    expect(compose).toMatch(/image: \*worker-image/);
    const migrateBlock = compose.split(/^ {2}migrate:/m)[1]?.split(/^ {2}[\w-]+:/m)[0] ?? "";
    expect(migrateBlock).toMatch(/target:\s*worker/);
    expect(migrateBlock).toMatch(/image:\s*\*worker-image/);
    for (const service of [
      "worker-snapshot",
      "worker-planning",
      "worker-evidence",
      "worker-skeptic",
      "worker-judge",
    ]) {
      const block = compose.split(new RegExp(`^\\s{2}${service}:`, "m"))[1]?.split(/^\s{2}[\w-]+:/m)[0] ?? "";
      expect(block).not.toMatch(/^\s*build:/m);
    }
    const buildTargets = [...compose.matchAll(/target:\s*(\w+)/g)].map((match) => match[1]);
    expect(buildTargets.filter((target) => target === "worker")).toHaveLength(1);
    expect(buildTargets).toContain("web");
  });

  it("keeps steady-state memory caps within the 2 GiB host budget", () => {
    const compose = read("compose.production.yml");
    const workerLimit = Number(compose.match(/x-worker-common:[\s\S]*?mem_limit:\s*(\d+)m/)?.[1]);
    expect(workerLimit).toBe(160);
    const total =
      parseMemLimitMiB(compose, "postgres") +
      parseMemLimitMiB(compose, "web") +
      parseMemLimitMiB(compose, "nginx") +
      workerLimit * 5;
    expect(total).toBe(1488);
    expect(total).toBeLessThanOrEqual(1600);
    expect(parseMemLimitMiB(compose, "migrate")).toBe(192);
    expect(compose).toMatch(/max-old-space-size=256/);
    expect(compose).toMatch(/max-old-space-size=128/);
  });

  it("uses bounded restart policies for web and workers", () => {
    const compose = read("compose.production.yml");
    expect(compose).toMatch(/x-worker-common:[\s\S]*?restart:\s*on-failure:5/);
    const webBlock = compose.split(/^ {2}web:/m)[1]?.split(/^ {2}[\w-]+:/m)[0] ?? "";
    expect(webBlock).toMatch(/restart:\s*on-failure:5/);
    const migrateBlock = compose.split(/^ {2}migrate:/m)[1]?.split(/^ {2}[\w-]+:/m)[0] ?? "";
    expect(migrateBlock).toMatch(/restart:\s*"no"/);
  });

  it("production compose exposes only configurable HTTP and gates on migrate", () => {
    const compose = read("compose.production.yml");
    expect(compose).toMatch(/CERNIX_HTTP_PORT:-\}?80\}:80/);
    expect(compose).not.toMatch(/3000:3000/);
    expect(compose).not.toMatch(/5432:5432/);
    expect(compose).toMatch(/condition:\s*service_completed_successfully/);
    for (const service of [
      "postgres",
      "migrate",
      "web",
      "worker-snapshot",
      "worker-planning",
      "worker-evidence",
      "worker-skeptic",
      "worker-judge",
      "nginx",
    ]) {
      expect(compose).toMatch(new RegExp(`^\\s{2}${service}:`, "m"));
    }
    expect(compose).toMatch(/max-size:\s*"10m"/);
    expect(compose).toMatch(/no-new-privileges:true/);
    expect(compose).not.toMatch(/privileged:\s*true/);
    expect(compose).not.toMatch(/docker\.sock/);
    expect(compose).not.toMatch(/CERNIX_INTEGRATION_TEST_DATABASE/);
    expect(compose).not.toMatch(/cernix_demo|cernix_test/);
  });

  it("deploy and update build sequentially then up --no-build; update force-recreates nginx", () => {
    const deploy = read("deploy/alibaba/deploy.sh");
    const update = read("deploy/alibaba/update.sh");
    const verify = read("deploy/alibaba/verify.sh");
    const common = read("deploy/alibaba/common.sh");
    expect(common).toMatch(/cernix_compose build web/);
    expect(common).toMatch(/cernix_compose build migrate/);
    expect(deploy).toMatch(/up -d --no-build/);
    expect(deploy).toMatch(/cernix_http_base|CERNIX_HTTP_PORT/);
    expect(update).toMatch(/up -d --no-build/);
    expect(update).toMatch(/--force-recreate nginx/);
    expect(verify).toMatch(/CERNIX_HTTP_PORT/);
    expect(verify).toMatch(/shared worker image id/);
    expect(verify).not.toMatch(/ss -ltn.*3000|host has no \*:3000/);
    expect(deploy).not.toMatch(/(?:^|[^\w-])build worker(?:$|[^\w-])/m);
    expect(update).not.toMatch(/(?:^|[^\w-])build worker(?:$|[^\w-])/m);
    expect(read("deploy/alibaba/README.md")).not.toMatch(/(?:^|[^\w-])build worker(?:$|[^\w-])/m);
  });

  it("rejects placeholders, short AUTH_SECRET, test vars, and bad origins without printing secrets", () => {
    expect(runEnvCheck(validEnv).status).toBe(0);

    const placeholder = runEnvCheck(validEnv.replace("http://203.0.113.10", "http://PUBLIC_IP_PLACEHOLDER"));
    expect(placeholder.status).not.toBe(0);
    expect(placeholder.stderr).toMatch(/AUTH_URL|placeholder/i);
    expect(placeholder.stderr).not.toMatch(/aaaaaaaaaa/);

    const shortSecret = runEnvCheck(validEnv.replace("a".repeat(32), "too-short"));
    expect(shortSecret.status).not.toBe(0);
    expect(shortSecret.stderr).toMatch(/AUTH_SECRET/);
    expect(shortSecret.stderr).not.toMatch(/too-short/);

    const testDb = runEnvCheck(`${validEnv}CERNIX_INTEGRATION_TEST_DATABASE=1\n`);
    expect(testDb.status).not.toBe(0);

    const badOrigin = runEnvCheck(
      validEnv.replace("https://dashscope-intl.aliyuncs.com", "https://evil.example"),
    );
    expect(badOrigin.status).not.toBe(0);
  });

  it("Dockerfile uses non-root final targets and does not copy env secrets", () => {
    const docker = read("Dockerfile");
    expect(docker).toMatch(/AS web/);
    expect(docker).toMatch(/AS worker/);
    expect(docker).toMatch(/useradd --system --uid 1001/);
    expect(docker).toMatch(/USER cernix/);
    expect(docker).toMatch(/npm ci/);
    expect(docker).not.toMatch(/COPY\.env/);
    expect(docker).not.toMatch(/AUTH_SECRET|QWEN_API_KEY|POSTGRES_PASSWORD/);
  });

  it("dockerignore excludes secrets and keeps required build inputs", () => {
    const ignore = read(".dockerignore");
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).toMatch(/^\.env\.\*$/m);
    expect(ignore).toMatch(/^\.git$/m);
    expect(ignore).toMatch(/node_modules/);
    expect(ignore).not.toMatch(/^package-lock\.json$/m);
    expect(ignore).not.toMatch(/^public$/m);
    expect(ignore).not.toMatch(/^server$/m);
  });

  it("nginx forwards trusted proxy headers and hides version", () => {
    const nginx = read("deploy/alibaba/nginx.conf");
    expect(nginx).toMatch(/proxy_set_header Host \$host;/);
    expect(nginx).toMatch(/proxy_set_header X-Real-IP \$remote_addr;/);
    expect(nginx).toMatch(/proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;/);
    expect(nginx).toMatch(/proxy_set_header X-Forwarded-Proto \$scheme;/);
    expect(nginx).toMatch(/server_tokens off;/);
    expect(nginx).toMatch(/location = \/nginx-health/);
    expect(nginx).not.toMatch(/ssl_certificate/);
  });

  it("deployment proof files and scripts exist", () => {
    for (const path of [
      "deploy/alibaba/README.md",
      "deploy/alibaba/nginx.conf",
      "deploy/alibaba/architecture.mmd",
      "deploy/alibaba/common.sh",
      "deploy/alibaba/deploy.sh",
      "deploy/alibaba/update.sh",
      "deploy/alibaba/verify.sh",
      ".env.production.example",
      "compose.production.yml",
      "Dockerfile",
    ]) {
      expect(existsSync(resolve(root, path))).toBe(true);
    }
  });

  it("env production example documents exact auth callback and qwen names", () => {
    const example = read(".env.production.example");
    expect(example).toMatch(/AUTH_URL=http:\/\/PUBLIC_IP_PLACEHOLDER/);
    expect(example).toMatch(/\/api\/auth\/github\/callback/);
    expect(example).toMatch(/^QWEN_API_KEY=/m);
    expect(example).toMatch(/dashscope-intl\.aliyuncs\.com/);
    expect(example).toMatch(/Secure cookies/);
  });

  it("gitignore ignores .env.production while keeping the example", () => {
    const gitignore = read(".gitignore");
    expect(gitignore).toMatch(/^\.env$/m);
    expect(gitignore).toMatch(/^\.env\.\*$/m);
    expect(gitignore).toMatch(/^!\.env\.production\.example$/m);
  });

  it("rejects missing production auth/database values at parse time, not via silent defaults", () => {
    expect(() => readDatabaseUrl({} as NodeJS.ProcessEnv)).toThrow();
    expect(() =>
      parseAuthConfig({
        AUTH_SECRET: "short",
        AUTH_URL: "http://example.test",
        AUTH_GITHUB_CLIENT_ID: "id",
        AUTH_GITHUB_CLIENT_SECRET: "secret",
      }),
    ).toThrow();
  });

  it("documents intl Qwen origin in the allowlist", () => {
    expect(QWEN_API_ORIGINS).toContain(QWEN_API_ORIGIN_INTL);
  });

  it("does not embed real cloud identifiers in deployment docs", () => {
    const files = [
      "deploy/alibaba/README.md",
      "deploy/alibaba/deploy.sh",
      "deploy/alibaba/update.sh",
      "deploy/alibaba/verify.sh",
      "deploy/alibaba/common.sh",
      "compose.production.yml",
      ".env.production.example",
    ];
    for (const path of files) {
      const text = read(path);
      expect(text).not.toMatch(/i-[0-9a-f]{8,}/i);
      expect(text).not.toMatch(/vpc-[0-9a-f]+/i);
      expect(text).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
      expect(text).not.toMatch(/ghp_[A-Za-z0-9]{10,}/);
      const ips = text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [];
      for (const ip of ips) {
        expect(ip === "127.0.0.1" || ip.startsWith("0.") || ip === "203.0.113.10").toBe(true);
      }
    }
  });
});
