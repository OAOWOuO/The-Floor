import { AppError } from "../utils/errors.mjs";
import { resolveTicker } from "./ticker-resolver.mjs";
import { fetchMarketData } from "./market-data-service.mjs";
import { fetchDisclosureData } from "./disclosure-service.mjs";
import { buildResearchPacket, summarizeResearchPacket } from "./research-packet-service.mjs";

export async function buildShowcaseSnapshot({ ticker }) {
  const resolution = await resolveTicker(ticker);
  const marketData = await fetchMarketData(resolution);
  const disclosureData = await fetchDisclosureData(resolution, marketData);
  const packet = buildResearchPacket({ resolution, marketData, disclosureData });

  if (!packet.readyForDebate) {
    throw new AppError(
      "showcase_snapshot_insufficient_data",
      `Could not build a sourced showcase snapshot for ${resolution.resolvedTicker}. The app will not show stale saved prices.`,
      422,
      { researchWarnings: packet.researchWarnings, likelyMatches: packet.likelyMatches }
    );
  }

  const summary = summarizeResearchPacket(packet);
  const capturedAt = marketData.fetchedAt || new Date().toISOString();
  const quoteSourceLabel = marketData.quoteSourceLabel || "Yahoo Finance market data";

  return {
    mode: "showcase_snapshot",
    capturedAt,
    sourcePolicy:
      "Showcase financial data is captured server-side from market/disclosure sources when playback starts. The debate script is illustrative; the Data tab is the audited snapshot.",
    researchPacket: {
      ...summary,
      dataTimestamp: capturedAt,
      quoteSourceLabel,
      quoteSourceUrl: marketData.quoteSourceUrl || summary.quoteSourceUrl || null,
      snapshotPolicy:
        "Captured when Play showcase was pressed. Quotes may be delayed by the upstream provider; no stale saved prices are used.",
      companySnapshot:
        `${summary.displayName} (${summary.resolvedTicker}) snapshot captured at ${capturedAt} from ${quoteSourceLabel}.`,
      researchWarnings: [
        ...new Set([
          ...(summary.researchWarnings || []),
          `Showcase quote snapshot captured at ${capturedAt}.`,
          "Quotes and fundamentals may be delayed by the upstream provider."
        ])
      ]
    }
  };
}
