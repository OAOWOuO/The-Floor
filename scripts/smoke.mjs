import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["server.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: "0",
    FLOOR_DEBATE_MS: "900"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let stdout = "";
let stderr = "";
let done = false;

child.stdout.on("data", (chunk) => {
  stdout += chunk.toString("utf8");
  const match = stdout.match(/http:\/\/localhost:(\d+)/);
  if (match && !done) {
    done = true;
    runSmoke(`http://localhost:${match[1]}`).finally(() => child.kill("SIGTERM"));
  }
});

child.stderr.on("data", (chunk) => {
  stderr += chunk.toString("utf8");
});

setTimeout(() => {
  if (!done) {
    child.kill("SIGTERM");
    console.error(stderr || "Server did not start in time.");
    process.exitCode = 1;
  }
}, 5000);

async function runSmoke(baseUrl) {
  const response = await fetch(`${baseUrl}/api/debate?ticker=NVDA&question=smoke`);
  if (!response.ok || !response.body) {
    throw new Error(`Unexpected response: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawSession = false;
  let sawMessage = false;
  let sawComplete = false;

  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    sawSession ||= buffer.includes("event: session");
    sawMessage ||= buffer.includes("event: message");
    sawComplete ||= buffer.includes("event: complete");
    if (sawSession && sawMessage && sawComplete) break;
  }

  if (!sawSession || !sawMessage || !sawComplete) {
    throw new Error("SSE stream did not emit the expected events.");
  }

  console.log("Smoke test passed.");
}
