import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packageJson = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));

export function getBuildInfo() {
  return {
    name: packageJson.name,
    version: packageJson.version,
    node: process.version,
    environment: process.env.NODE_ENV || "development",
    render: {
      serviceId: process.env.RENDER_SERVICE_ID || null,
      serviceName: process.env.RENDER_SERVICE_NAME || null,
      externalUrl: process.env.RENDER_EXTERNAL_URL || null,
      gitCommit: firstEnv("RENDER_GIT_COMMIT", "SOURCE_COMMIT", "GIT_COMMIT", "COMMIT_SHA") || readGitCommit()
    }
  };
}

function firstEnv(...names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  return null;
}

function readGitCommit() {
  try {
    const head = readFileSync(path.join(rootDir, ".git", "HEAD"), "utf8").trim();
    if (/^[a-f0-9]{40}$/i.test(head)) return head;
    const ref = head.match(/^ref:\s+(.+)$/)?.[1];
    if (!ref) return null;
    const value = readFileSync(path.join(rootDir, ".git", ref), "utf8").trim();
    return /^[a-f0-9]{40}$/i.test(value) ? value : null;
  } catch {
    return null;
  }
}
