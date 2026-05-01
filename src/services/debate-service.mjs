import crypto from "node:crypto";
import { agents, agentIds, getAgent } from "../domain/agents.mjs";
import { DebatePlanSchema, FinalReviewSchema, ModeratorSummarySchema } from "../domain/schemas.mjs";
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
      "Summarize genuine disagreement from the live debate. You synthesize and hand the room to the Final Review Officer.",
      "No target prices, order placement language, or personal portfolio sizing.",
      "Return strict JSON only."
    ].join("\n"),
    input: [
      `Ticker: ${researchPacket.resolvedTicker}`,
      `Research synthesis: ${JSON.stringify(synthesis)}`,
      `Transcript: ${JSON.stringify(transcript.map((message) => ({ speaker: message.name, body: message.body, citedEvidenceIds: message.citedEvidenceIds })))}`,
      `Final conviction: ${JSON.stringify(conviction)}`,
      "Return JSON with keys: top_live_disagreement, strongest_bull_point, strongest_bear_point, quant_view_added, macro_view_changed, unresolved_assumptions, final_conviction_snapshot."
    ].join("\n\n")
  });

  return ModeratorSummarySchema.parse({ ...json, final_conviction_snapshot: conviction });
}

export async function generateFinalReview({ researchPacket, synthesis, transcript, moderatorSummary, conviction }) {
  if (process.env.OPENAI_MOCK === "1") {
    return FinalReviewSchema.parse(mockFinalReview(researchPacket, synthesis, conviction));
  }

  requireOpenAIClient();
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const json = await createJsonResponse({
    model,
    reasoningEffort: "low",
    maxOutputTokens: 1500,
    schema: FinalReviewSchema,
    schemaName: "final_review",
    instructions: [
      "You are the Final Review Officer for The Floor, like an investment committee chair.",
      "Your job is to turn the debate into an explicit action signal with scoring and risk gates.",
      "Use exactly one action_signal enum value: buy, wait, avoid, reduce.",
      "action_score means how strongly the room supports the selected action from 0 to 100.",
      "risk_score means downside or uncertainty pressure from 0 to 100.",
      "evidence_score means how strong and complete the evidence packet is from 0 to 100.",
      "Be decisive, but tie every action to sourced evidence, debate disagreements, and falsifiable gates.",
      "No target prices, no order placement language, no personal portfolio sizing, and no fabricated evidence.",
      "Return strict JSON only."
    ].join("\n"),
    input: [
      `Ticker: ${researchPacket.resolvedTicker}`,
      `Research packet: ${JSON.stringify(researchPacket)}`,
      `Research synthesis: ${JSON.stringify(synthesis)}`,
      `Moderator summary: ${JSON.stringify(moderatorSummary)}`,
      `Transcript: ${JSON.stringify(transcript.map((message) => ({ speaker: message.name, body: message.body, citedEvidenceIds: message.citedEvidenceIds })))}`,
      `Final conviction: ${JSON.stringify(conviction)}`,
      "Return JSON with keys: action_signal, action_score, evidence_score, risk_score, time_horizon, evidence_grade, action_rationale, committee_verdict, primary_risk_gate, what_would_change_direction, next_diligence_steps, final_conviction_snapshot."
    ].join("\n\n")
  });

  return FinalReviewSchema.parse({ ...json, final_conviction_snapshot: conviction });
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

export function finalReviewToMessage(review, researchPacket) {
  const body = [
    `Final Review Officer on ${researchPacket.resolvedTicker}:`,
    "",
    `Action signal: ${actionLabel(review.action_signal)}`,
    `Action score: ${Math.round(review.action_score)}/100`,
    `Evidence score: ${Math.round(review.evidence_score)}/100`,
    `Risk score: ${Math.round(review.risk_score)}/100`,
    `Time horizon: ${review.time_horizon}`,
    `Evidence grade: ${review.evidence_grade}`,
    `Action rationale: ${review.action_rationale}`,
    `Committee verdict: ${review.committee_verdict}`,
    `Primary risk gate: ${review.primary_risk_gate}`,
    "",
    "What would change the direction:",
    ...(review.what_would_change_direction || []).map((item, index) => `${index + 1}. ${item}`),
    "",
    "Next diligence steps:",
    ...(review.next_diligence_steps || []).map((item, index) => `${index + 1}. ${item}`)
  ].join("\n");

  return {
    id: crypto.randomUUID(),
    agentId: "reviewer",
    name: "Final Review Officer",
    title: "IC Chair",
    short: "IC",
    color: "#f2c94c",
    timestamp: timestamp(),
    body,
    citations: ["moderator wrap", "debate transcript", "research packet", "conviction tracker"],
    citedEvidenceIds: researchPacket.evidenceItems.slice(0, 4).map((item) => item.evidenceId),
    bid: null,
    speakingIntent: "final_review",
    rationaleTag: "committee review",
    effects: {}
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
    "Handing the room to the Final Review Officer for action scoring."
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

function actionLabel(action) {
  return {
    buy: "BUY",
    wait: "WAIT",
    avoid: "AVOID",
    reduce: "REDUCE"
  }[action] || "WAIT";
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
    final_conviction_snapshot: conviction
  };
}

function mockFinalReview(packet, synthesis, conviction) {
  const averageConviction =
    Object.values(conviction).reduce((sum, value) => sum + Number(value || 0), 0) / Math.max(1, Object.values(conviction).length);
  const stats = packet.keyStats || {};
  const beta = Number(stats.beta);
  const trailingPe = Number(stats.trailingPE);
  const valuationPressure = Number.isFinite(trailingPe) && trailingPe > 45 ? 12 : 0;
  const betaPressure = Number.isFinite(beta) && beta > 1.6 ? 10 : 0;
  const riskScore = Math.max(0, Math.min(100, 42 - averageConviction * 0.7 + valuationPressure + betaPressure));
  const actionScore = Math.max(
    0,
    Math.min(100, 50 + averageConviction * 1.8 + (packet.dataCoverageScore - 70) * 0.35 - riskScore * 0.25)
  );
  const actionSignal =
    packet.dataCoverageScore < 55
      ? "avoid"
      : actionScore >= 68 && riskScore < 58
        ? "buy"
        : actionScore <= 38 || riskScore >= 72
          ? "reduce"
          : "wait";

  return {
    action_signal: actionSignal,
    action_score: Math.round(actionScore),
    evidence_score: packet.dataCoverageScore,
    risk_score: Math.round(riskScore),
    time_horizon: "Next 1-2 quarters; update after the next filing or material disclosure.",
    evidence_grade: packet.dataCoverageScore >= 80 ? "strong" : packet.dataCoverageScore >= 60 ? "mixed" : "weak",
    action_rationale:
      actionSignal === "buy"
        ? `BUY clears because the evidence packet is strong and the debate still leaves positive conviction after cash-flow, valuation, and risk challenges.`
        : actionSignal === "reduce"
          ? `REDUCE triggers because risk pressure or weak conviction outweighs the current upside case.`
          : actionSignal === "avoid"
            ? `AVOID triggers because the evidence packet is too thin to support an actionable long thesis.`
            : `WAIT is the right action because the bull case is live, but risk gates and missing direct evidence keep the score below a buy threshold.`,
    committee_verdict:
      actionSignal === "buy"
        ? `The committee would mark ${packet.resolvedTicker} as a buy-candidate on this packet, with the condition that cash flow and disclosure evidence keep backing the thesis.`
        : actionSignal === "reduce"
          ? `The committee would reduce exposure until valuation, cash quality, or macro risk stops dominating the upside case.`
          : actionSignal === "avoid"
            ? `The committee would avoid acting on the long case because the evidence bar is not met.`
            : `The committee view is balanced: ${synthesis.bull_thesis.summary} is live, but ${synthesis.bear_thesis.summary} keeps the evidence bar high.`,
    primary_risk_gate: synthesis.key_uncertainties?.[0] || "Whether future evidence directly confirms demand, cash conversion, and disclosure quality.",
    what_would_change_direction: [
      "A cleaner direct-demand indicator rather than only proxy metrics.",
      "Sustained cash conversion and margin evidence in the next data packet.",
      "Disclosure or policy developments that materially narrow or widen the risk case."
    ],
    next_diligence_steps: [
      "Compare the Data tab metrics against the next quarterly filing.",
      "Read the most recent 10-K or 10-Q risk factors and MD&A sections.",
      "Ask each analyst which specific metric would force a conviction update."
    ],
    final_conviction_snapshot: conviction
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
