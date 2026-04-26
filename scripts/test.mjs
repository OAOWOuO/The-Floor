import assert from "node:assert/strict";
import { sanitizeTicker } from "../src/utils/sanitize.mjs";
import { resolveTicker } from "../src/services/ticker-resolver.mjs";
import { fetchMarketData } from "../src/services/market-data-service.mjs";
import { fetchDisclosureData } from "../src/services/disclosure-service.mjs";
import { buildResearchPacket } from "../src/services/research-packet-service.mjs";
import { createConvictionState, applyConvictionDelta } from "../src/services/conviction-service.mjs";
import { synthesizeResearch } from "../src/services/synthesis-service.mjs";
import { AppError } from "../src/utils/errors.mjs";

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

const resolution = await resolveTicker("MSFT");
assert.equal(resolution.resolvedTicker, "MSFT");

const marketData = await fetchMarketData(resolution);
const disclosureData = await fetchDisclosureData(resolution, marketData);
const packet = buildResearchPacket({ resolution, marketData, disclosureData });
assert.equal(packet.readyForDebate, true);
assert.ok(packet.evidenceItems.length >= 5);
assert.ok(packet.latestPrice > 0);
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

const synthesis = await synthesizeResearch({ researchPacket: packet, question: "smoke" });
assert.ok(synthesis.company_snapshot.includes("MSFT"));
assert.notEqual(synthesis.initial_conviction_scores.marcus, synthesis.initial_conviction_scores.yara);

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
