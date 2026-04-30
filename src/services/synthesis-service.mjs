import { agents, agentIds } from "../domain/agents.mjs";
import { ResearchSynthesisSchema } from "../domain/schemas.mjs";
import { createJsonResponse, requireOpenAIClient } from "./openai-service.mjs";

export async function synthesizeResearch({ researchPacket, question }) {
  if (process.env.OPENAI_MOCK === "1") {
    return ResearchSynthesisSchema.parse(mockSynthesis(researchPacket, question));
  }

  requireOpenAIClient();
  const model = process.env.OPENAI_RESEARCH_MODEL || process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const json = await createJsonResponse({
    model,
    reasoningEffort: process.env.OPENAI_RESEARCH_REASONING || "medium",
    maxOutputTokens: 3400,
    schema: ResearchSynthesisSchema,
    schemaName: "research_synthesis",
    instructions: [
      "You are the research synthesis desk for The Floor.",
      "Convert a normalized stock research packet into strict JSON for a live multi-agent debate.",
      "Use only evidence in the packet. Do not fabricate filings, metrics, news, price targets, or recommendations.",
      "Never give buy/sell/hold advice. Do not expose chain-of-thought.",
      "Each thesis must cite evidenceIds from the packet. If coverage is weak, constrain disallowed claims."
    ].join("\n"),
    input: [
      `Ticker: ${researchPacket.resolvedTicker}`,
      `User question: ${question || "none"}`,
      `Analyst personas: ${JSON.stringify(agents)}`,
      `Research packet: ${JSON.stringify(researchPacket)}`,
      `Return one JSON object with keys: company_snapshot, bull_thesis {summary,evidenceIds}, bear_thesis {summary,evidenceIds}, quant_flags [{flag,evidenceIds}], macro_flags [{flag,evidenceIds}], skeptic_questions, key_uncertainties, analyst_priors {${agentIds.join(",")}}, initial_conviction_scores {${agentIds.join(",")}}, evidence_map, open_questions_for_debate, disallowed_claims.`,
      "Every analyst prior must be distinct and tied to that analyst's category. New specialist agents should add accounting, regulatory, supply-chain, and credit/liquidity constraints when evidence supports them."
    ].join("\n\n")
  });

  return ResearchSynthesisSchema.parse(json);
}

function mockSynthesis(packet, question) {
  const ids = packet.evidenceItems.map((item) => item.evidenceId);
  const first = ids[0] || "E01";
  const profile = ids[1] || first;
  const fundamentals = ids[2] || first;
  const stats = ids[3] || fundamentals;
  const price = ids[4] || first;
  const disclosure = ids[5] || profile;
  const growth = finiteNumber(packet.keyStats?.revenueGrowth, 0);
  const margin = finiteNumber(packet.keyStats?.grossMargins, 0);
  const fcf = finiteNumber(packet.keyStats?.freeCashflow, 0);
  const beta = finiteNumber(packet.keyStats?.beta, 1);
  const totalDebt = finiteNumber(packet.keyStats?.totalDebt, 0);
  const disclosureAvailable = Boolean(packet.filingOrDisclosureSummary?.available);
  const questionFrame = question ? ` The user's frame is "${question}".` : "";

  return {
    company_snapshot: `${packet.displayName} (${packet.resolvedTicker}) is a ${packet.sector || "public-market"} company with ${packet.currency || "unknown"} quote data and coverage score ${packet.dataCoverageScore}.${questionFrame}`,
    bull_thesis: {
      summary: `Marcus can argue that real fundamentals and scale matter: revenue growth is ${formatPct(growth)}, gross margin is ${formatPct(margin)}, and the profile evidence supports a durable operating story.`,
      evidenceIds: [profile, fundamentals].filter(Boolean)
    },
    bear_thesis: {
      summary: `Yara can attack valuation quality and cash conversion, especially if free cash flow and multiples do not justify the narrative.`,
      evidenceIds: [fundamentals, stats].filter(Boolean)
    },
    quant_flags: [
      {
        flag: `Beta near ${Number.isFinite(beta) ? beta : "unknown"} and six-month price context require wider error bars.`,
        evidenceIds: [stats, price].filter(Boolean)
      }
    ],
    macro_flags: [
      {
        flag: `${packet.sector || "The sector"} exposure should be separated from discount-rate, FX, and cycle risk.`,
        evidenceIds: [profile, first].filter(Boolean)
      }
    ],
    skeptic_questions: [
      "Which claims are direct evidence and which are proxies?",
      "What observation would force each analyst to lower conviction?",
      "Are filings/disclosures strong enough to support claims about accounting quality?"
    ],
    key_uncertainties: [
      "Whether fundamentals are improving because of durable demand or late-cycle model optimism.",
      "Whether cash conversion supports the equity narrative.",
      "Whether macro conditions change valuation patience."
    ],
    analyst_priors: {
      marcus: "Starts constructive because growth and profile evidence can support operating leverage.",
      yara: "Starts skeptical until cash conversion and disclosure evidence carry the narrative.",
      kenji: "Starts near neutral, demanding measured distribution and base-rate evidence.",
      sofia: "Starts modestly conditional, watching sector cycle and discount-rate transmission.",
      priya: "Starts with an accounting-quality lens, watching cash conversion, margins, working capital proxies, and disclosure support.",
      lucas: "Starts cautious on legal and policy risk, especially where disclosures or sector exposure create regulatory constraints.",
      mei: "Starts operationally conditional, looking for supply capacity, inventory, and bottleneck evidence before endorsing demand narratives.",
      omar: "Starts from liquidity and leverage, testing whether the balance sheet can absorb a harsher funding environment.",
      skeptic: "Starts neutral and will attack unsupported assumptions rather than direction."
    },
    initial_conviction_scores: {
      marcus: clamp(Math.round(18 + growth * 55 + margin * 10), -100, 100),
      yara: clamp(Math.round(-12 - (fcf ? 4 : 14)), -100, 100),
      kenji: clamp(Math.round(beta > 1.25 ? -8 : 4), -100, 100),
      sofia: packet.sector === "Technology" ? 6 : 0,
      priya: clamp(Math.round((fcf > 0 ? 6 : -10) + (margin > 0.35 ? 4 : 0)), -100, 100),
      lucas: disclosureAvailable ? -2 : -8,
      mei: /technology|consumer|industrial/i.test(packet.sector || "") ? 3 : 0,
      omar: clamp(Math.round(totalDebt > 0 && fcf <= 0 ? -12 : totalDebt > 0 ? -4 : 4), -100, 100),
      skeptic: 0
    },
    evidence_map: Object.fromEntries(packet.evidenceItems.map((item) => [item.evidenceId, item.claim])),
    open_questions_for_debate: [
      "Are growth and margin evidence enough to justify confidence?",
      "Does cash flow support or undermine the story?",
      "Which macro variable most changes the debate?"
    ],
    disallowed_claims: packet.dataCoverageScore < 75
      ? ["Do not claim direct customer demand, renewal rates, or workload usage unless explicit evidence exists."]
      : []
  };
}

function formatPct(value) {
  if (!Number.isFinite(value)) return "unknown";
  return `${Math.round((Math.abs(value) <= 2 ? value * 100 : value) * 10) / 10}%`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
