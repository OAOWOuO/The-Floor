import crypto from "node:crypto";
import { agents, agentIds, getAgent } from "../domain/agents.mjs";
import { DebatePlanSchema, ModeratorSummarySchema } from "../domain/schemas.mjs";
import { timestamp } from "../utils/time.mjs";
import { createJsonResponse, requireOpenAIClient } from "./openai-service.mjs";

const intents = ["attack", "defend", "reframe", "quantify", "contextualize", "challenge_assumption"];

export async function generateDebatePlan({ researchPacket, synthesis, question }) {
  if (process.env.OPENAI_MOCK === "1") {
    return DebatePlanSchema.parse(mockDebatePlan(researchPacket, synthesis));
  }

  requireOpenAIClient();
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const json = await createJsonResponse({
    model,
    reasoningEffort: process.env.OPENAI_DEBATE_REASONING || "low",
    maxOutputTokens: 4800,
    schema: DebatePlanSchema,
    schemaName: "debate_plan",
    instructions: [
      "You are The Floor debate orchestrator.",
      "Generate a 10 to 14 turn live group chat debate from the research synthesis and evidence packet.",
      "Use distinct voices across the expanded desk: Marcus, Yara, Kenji, Sofia, Priya, Lucas, Mei, Omar, and The Skeptic.",
      "Use at least seven distinct speakers when possible, including at least two specialist analysts from Priya, Lucas, Mei, and Omar.",
      "No speaker may talk twice in a row. Each substantive turn cites at least one evidenceId unless explicitly attacking missing evidence.",
      "Every turn must include convictionDeltaByAgent with small deltas for one or more analysts.",
      "No buy/sell/hold recommendations, target prices, personalized advice, or fabricated evidence.",
      "Return strict JSON only."
    ].join("\n"),
    input: [
      `Ticker: ${researchPacket.resolvedTicker}`,
      `User question: ${question || "none"}`,
      `Personas: ${JSON.stringify(agents)}`,
      `Research synthesis: ${JSON.stringify(synthesis)}`,
      `Evidence items: ${JSON.stringify(researchPacket.evidenceItems)}`,
      "Return JSON: {\"turns\":[{\"turnNumber\":1,\"speakerId\":\"marcus\",\"targetId\":null,\"speakingIntent\":\"defend\",\"message\":\"...\",\"citedEvidenceIds\":[\"E01\"],\"convictionDeltaByAgent\":{\"marcus\":3},\"rationaleTag\":\"revision momentum strengthened\",\"shouldTriggerSkepticWeighting\":false}]}"
    ].join("\n\n")
  });

  return DebatePlanSchema.parse(repairDebatePlan(json, researchPacket));
}

export async function generateModeratorSummary({ researchPacket, synthesis, transcript, conviction }) {
  if (process.env.OPENAI_MOCK === "1") {
    return ModeratorSummarySchema.parse(mockModeratorSummary(researchPacket, synthesis, conviction));
  }

  requireOpenAIClient();
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const json = await createJsonResponse({
    model,
    reasoningEffort: "low",
    maxOutputTokens: 1600,
    schema: ModeratorSummarySchema,
    schemaName: "moderator_summary",
    instructions: [
      "You are the Moderator for The Floor.",
      "Summarize genuine disagreement from the live debate. You synthesize; you do not recommend.",
      "No buy/sell/hold advice, target prices, or personalized financial advice.",
      "Return strict JSON only."
    ].join("\n"),
    input: [
      `Ticker: ${researchPacket.resolvedTicker}`,
      `Research synthesis: ${JSON.stringify(synthesis)}`,
      `Transcript: ${JSON.stringify(transcript.map((message) => ({ speaker: message.name, body: message.body, citedEvidenceIds: message.citedEvidenceIds })))}`,
      `Final conviction: ${JSON.stringify(conviction)}`,
      "Return JSON with keys: top_live_disagreement, strongest_bull_point, strongest_bear_point, quant_view_added, macro_view_changed, unresolved_assumptions, final_conviction_snapshot, not_financial_advice."
    ].join("\n\n")
  });

  return ModeratorSummarySchema.parse({ ...json, final_conviction_snapshot: conviction });
}

export function turnToMessage(turn, researchPacket) {
  const agent = getAgent(turn.speakerId);
  const target = turn.targetId ? getAgent(turn.targetId) : null;
  const prefix = target ? `@${target.name} ` : "";

  return {
    id: crypto.randomUUID(),
    agentId: agent.id,
    name: agent.name,
    title: agent.title,
    short: agent.short,
    color: agent.color,
    timestamp: timestamp(),
    body: `${prefix}${turn.message}`.trim(),
    citations: evidenceLabels(researchPacket, turn.citedEvidenceIds),
    citedEvidenceIds: turn.citedEvidenceIds,
    bid: {
      score: inferBidScore(turn),
      reason: turn.rationaleTag
    },
    speakingIntent: turn.speakingIntent,
    rationaleTag: turn.rationaleTag,
    effects: turn.convictionDeltaByAgent
  };
}

export function moderatorToMessage(summary, researchPacket) {
  const body = [
    `Moderator wrap on ${researchPacket.resolvedTicker}:`,
    "",
    `Top live disagreement: ${summary.top_live_disagreement}`,
    `Strongest bull point: ${summary.strongest_bull_point}`,
    `Strongest bear point: ${summary.strongest_bear_point}`,
    `Quant added: ${summary.quant_view_added}`,
    `Macro changed: ${summary.macro_view_changed}`,
    "",
    "Unresolved assumptions:",
    ...(summary.unresolved_assumptions || []).map((item, index) => `${index + 1}. ${item}`),
    "",
    `Final conviction snapshot: ${Object.entries(summary.final_conviction_snapshot)
      .map(([agentId, value]) => `${getAgent(agentId)?.name || agentId} ${value >= 0 ? "+" : ""}${value}`)
      .join(" | ")}`,
    "",
    summary.not_financial_advice || "This is educational analysis, not financial advice."
  ].join("\n");

  return {
    id: crypto.randomUUID(),
    agentId: "moderator",
    name: "Moderator",
    title: "Desk Chair",
    short: "MOD",
    color: "#d9e1ea",
    timestamp: timestamp(),
    body,
    citations: ["debate transcript", "research packet", "conviction tracker"],
    citedEvidenceIds: researchPacket.evidenceItems.slice(0, 3).map((item) => item.evidenceId),
    bid: null,
    speakingIntent: "synthesize",
    rationaleTag: "moderator synthesis",
    effects: {}
  };
}

function repairDebatePlan(json, packet) {
  const turns = Array.isArray(json?.turns) ? json.turns.slice(0, 14) : [];
  const fallbackEvidence = packet.evidenceItems[0]?.evidenceId || "E01";

  for (const [index, turn] of turns.entries()) {
    turn.turnNumber = index + 1;
    if (!agentIds.includes(turn.speakerId)) turn.speakerId = agentIds[index % agentIds.length];
    if (index > 0 && turn.speakerId === turns[index - 1].speakerId) {
      turn.speakerId = agentIds.find((id) => id !== turns[index - 1].speakerId) || "marcus";
    }
    if (!intents.includes(turn.speakingIntent)) turn.speakingIntent = "reframe";
    if (!Array.isArray(turn.citedEvidenceIds) || !turn.citedEvidenceIds.length) {
      turn.citedEvidenceIds = [fallbackEvidence];
    }
    if (!turn.rationaleTag) turn.rationaleTag = "evidence updated conviction";
    if (!turn.convictionDeltaByAgent || typeof turn.convictionDeltaByAgent !== "object") {
      turn.convictionDeltaByAgent = { [turn.speakerId]: turn.speakerId === "yara" ? -2 : 2 };
    }
  }

  return { turns };
}

function mockDebatePlan(packet, synthesis) {
  const evidence = packet.evidenceItems.map((item) => item.evidenceId);
  const e = (index) => evidence[index] || evidence[0] || "E01";

  return {
    turns: [
      {
        turnNumber: 1,
        speakerId: "marcus",
        targetId: null,
        speakingIntent: "defend",
        message: `${packet.displayName} gives me something real to underwrite: ${synthesis.bull_thesis.summary} The key is whether the evidence keeps moving faster than valuation anxiety.`,
        citedEvidenceIds: [e(1), e(2)],
        convictionDeltaByAgent: { marcus: 5, sofia: 1 },
        rationaleTag: "growth evidence strengthened",
        shouldTriggerSkepticWeighting: false
      },
      {
        turnNumber: 2,
        speakerId: "yara",
        targetId: "marcus",
        speakingIntent: "attack",
        message: `I will not let profile language become proof. The bear case is cash conversion and quality: ${synthesis.bear_thesis.summary}`,
        citedEvidenceIds: [e(2), e(3)],
        convictionDeltaByAgent: { yara: -5, marcus: -2 },
        rationaleTag: "cash-flow concern increased",
        shouldTriggerSkepticWeighting: false
      },
      {
        turnNumber: 3,
        speakerId: "kenji",
        targetId: null,
        speakingIntent: "quantify",
        message: `Data first. ${synthesis.quant_flags[0]?.flag || "The distribution needs wider error bars."} The debate should be scored on measurable variance, not volume.`,
        citedEvidenceIds: [e(3), e(4)],
        convictionDeltaByAgent: { kenji: 3, marcus: -1, yara: 1 },
        rationaleTag: "uncertainty widened",
        shouldTriggerSkepticWeighting: false
      },
      {
        turnNumber: 4,
        speakerId: "priya",
        targetId: "yara",
        speakingIntent: "quantify",
        message: `Quality of earnings needs its own lane. I would not call the accounting clean or dirty from summary fields alone, but cash conversion, margins, and disclosures define the burden of proof.`,
        citedEvidenceIds: [e(2), e(5)],
        convictionDeltaByAgent: { priya: -2, yara: -1, marcus: -1 },
        rationaleTag: "accounting quality burden added",
        shouldTriggerSkepticWeighting: false
      },
      {
        turnNumber: 5,
        speakerId: "sofia",
        targetId: "kenji",
        speakingIntent: "contextualize",
        message: `The single-name question needs a regime frame. ${synthesis.macro_flags[0]?.flag || "Rates, FX, and liquidity decide how much patience this story receives."}`,
        citedEvidenceIds: [e(0), e(1)],
        convictionDeltaByAgent: { sofia: 4, marcus: -1 },
        rationaleTag: "macro channel named",
        shouldTriggerSkepticWeighting: false
      },
      {
        turnNumber: 6,
        speakerId: "mei",
        targetId: "marcus",
        speakingIntent: "reframe",
        message: `Demand narratives still have to pass an operations check. The packet gives profile and price evidence; it does not automatically give supplier capacity, lead times, inventory turns, or unit availability.`,
        citedEvidenceIds: [e(1), e(4)],
        convictionDeltaByAgent: { mei: 2, marcus: -1, skeptic: 1 },
        rationaleTag: "supply-chain evidence gap named",
        shouldTriggerSkepticWeighting: false
      },
      {
        turnNumber: 7,
        speakerId: "lucas",
        targetId: "sofia",
        speakingIntent: "contextualize",
        message: `Policy risk is not a vibe. If disclosures are thin, we label that limitation. If disclosures are present, we separate actual filed risks from generic antitrust or export-control anxiety.`,
        citedEvidenceIds: [e(1), e(5)],
        convictionDeltaByAgent: { lucas: -1, sofia: 1 },
        rationaleTag: "regulatory evidence separated",
        shouldTriggerSkepticWeighting: false
      },
      {
        turnNumber: 8,
        speakerId: "omar",
        targetId: "yara",
        speakingIntent: "attack",
        message: `I care less about the story than the funding window. If cash flow weakens while leverage or beta is elevated, equity optionality can vanish before the narrative gets disproven.`,
        citedEvidenceIds: [e(2), e(3), e(4)],
        convictionDeltaByAgent: { omar: -3, yara: 1, marcus: -1 },
        rationaleTag: "liquidity risk added",
        shouldTriggerSkepticWeighting: false
      },
      {
        turnNumber: 9,
        speakerId: "skeptic",
        targetId: null,
        speakingIntent: "challenge_assumption",
        message: `Everyone is sliding between proxies and direct evidence. ${synthesis.skeptic_questions[0] || "Which claim is direct and which is inferred?"}`,
        citedEvidenceIds: [e(0)],
        convictionDeltaByAgent: { marcus: -3, yara: 1, sofia: -2, priya: 1, mei: 1, skeptic: 1 },
        rationaleTag: "assumption challenged",
        shouldTriggerSkepticWeighting: true
      },
      {
        turnNumber: 10,
        speakerId: "marcus",
        targetId: "skeptic",
        speakingIntent: "defend",
        message: `Fair, but investment debates rarely hand you perfect direct evidence. The question is whether the observable evidence is good enough to keep the upside case alive.`,
        citedEvidenceIds: [e(1), e(2)],
        convictionDeltaByAgent: { marcus: 3 },
        rationaleTag: "bull case narrowed",
        shouldTriggerSkepticWeighting: false
      },
      {
        turnNumber: 11,
        speakerId: "yara",
        targetId: "marcus",
        speakingIntent: "attack",
        message: `Then make the claim falsifiable. If cash flow, disclosures, or quality metrics fail to back the story, the multiple is borrowing credibility from the future.`,
        citedEvidenceIds: [e(2), e(5)],
        convictionDeltaByAgent: { yara: -4, marcus: -1 },
        rationaleTag: "quality hurdle raised",
        shouldTriggerSkepticWeighting: false
      },
      {
        turnNumber: 12,
        speakerId: "kenji",
        targetId: "yara",
        speakingIntent: "reframe",
        message: `I would turn that into a scoreboard: growth, margin, cash conversion, price distribution, disclosure quality, regulatory constraint, supply constraint, and liquidity risk. Each analyst has to update when a row moves.`,
        citedEvidenceIds: [e(2), e(3), e(4)],
        convictionDeltaByAgent: { kenji: 2, priya: 1, lucas: 1, mei: 1, omar: 1, skeptic: 1 },
        rationaleTag: "measurement discipline added",
        shouldTriggerSkepticWeighting: false
      },
      {
        turnNumber: 13,
        speakerId: "sofia",
        targetId: null,
        speakingIntent: "contextualize",
        message: `Cycle transmission matters. A company can execute and still see valuation patience change if the rate or liquidity channel moves against it.`,
        citedEvidenceIds: [e(0), e(4)],
        convictionDeltaByAgent: { sofia: 3, marcus: -1, yara: 1 },
        rationaleTag: "discount-rate risk added",
        shouldTriggerSkepticWeighting: false
      },
      {
        turnNumber: 14,
        speakerId: "skeptic",
        targetId: null,
        speakingIntent: "challenge_assumption",
        message: `The unresolved issue is not who sounds smarter or who added the most categories. It is what evidence would reverse them. Without that, conviction is branding.`,
        citedEvidenceIds: [e(0)],
        convictionDeltaByAgent: { marcus: -2, yara: 1, sofia: -1, priya: 1, lucas: 1, mei: 1, omar: 1, skeptic: 1 },
        rationaleTag: "falsifiability demanded",
        shouldTriggerSkepticWeighting: true
      }
    ]
  };
}

function mockModeratorSummary(packet, synthesis, conviction) {
  return {
    top_live_disagreement: "Whether observable growth and profile evidence are enough, or whether cash conversion and disclosure quality must lead before conviction rises.",
    strongest_bull_point: synthesis.bull_thesis.summary,
    strongest_bear_point: synthesis.bear_thesis.summary,
    quant_view_added: synthesis.quant_flags[0]?.flag || "The room needs base rates and error bars.",
    macro_view_changed: synthesis.macro_flags[0]?.flag || "Macro risk changes valuation patience even when company execution is sound.",
    unresolved_assumptions: synthesis.skeptic_questions.slice(0, 3),
    final_conviction_snapshot: conviction,
    not_financial_advice: "This is educational analysis and a debate map, not financial advice or a recommendation."
  };
}

function evidenceLabels(packet, evidenceIds = []) {
  const byId = new Map(packet.evidenceItems.map((item) => [item.evidenceId, item]));
  return evidenceIds.map((id) => {
    const item = byId.get(id);
    return item ? `${id} · ${item.sourceLabel}` : id;
  });
}

function inferBidScore(turn) {
  if (turn.shouldTriggerSkepticWeighting) return 9.2;
  if (turn.speakingIntent === "attack" || turn.speakingIntent === "challenge_assumption") return 8.4;
  return 7.6;
}
