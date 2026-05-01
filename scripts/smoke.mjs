import { spawn } from "node:child_process";

await runServerSmoke({
  name: "research flow",
  env: {
    PORT: "0",
    HOST: "0.0.0.0",
    FLOOR_DEBATE_MS: "900",
    THE_FLOOR_FIXTURE_MODE: "1",
    OPENAI_MOCK: "1",
    OPENAI_API_KEY: "test",
    OPENAI_MODEL: process.env.OPENAI_MODEL || "gpt-5.4-mini"
  },
  run: runResearchFlow
});

await runServerSmoke({
  name: "missing API key failure",
  env: {
    PORT: "0",
    HOST: "0.0.0.0",
    FLOOR_DEBATE_MS: "500",
    THE_FLOOR_FIXTURE_MODE: "1",
    OPENAI_MOCK: "",
    OPENAI_API_KEY: ""
  },
  run: runMissingKeyFlow
});

console.log("Smoke test passed.");

async function runServerSmoke({ name, env, run }) {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  let started = false;

  const baseUrl = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${name}: server did not start in time. ${stderr}`));
    }, 7000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      const match = stdout.match(/http:\/\/localhost:(\d+)/);
      if (match && !started) {
        started = true;
        clearTimeout(timeout);
        resolve(`http://localhost:${match[1]}`);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("exit", (code) => {
      if (!started) {
        clearTimeout(timeout);
        reject(new Error(`${name}: server exited before start (${code}). ${stderr}`));
      }
    });
  });

  try {
    await run(baseUrl);
  } finally {
    child.kill("SIGTERM");
  }
}

async function runResearchFlow(baseUrl) {
  const health = await fetch(`${baseUrl}/api/health`);
  if (!health.ok) throw new Error(`Health failed: ${health.status}`);
  if (health.headers.get("x-content-type-options") !== "nosniff") {
    throw new Error("Health response missing security headers.");
  }
  if (!health.headers.get("content-security-policy")?.includes("default-src 'self'")) {
    throw new Error("Health response missing content security policy.");
  }
  const healthBody = await health.json();
  if (!healthBody.ok || !healthBody.build?.name) throw new Error("Health response missing build metadata.");
  if (healthBody.capabilities?.acceptsBrowserApiKeys !== false) {
    throw new Error("Health response must disclose that browser API keys are not accepted.");
  }
  if (healthBody.capabilities?.showcaseLiveSnapshot !== true) {
    throw new Error("Health response must disclose showcase live snapshots.");
  }

  const showcaseSnapshot = await fetch(`${baseUrl}/api/showcase-snapshot?ticker=MSFT`);
  const showcaseBody = await showcaseSnapshot.json().catch(() => ({}));
  if (!showcaseSnapshot.ok) throw new Error(`Showcase snapshot failed: ${showcaseSnapshot.status}`);
  if (showcaseBody.researchPacket?.resolvedTicker !== "MSFT") {
    throw new Error("Showcase snapshot did not resolve MSFT.");
  }
  if (!showcaseBody.researchPacket?.dataTimestamp || !showcaseBody.researchPacket?.quoteSourceLabel) {
    throw new Error("Showcase snapshot missing timestamp or quote source.");
  }

  const events = await readSse(`${baseUrl}/api/debate?ticker=MSFT&question=smoke`);
  const names = events.map((event) => event.event);
  const session = events.find((event) => event.event === "session")?.data;
  const packet = events.find((event) => event.event === "research_packet_summary")?.data;
  const complete = events.find((event) => event.event === "complete")?.data;
  const reviewIndex = events.findIndex((event) => event.event === "message" && event.data?.agentId === "reviewer");
  const completeIndex = names.indexOf("complete");
  const firstMessageIndex = names.indexOf("message");
  const readyIndex = names.findIndex(
    (event, index) =>
      event === "research_stage" &&
      events[index].data?.stage === "ready_to_debate" &&
      events[index].data?.status === "complete"
  );

  assertHas(names, "session");
  assertHas(names, "research_stage");
  assertHas(names, "research_packet_summary");
  assertHas(names, "typing");
  assertHas(names, "message");
  assertHas(names, "conviction");
  assertHas(names, "complete");
  if (events.some((event) => event.event === "error")) throw new Error("Research flow emitted an error.");
  if (readyIndex === -1 || firstMessageIndex === -1 || readyIndex > firstMessageIndex) {
    throw new Error("Debate started before ready_to_debate completed.");
  }
  if (!session?.sessionId) throw new Error("Missing session id.");
  if (!packet?.readyForDebate || !packet.evidenceItems?.length) throw new Error("Missing research packet evidence.");
  if (!complete?.convictionHistory?.marcus || complete.convictionHistory.marcus.length < 2) {
    throw new Error("Conviction did not move during debate.");
  }
  if (reviewIndex === -1 || reviewIndex > completeIndex || !complete?.finalReview?.action_signal) {
    throw new Error("Final Review Officer did not complete before follow-up opened.");
  }

  const firstFollowUp = await postFollowUp(baseUrl, session.sessionId, "hey i dont think it is good");
  const secondFollowUp = await postFollowUp(baseUrl, session.sessionId, "any one else want to talk more?");
  const firstBodies = new Set(firstFollowUp.messages.map((message) => message.body));
  const secondAgents = new Set(secondFollowUp.messages.map((message) => message.agentId));

  if (secondFollowUp.messages.length < 2 || secondAgents.size < 2) {
    throw new Error("Open invitation follow-up did not select multiple analysts.");
  }
  if (secondFollowUp.messages.some((message) => firstBodies.has(message.body))) {
    throw new Error("Follow-up repeated an earlier response verbatim.");
  }
  if (!secondFollowUp.messages.every((message) => message.citedEvidenceIds?.length)) {
    throw new Error("Follow-up did not cite the session evidence packet.");
  }

  const oversized = await postRawFollowUp(baseUrl, {
    sessionId: session.sessionId,
    message: "x".repeat(10_000)
  });
  if (oversized.status !== 413 || oversized.body?.error?.code !== "payload_too_large") {
    throw new Error(`Expected oversized follow-up to fail with 413, got ${JSON.stringify(oversized)}`);
  }
}

async function runMissingKeyFlow(baseUrl) {
  const events = await readSse(`${baseUrl}/api/debate?ticker=MSFT&question=missing-key`);
  const names = events.map((event) => event.event);
  const error = events.find((event) => event.event === "error")?.data;
  const firstMessageIndex = names.indexOf("message");

  assertHas(names, "session");
  assertHas(names, "research_stage");
  assertHas(names, "research_packet_summary");
  assertHas(names, "error");
  if (error?.code !== "missing_openai_api_key") {
    throw new Error(`Expected missing_openai_api_key error, got ${JSON.stringify(error)}`);
  }
  if (firstMessageIndex !== -1) {
    throw new Error("Missing-key real mode emitted a debate message.");
  }
}

async function readSse(url) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Unexpected response: ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];
  const deadline = Date.now() + 25000;

  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      const event = parseEvent(part);
      if (event) events.push(event);
    }
    if (events.some((event) => event.event === "complete" || event.event === "error")) break;
  }

  if (buffer.trim()) {
    const event = parseEvent(buffer);
    if (event) events.push(event);
  }

  return events;
}

function parseEvent(block) {
  const lines = block.split("\n");
  const event = lines.find((line) => line.startsWith("event: "))?.slice(7);
  const data = lines.find((line) => line.startsWith("data: "))?.slice(6);
  if (!event) return null;
  return {
    event,
    data: data ? JSON.parse(data) : null
  };
}

function assertHas(names, event) {
  if (!names.includes(event)) throw new Error(`Missing SSE event: ${event}`);
}

async function postFollowUp(baseUrl, sessionId, message) {
  const response = await fetch(`${baseUrl}/api/followup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, message })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Follow-up failed: ${response.status} ${JSON.stringify(body)}`);
  }

  return body;
}

async function postRawFollowUp(baseUrl, payload) {
  const response = await fetch(`${baseUrl}/api/followup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  return {
    status: response.status,
    body: await response.json().catch(() => ({}))
  };
}
