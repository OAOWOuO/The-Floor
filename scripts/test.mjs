import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sanitizeTicker } from "../src/utils/sanitize.mjs";
import { agentIds } from "../src/domain/agents.mjs";
import { resolveTicker } from "../src/services/ticker-resolver.mjs";
import { fetchMarketData } from "../src/services/market-data-service.mjs";
import { fetchDisclosureData } from "../src/services/disclosure-service.mjs";
import { buildResearchPacket } from "../src/services/research-packet-service.mjs";
import { buildShowcaseSnapshot } from "../src/services/showcase-snapshot-service.mjs";
import { createConvictionState, applyConvictionDelta } from "../src/services/conviction-service.mjs";
import { synthesizeResearch } from "../src/services/synthesis-service.mjs";
import { AppError } from "../src/utils/errors.mjs";
import { clientKey, createRateLimiter } from "../src/utils/rate-limit.mjs";
import { toNumber } from "../src/utils/math.mjs";

const originalFixture = process.env.THE_FLOOR_FIXTURE_MODE;
const originalMock = process.env.OPENAI_MOCK;
const originalKey = process.env.OPENAI_API_KEY;

process.env.THE_FLOOR_FIXTURE_MODE = "1";
process.env.OPENAI_MOCK = "1";
process.env.OPENAI_API_KEY = "test";

assert.equal(sanitizeTicker(" brk-b "), "BRK-B");
assert.equal(sanitizeTicker(" 7203.T "), "7203.T");
assert.equal(sanitizeTicker("$nvda<script>"), "NVDASCRIPT");
assert.equal(sanitizeTicker(""), "");
assert.equal(toNumber(null), null);
assert.equal(toNumber(undefined), null);
assert.equal(toNumber(""), null);
assert.equal(toNumber(0), 0);

const resolution = await resolveTicker("MSFT");
assert.equal(resolution.resolvedTicker, "MSFT");

const marketData = await fetchMarketData(resolution);
const disclosureData = await fetchDisclosureData(resolution, marketData);
const packet = buildResearchPacket({ resolution, marketData, disclosureData });
assert.equal(packet.readyForDebate, true);
assert.ok(packet.evidenceItems.length >= 5);
assert.ok(packet.latestPrice > 0);
assert.ok(packet.dataTimestamp);
assert.ok(packet.quoteSourceLabel);
assert.ok(packet.dataCoverageScore >= 80);
assert.equal(packet.keyStats.secFiscalYear, 2025);
assert.equal(packet.keyStats.secFiscalPeriod, "FY");
assert.equal(packet.keyStats.secPeriodEnd, "2025-12-31");

const weakPacket = buildResearchPacket({
  resolution,
  marketData: {
    quote: { symbol: "MSFT" },
    summary: {},
    chart: null,
    fetchedAt: new Date().toISOString()
  },
  disclosureData: { available: false, summary: "none", recentFilings: [], warnings: [] }
});
assert.equal(weakPacket.readyForDebate, false);

const conviction = createConvictionState({ marcus: 99, yara: -99, kenji: 0, sofia: 5, skeptic: 0 });
const update = applyConvictionDelta(conviction, { marcus: 10, yara: -10, kenji: 3 }, "test delta");
assert.equal(update.conviction.marcus, 100);
assert.equal(update.conviction.yara, -100);
assert.equal(update.convictionHistory.kenji.length, 2);
for (const agentId of agentIds) {
  assert.ok(agentId in update.conviction, `Missing conviction agent ${agentId}`);
}

const mockRequest = { headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.1" }, socket: {} };
assert.equal(clientKey(mockRequest), "203.0.113.10");
const limiter = createRateLimiter({ name: "unit", windowMs: 1000, max: 2 });
assert.equal(limiter.consume(mockRequest, { now: 100 }).remaining, 1);
assert.equal(limiter.consume(mockRequest, { now: 200 }).remaining, 0);
assert.throws(
  () => limiter.consume(mockRequest, { now: 300 }),
  (error) => error instanceof AppError && error.code === "rate_limited" && error.statusCode === 429
);
assert.equal(limiter.consume(mockRequest, { now: 1200 }).remaining, 1);

const synthesis = await synthesizeResearch({ researchPacket: packet, question: "smoke" });
assert.ok(synthesis.company_snapshot.includes("MSFT"));
assert.notEqual(synthesis.initial_conviction_scores.marcus, synthesis.initial_conviction_scores.yara);
for (const agentId of agentIds) {
  assert.ok(agentId in synthesis.analyst_priors, `Missing synthesis prior for ${agentId}`);
  assert.ok(agentId in synthesis.initial_conviction_scores, `Missing synthesis conviction for ${agentId}`);
}

const showcase = await buildShowcaseSnapshot({ ticker: "MSFT" });
assert.equal(showcase.mode, "showcase_snapshot");
assert.equal(showcase.researchPacket.resolvedTicker, "MSFT");
assert.ok(showcase.researchPacket.latestPrice > 0);
assert.ok(showcase.researchPacket.dataTimestamp);
assert.ok(showcase.researchPacket.snapshotPolicy.includes("Captured"));

const replayFile = JSON.parse(await readFile("public/showcases/replays.json", "utf8"));
for (const ticker of ["NVDA", "MSFT", "TSLA", "AMD"]) {
  const replay = replayFile.replays?.[ticker];
  assert.ok(replay, `Missing showcase replay for ${ticker}`);
  assert.ok(replay.initialConviction, `Missing initial conviction for ${ticker}`);
  for (const agentId of agentIds) {
    assert.ok(agentId in replay.initialConviction, `Missing showcase conviction ${agentId} for ${ticker}`);
  }
  assert.equal(replay.metrics, undefined, `Showcase replay must not store stale metrics for ${ticker}`);
  assert.equal(replay.researchPacket, undefined, `Showcase replay must not store stale research packet for ${ticker}`);
  assert.equal(replay.turns, undefined, `Showcase replay must not store scripted financial turns for ${ticker}`);
}
assert.ok(replayFile.sourcePolicy.includes("contains no stock prices"));

process.env.OPENAI_MOCK = "";
delete process.env.OPENAI_API_KEY;
await assert.rejects(
  () => synthesizeResearch({ researchPacket: packet, question: "missing key" }),
  (error) => error instanceof AppError && error.code === "missing_openai_api_key"
);

restoreEnv();
console.log("Unit tests passed.");
process.exit(0);

function restoreEnv() {
  setEnv("THE_FLOOR_FIXTURE_MODE", originalFixture);
  setEnv("OPENAI_MOCK", originalMock);
  setEnv("OPENAI_API_KEY", originalKey);
}

function setEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
