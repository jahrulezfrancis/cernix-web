import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAuthConfig } from "@/server/auth/config";
import { readDatabaseUrl } from "@/server/db/config";
import { QWEN_API_ORIGIN_INTL, QWEN_API_ORIGINS } from "@/server/qwen/contracts";

const root = resolve(process.cwd());

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("production deployment artifacts", () => {
  it("keeps local docker-compose.yml as postgres-only development", () => {
    const local = read("docker-compose.yml");
    expect(local).toMatch(/cernix_test/);
    expect(local).toMatch(/127\.0\.0\.1:54329:5432/);
    expect(local).not.toMatch(/worker-snapshot|nginx|migrate/);
  });

  it("production compose exposes only port 80 and gates on migrate", () => {
    const compose = read("compose.production.yml");
    expect(compose).toMatch(/^\s*ports:\s*$/m);
    expect(compose).toMatch(/CERNIX_HTTP_PORT:-\}?80\}:80|80:80/);
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
    expect(compose).toMatch(/run-snapshot-worker\.ts/);
    expect(compose).toMatch(/run-planning-worker\.ts/);
    expect(compose).toMatch(/run-evidence-worker\.ts/);
    expect(compose).toMatch(/run-skeptic-worker\.ts/);
    expect(compose).toMatch(/run-judge-worker\.ts/);
    expect(compose).toMatch(/restart:\s*unless-stopped/);
    expect(compose).toMatch(/max-size:\s*"10m"/);
    expect(compose).toMatch(/mem_limit:/);
    expect(compose).toMatch(/no-new-privileges:true/);
    expect(compose).not.toMatch(/privileged:\s*true/);
    expect(compose).not.toMatch(/docker\.sock/);
    expect(compose).not.toMatch(/CERNIX_INTEGRATION_TEST_DATABASE/);
    expect(compose).not.toMatch(/cernix_demo|cernix_test/);
  });

  it("Dockerfile uses non-root final targets and does not copy env secrets", () => {
    const docker = read("Dockerfile");
    expect(docker).toMatch(/AS web/);
    expect(docker).toMatch(/AS worker/);
    expect(docker).toMatch(/useradd --system --uid 1001/);
    expect(docker).toMatch(/USER cernix/);
    expect(docker).toMatch(/npm ci/);
    expect(docker).not.toMatch(/npm install(?!\s)/);
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
      "deploy/alibaba/deploy.sh",
      "deploy/alibaba/update.sh",
      "deploy/alibaba/verify.sh",
      ".env.production.example",
      "compose.production.yml",
      "Dockerfile",
    ]) {
      expect(existsSync(resolve(root, path))).toBe(true);
    }
    const arch = read("deploy/alibaba/architecture.mmd");
    expect(arch).toMatch(/Nginx/);
    expect(arch).toMatch(/worker-snapshot/);
    expect(arch).toMatch(/Qwen/);
    expect(arch).toMatch(/GitHub/);
  });

  it("env production example documents exact auth callback and qwen names", () => {
    const example = read(".env.production.example");
    expect(example).toMatch(/AUTH_URL=http:\/\/PUBLIC_IP_PLACEHOLDER/);
    expect(example).toMatch(/\/api\/auth\/github\/callback/);
    expect(example).toMatch(/^QWEN_API_KEY=/m);
    expect(example).toMatch(/dashscope-intl\.aliyuncs\.com/);
    expect(example).not.toMatch(/^DASHSCOPE_API_KEY=/m);
    expect(example).not.toMatch(/AUTH_TRUST_HOST|APP_BASE_URL/);
    expect(example).not.toMatch(/CERNIX_INTEGRATION_TEST_DATABASE=1/);
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
    expect(() =>
      parseAuthConfig({
        AUTH_SECRET: "x".repeat(32),
        AUTH_URL: "http://example.test",
        AUTH_GITHUB_CLIENT_ID: "id",
        AUTH_GITHUB_CLIENT_SECRET: "secret",
      }),
    ).not.toThrow();
  });

  it("documents intl Qwen origin in the allowlist", () => {
    expect(QWEN_API_ORIGINS).toContain(QWEN_API_ORIGIN_INTL);
    expect(QWEN_API_ORIGIN_INTL).toBe("https://dashscope-intl.aliyuncs.com");
  });

  it("does not embed real cloud identifiers in deployment docs", () => {
    const files = [
      "deploy/alibaba/README.md",
      "deploy/alibaba/deploy.sh",
      "deploy/alibaba/update.sh",
      "deploy/alibaba/verify.sh",
      "compose.production.yml",
      ".env.production.example",
    ];
    for (const path of files) {
      const text = read(path);
      expect(text).not.toMatch(/i-[0-9a-f]{8,}/i);
      expect(text).not.toMatch(/vpc-[0-9a-f]+/i);
      expect(text).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
      expect(text).not.toMatch(/ghp_[A-Za-z0-9]{10,}/);
      // Allow loopback health probes and placeholders only — no public ECS IPs.
      const ips = text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [];
      for (const ip of ips) {
        expect(ip === "127.0.0.1" || ip.startsWith("0.")).toBe(true);
      }
    }
  });
});
