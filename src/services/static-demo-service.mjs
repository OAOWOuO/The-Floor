import crypto from "node:crypto";
import { publicAgents, getAgent } from "../domain/agents.mjs";
import { timestamp } from "../utils/time.mjs";
import { createConvictionState, applyConvictionDelta } from "./conviction-service.mjs";

export async function streamStaticDemo({ response, session, writeEvent, sleep, debateRuntimeMs }) {
  const packet = buildStaticPacket(session.ticker);
  const convictionState = createConvictionState({
    marcus: 34,
    yara: -29,
    kenji: 0,
    sofia: 8,
    skeptic: 0
  });
  session.researchPacket = packet;
  session.convictionState = convictionState;

  writeEvent(response, "session", {
    sessionId: session.id,
    ticker: session.ticker,
    question: session.question,
    agents: publicAgents,
    mode: "static"
  });

  writeEvent(response, "research_packet_summary", {
    ...packet,
    companySnapshot: "Explicit static demo packet. This is not real market research.",
    analystPriors: {
      marcus: "Static demo bull prior.",
      yara: "Static demo bear prior.",
      kenji: "Static demo quant prior.",
      sofia: "Static demo macro prior.",
      skeptic: "Static demo assumption audit prior."
    },
    initialConviction: convictionState.conviction,
    convictionHistory: convictionState.convictionHistory
  });

  const turns = staticTurns(session.ticker);
  const perTurnMs = Math.max(350, Math.floor(debateRuntimeMs / (turns.length + 1)));

  for (const turn of turns) {
    if (session.closed) return;
    const agent = getAgent(turn.agentId);
    writeEvent(response, "typing", { agentId: agent.id, name: agent.name, title: agent.title });
    await sleep(Math.min(850, perTurnMs * 0.35));
    const message = {
      id: crypto.randomUUID(),
      agentId: agent.id,
      name: agent.name,
      title: agent.title,
      short: agent.short,
      color: agent.color,
      timestamp: timestamp(),
      body: turn.body,
      citations: turn.citedEvidenceIds,
      citedEvidenceIds: turn.citedEvidenceIds,
      effects: turn.convictionDeltaByAgent,
      rationaleTag: turn.rationaleTag
    };
    session.transcript.push(message);
    writeEvent(response, "message", message);
    writeEvent(response, "conviction", applyConvictionDelta(convictionState, turn.convictionDeltaByAgent, turn.rationaleTag));
    await sleep(Math.min(900, perTurnMs * 0.55));
  }

  const moderator = {
    id: crypto.randomUUID(),
    agentId: "moderator",
    name: "Moderator",
    title: "Desk Chair",
    short: "MOD",
    color: "#d9e1ea",
    timestamp: timestamp(),
    body: `Moderator wrap on ${session.ticker}: this was explicit static mode. Use normal mode with OPENAI_API_KEY for real research-backed debate.\n\nNo recommendation. Educational demo only.`,
    citations: ["static demo"],
    citedEvidenceIds: []
  };
  session.transcript.push(moderator);
  writeEvent(response, "message", moderator);
  writeEvent(response, "complete", {
    sessionId: session.id,
    ticker: session.ticker,
    conviction: convictionState.conviction,
    convictionHistory: convictionState.convictionHistory,
    mode: "static"
  });
}

function buildStaticPacket(ticker) {
  return {
    resolvedTicker: ticker,
    displayName: `${ticker} Static Demo`,
    exchange: "DEMO",
    currency: "USD",
    marketState: "STATIC",
    latestPrice: 100,
    priceChange: 1.2,
    marketCap: 100000000000,
    sector: "Demo",
    industry: "Static mode",
    businessSummary: "Static demo mode uses canned data and is intentionally separated from real research mode.",
    keyStats: { trailingPE: 30, beta: 1.1, revenueGrowth: 0.14, grossMargins: 0.62 },
    recentPriceContext: { observations: ["Static price context for demo mode only."] },
    filingOrDisclosureSummary: { available: false, summary: "Static mode does not fetch filings.", recentFilings: [] },
    evidenceItems: [
      {
        evidenceId: "D01",
        sourceType: "static_demo",
        sourceLabel: "Static demo packet",
        sourceUrl: null,
        timestamp: new Date().toISOString(),
        claim: "This is explicit static demo mode, not real research.",
        importance: 1,
        analystRelevance: ["skeptic"]
      }
    ],
    researchWarnings: ["Static demo mode is not market research."],
    dataCoverageScore: 0,
    readyForDebate: true
  };
}

function staticTurns(ticker) {
  return [
    {
      agentId: "marcus",
      body: `${ticker} static mode still shows the live-room mechanics, but this is not a sourced investment argument.`,
      citedEvidenceIds: ["D01"],
      convictionDeltaByAgent: { marcus: 2 },
      rationaleTag: "static demo mechanics"
    },
    {
      agentId: "yara",
      body: `@Marcus exactly. If this were real mode, I would demand filings, cash flow, and quality evidence before the room starts debating.`,
      citedEvidenceIds: ["D01"],
      convictionDeltaByAgent: { yara: -2 },
      rationaleTag: "fake evidence rejected"
    },
    {
      agentId: "kenji",
      body: `The protocol is visible here: message, source chip, conviction delta. Real mode replaces this demo packet with Yahoo and disclosure evidence.`,
      citedEvidenceIds: ["D01"],
      convictionDeltaByAgent: { kenji: 2 },
      rationaleTag: "protocol clarified"
    },
    {
      agentId: "skeptic",
      body: `The most important part: static mode is labeled. It should never masquerade as researched analysis.`,
      citedEvidenceIds: ["D01"],
      convictionDeltaByAgent: { marcus: -1, yara: 1, skeptic: 1 },
      rationaleTag: "honesty guardrail"
    }
  ];
}

