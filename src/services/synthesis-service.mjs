import { agents } from "../domain/agents.mjs";
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
    maxOutputTokens: 2600,
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
      "Return one JSON object with keys: company_snapshot, bull_thesis {summary,evidenceIds}, bear_thesis {summary,evidenceIds}, quant_flags [{flag,evidenceIds}], macro_flags [{flag,evidenceIds}], skeptic_questions, key_uncertainties, analyst_priors {marcus,yara,kenji,sofia,skeptic}, initial_conviction_scores {marcus,yara,kenji,sofia,skeptic}, evidence_map, open_questions_for_debate, disallowed_claims."
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
  const growth = Number(packet.keyStats?.revenueGrowth || 0);
  const margin = Number(packet.keyStats?.grossMargins || 0);
  const fcf = Number(packet.keyStats?.freeCashflow || 0);
  const beta = Number(packet.keyStats?.beta || 1);
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
      skeptic: "Starts neutral and will attack unsupported assumptions rather than direction."
    },
    initial_conviction_scores: {
      marcus: clamp(Math.round(18 + growth * 55 + margin * 10), -100, 100),
      yara: clamp(Math.round(-12 - (fcf ? 4 : 14)), -100, 100),
      kenji: clamp(Math.round(beta > 1.25 ? -8 : 4), -100, 100),
      sofia: packet.sector === "Technology" ? 6 : 0,
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
