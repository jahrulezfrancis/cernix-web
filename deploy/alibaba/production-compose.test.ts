import { readFileSync, existsSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

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

function runEnvCheck(envContents: string, extraEnv: Record<string, string> = {}): { status: number; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "cernix-env-"));
  const envPath = join(dir, ".env.production");
  writeFileSync(envPath, envContents, { mode: 0o600 });
  chmodSync(envPath, 0o600);
  const exports = Object.entries(extraEnv)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");
  const script = `
set -Eeuo pipefail
ROOT=${JSON.stringify(root)}
ENV_FILE=${JSON.stringify(envPath)}
${exports}
source ${JSON.stringify(root + "/deploy/alibaba/common.sh")}
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
AUTH_URL=https://cernix.nigerianwebdeveloper.ng
AUTH_GITHUB_CLIENT_ID=client
AUTH_GITHUB_CLIENT_SECRET=secret
QWEN_API_KEY=qwen-key
QWEN_API_ORIGIN=https://dashscope-intl.aliyuncs.com
CERNIX_SITE_ADDRESS=cernix.nigerianwebdeveloper.ng
CERNIX_CADDY_TLS_MODE=auto
`;

describe("production deployment artifacts", () => {
  it("keeps local docker-compose.yml as postgres-only development", () => {
    const local = read("docker-compose.yml");
    expect(local).toMatch(/cernix_test/);
    expect(local).not.toMatch(/worker-snapshot|caddy|migrate/);
  });

  it("uses Caddy edge with ports 80 and 443 and private backends", () => {
    const compose = read("compose.production.yml");
    expect(compose).toMatch(/^ {2}caddy:/m);
    expect(compose).not.toMatch(/^ {2}nginx:/m);
    expect(compose).toMatch(/CERNIX_HTTP_PORT:-\}?80\}:80/);
    expect(compose).toMatch(/CERNIX_HTTPS_PORT:-\}?443\}:443/);
    expect(compose).not.toMatch(/3000:3000/);
    expect(compose).not.toMatch(/5432:5432/);
    expect(compose).toMatch(/cernix_caddy_data:/);
    expect(compose).toMatch(/condition:\s*service_completed_successfully/);
  });

  it("persists certificates via named volumes and force-recreates caddy on update", () => {
    const compose = read("compose.production.yml");
    const update = read("deploy/alibaba/update.sh");
    expect(compose).toMatch(/cernix_caddy_data:\/data/);
    expect(compose).toMatch(/cernix_caddy_config:\/config/);
    expect(update).toMatch(/--force-recreate caddy/);
    expect(update).toMatch(/cernix_caddy_data is preserved|certificate volume/);
    expect(update).toMatch(/up -d --no-build/);
  });

  it("uses one shared worker image built only via migrate", () => {
    const compose = read("compose.production.yml");
    expect(compose).toMatch(/x-worker-image: &worker-image cernix-worker:prod/);
    const migrateBlock = compose.split(/^ {2}migrate:/m)[1]?.split(/^ {2}[\w-]+:/m)[0] ?? "";
    expect(migrateBlock).toMatch(/target:\s*worker/);
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
  });

  it("keeps steady-state memory caps within the 2 GiB host budget", () => {
    const compose = read("compose.production.yml");
    const workerLimit = Number(compose.match(/x-worker-common:[\s\S]*?mem_limit:\s*(\d+)m/)?.[1]);
    expect(workerLimit).toBe(160);
    const total =
      parseMemLimitMiB(compose, "postgres") +
      parseMemLimitMiB(compose, "web") +
      parseMemLimitMiB(compose, "caddy") +
      workerLimit * 5;
    expect(total).toBe(1504);
    expect(total).toBeLessThanOrEqual(1600);
  });

  it("uses bounded restart policies for web and workers", () => {
    const compose = read("compose.production.yml");
    expect(compose).toMatch(/x-worker-common:[\s\S]*?restart:\s*on-failure:5/);
    const webBlock = compose.split(/^ {2}web:/m)[1]?.split(/^ {2}[\w-]+:/m)[0] ?? "";
    expect(webBlock).toMatch(/restart:\s*on-failure:5/);
  });

  it("documents production HTTPS domain and smoke internal TLS", () => {
    const caddy = read("deploy/alibaba/Caddyfile");
    const smoke = read("deploy/alibaba/Caddyfile.smoke");
    const example = read(".env.production.example");
    expect(caddy).toMatch(/\{\$CERNIX_SITE_ADDRESS\}/);
    expect(caddy).toMatch(/reverse_proxy web:3000/);
    expect(caddy).toMatch(/X-Forwarded-Proto/);
    expect(caddy).not.toMatch(/tls internal/);
    expect(smoke).toMatch(/tls internal/);
    expect(smoke).toMatch(/redir https:\/\//);
    expect(example).toMatch(/CERNIX_SITE_ADDRESS=cernix\.nigerianwebdeveloper\.ng/);
    expect(example).toMatch(/AUTH_URL=https:\/\/cernix\.nigerianwebdeveloper\.ng/);
    expect(example).toMatch(/\/api\/auth\/github\/callback/);
    expect(example).toMatch(/Secure/);
  });

  it("rejects HTTP, IP, mismatched AUTH_URL, and placeholders", () => {
    expect(runEnvCheck(validEnv).status).toBe(0);

    expect(runEnvCheck(validEnv.replace("https://cernix.nigerianwebdeveloper.ng", "http://cernix.nigerianwebdeveloper.ng")).status).not.toBe(0);
    expect(runEnvCheck(validEnv.replace(/AUTH_URL=.*/, "AUTH_URL=https://203.0.113.10\nCERNIX_SITE_ADDRESS=203.0.113.10")).status).not.toBe(0);
    expect(
      runEnvCheck(
        validEnv
          .replace("AUTH_URL=https://cernix.nigerianwebdeveloper.ng", "AUTH_URL=https://other.example")
          .replace("CERNIX_SITE_ADDRESS=cernix.nigerianwebdeveloper.ng", "CERNIX_SITE_ADDRESS=cernix.nigerianwebdeveloper.ng"),
      ).status,
    ).not.toBe(0);

    const placeholder = runEnvCheck(validEnv.replace("cernix.nigerianwebdeveloper.ng", "PUBLIC_IP_PLACEHOLDER"));
    expect(placeholder.status).not.toBe(0);

    const internal = runEnvCheck(`${validEnv}CERNIX_CADDY_TLS_MODE=internal\n`);
    expect(internal.status).not.toBe(0);

    const smokeOk = runEnvCheck(
      validEnv
        .replace(/AUTH_URL=.*/, "AUTH_URL=https://localhost")
        .replace(/CERNIX_SITE_ADDRESS=.*/, "CERNIX_SITE_ADDRESS=localhost")
        .replace(/CERNIX_CADDY_TLS_MODE=.*/, "CERNIX_CADDY_TLS_MODE=internal"),
      { CERNIX_ALLOW_INTERNAL_TLS: "1", CERNIX_CADDY_TLS_MODE: "internal" },
    );
    expect(smokeOk.status).toBe(0);
  });

  it("deploy/update/verify use shared builds, HTTPS probes, and no nginx", () => {
    const deploy = read("deploy/alibaba/deploy.sh");
    const update = read("deploy/alibaba/update.sh");
    const verify = read("deploy/alibaba/verify.sh");
    const common = read("deploy/alibaba/common.sh");
    expect(common).toMatch(/cernix_compose build migrate/);
    expect(deploy).toMatch(/up -d --no-build/);
    expect(deploy).toMatch(/cernix_curl_health/);
    expect(verify).toMatch(/HTTPS liveness|cernix_curl_health/);
    expect(verify).toMatch(/HTTP to HTTPS redirect/);
    expect(verify).toMatch(/caddy certificate data directory/);
    expect(verify).not.toMatch(/nginx/);
    expect(update).toMatch(/--force-recreate caddy/);
    expect(existsSync(resolve(root, "deploy/alibaba/smoke.sh"))).toBe(true);
    expect(existsSync(resolve(root, "deploy/alibaba/nginx.conf"))).toBe(false);
  });

  it("architecture diagram shows Caddy HTTPS path", () => {
    const arch = read("deploy/alibaba/architecture.mmd");
    expect(arch).toMatch(/Caddy/);
    expect(arch).toMatch(/443/);
    expect(arch).toMatch(/cernix_caddy_data/);
    expect(arch).not.toMatch(/Nginx/);
  });

  it("dockerignore and gitignore keep secrets out of images and git", () => {
    expect(read(".dockerignore")).toMatch(/^\.env$/m);
    expect(read(".gitignore")).toMatch(/^!\.env\.production\.example$/m);
  });
});
