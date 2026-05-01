import crypto from "node:crypto";
import { publicAgents } from "../domain/agents.mjs";
import { buildStageState, makeStage } from "../domain/research-stages.mjs";
import { AppError, toPublicError } from "../utils/errors.mjs";
import { createRateLimiter, getRateLimitSettings } from "../utils/rate-limit.mjs";
import { sanitizeTicker, sanitizeText, isStaticRequest } from "../utils/sanitize.mjs";
import { startSse, writeEvent as writeSseEvent } from "../utils/sse.mjs";
import { saveSession, pruneSessions } from "../services/session-store.mjs";
import { resolveTicker } from "../services/ticker-resolver.mjs";
import { fetchMarketData } from "../services/market-data-service.mjs";
import { fetchDisclosureData } from "../services/disclosure-service.mjs";
import { buildResearchPacket, summarizeResearchPacket } from "../services/research-packet-service.mjs";
import { synthesizeResearch } from "../services/synthesis-service.mjs";
import { createConvictionState, applyConvictionDelta } from "../services/conviction-service.mjs";
import {
  finalReviewToMessage,
  generateFinalReview,
  generateDebatePlan,
  generateModeratorSummary,
  moderatorToMessage,
  turnToMessage
} from "../services/debate-service.mjs";
import { streamStaticDemo } from "../services/static-demo-service.mjs";

const rateLimitSettings = getRateLimitSettings();
const debateRateLimiter = createRateLimiter({
  name: "debate",
  windowMs: rateLimitSettings.debateWindowMs,
  max: rateLimitSettings.debateMax
});

export async function handleDebate(request, response, url, options = {}) {
  const ticker = sanitizeTicker(url.searchParams.get("ticker"));
  const question = sanitizeText(url.searchParams.get("question"), 600);
  const debateRuntimeMs = Number(options.debateRuntimeMs || process.env.FLOOR_DEBATE_MS || 90000);
  const session = createSession({ ticker, question });
  saveSession(session);
  pruneSessions();

  startSse(response);
  request.on("close", () => {
    session.closed = true;
  });

  const writeEvent = (event, payload) => {
    if (!session.closed) writeSseEvent(response, event, payload);
  };

  try {
    debateRateLimiter.consume(request);

    if (isStaticRequest(url)) {
      await streamStaticDemo({ response, session, writeEvent, sleep, debateRuntimeMs });
      response.end();
      return;
    }

    writeEvent("session", {
      sessionId: session.id,
      ticker: session.ticker,
      question: session.question,
      agents: publicAgents,
      mode: "research"
    });

    for (const stage of buildStageState()) {
      writeEvent("research_stage", stage);
    }

    if (!ticker) {
      throw new AppError("invalid_ticker", "Enter a real public-market ticker. The app will not fall back to NVDA.", 400);
    }

    const resolution = await withStage(writeEvent, "resolving_ticker", () => resolveTicker(ticker));
    session.ticker = resolution.resolvedTicker;

    const marketData = await withStage(writeEvent, "fetching_market_data", () => fetchMarketData(resolution));
    await emitComplete(writeEvent, "fetching_company_profile", {
      detail: "Company profile and key statistics were requested from Yahoo Finance."
    });

    const disclosureData = await withStage(writeEvent, "fetching_disclosures", () =>
      fetchDisclosureData(resolution, marketData)
    );

    const researchPacket = await withStage(writeEvent, "building_research_packet", async () =>
      buildResearchPacket({ resolution, marketData, disclosureData })
    );
    session.researchPacket = researchPacket;

    if (!researchPacket.readyForDebate) {
      writeEvent("research_packet_summary", summarizeResearchPacket(researchPacket));
      throw new AppError(
        "insufficient_data",
        "Coverage is too weak for a research-backed debate. The room will not fake one.",
        422,
        { researchWarnings: researchPacket.researchWarnings, likelyMatches: researchPacket.likelyMatches }
      );
    }

    writeEvent("research_packet_summary", summarizeResearchPacket(researchPacket));

    const synthesis = await withStage(writeEvent, "assigning_analyst_priors", () =>
      synthesizeResearch({ researchPacket, question })
    );
    session.synthesis = synthesis;
    session.convictionState = createConvictionState(synthesis.initial_conviction_scores);

    writeEvent("research_packet_summary", summarizeResearchPacket(researchPacket, synthesis, session.convictionState));

    const debatePlan = await generateDebatePlan({ researchPacket, synthesis, question });
    session.debatePlan = debatePlan;
    writeEvent("research_stage", makeStage("ready_to_debate", "complete", { detail: "Research packet is ready." }));

    await streamDebate({ session, response, writeEvent, debateRuntimeMs });
    response.end();
  } catch (error) {
    const publicError = toPublicError(error);
    writeEvent("error", publicError);
    response.end();
  }
}

async function streamDebate({ session, response, writeEvent, debateRuntimeMs }) {
  const turns = session.debatePlan.turns;
  const perTurnMs = Math.max(650, Math.floor(debateRuntimeMs / Math.max(turns.length + 1, 1)));

  for (const turn of turns) {
    if (session.closed || response.destroyed) return;
    const message = turnToMessage(turn, session.researchPacket);

    writeEvent("typing", {
      agentId: message.agentId,
      name: message.name,
      title: message.title
    });
    await sleep(Math.min(2400, Math.max(260, perTurnMs * 0.32)));
    if (session.closed || response.destroyed) return;

    session.transcript.push(message);
    writeEvent("message", message);
    const convictionUpdate = applyConvictionDelta(
      session.convictionState,
      turn.convictionDeltaByAgent,
      turn.rationaleTag
    );
    writeEvent("conviction", convictionUpdate);
    await sleep(Math.min(2900, Math.max(220, perTurnMs * 0.48)));
  }

  if (session.closed || response.destroyed) return;

  const summary = await generateModeratorSummary({
    researchPacket: session.researchPacket,
    synthesis: session.synthesis,
    transcript: session.transcript,
    conviction: session.convictionState.conviction
  });
  const moderatorMessage = moderatorToMessage(summary, session.researchPacket);

  writeEvent("typing", {
    agentId: "moderator",
    name: "Moderator",
    title: "Desk Chair"
  });
  await sleep(Math.min(1800, Math.max(280, perTurnMs * 0.3)));
  if (session.closed || response.destroyed) return;

  session.moderatorSummary = summary;
  session.transcript.push(moderatorMessage);
  writeEvent("message", moderatorMessage);

  const finalReview = await generateFinalReview({
    researchPacket: session.researchPacket,
    synthesis: session.synthesis,
    transcript: session.transcript,
    moderatorSummary: summary,
    conviction: session.convictionState.conviction
  });
  const reviewMessage = finalReviewToMessage(finalReview, session.researchPacket);

  writeEvent("typing", {
    agentId: "reviewer",
    name: "Final Review Officer",
    title: "IC Chair"
  });
  await sleep(Math.min(1800, Math.max(280, perTurnMs * 0.3)));
  if (session.closed || response.destroyed) return;

  session.finalReview = finalReview;
  session.transcript.push(reviewMessage);
  session.complete = true;
  writeEvent("message", reviewMessage);
  writeEvent("complete", {
    sessionId: session.id,
    ticker: session.researchPacket.resolvedTicker,
    conviction: session.convictionState.conviction,
    convictionHistory: session.convictionState.convictionHistory,
    dataCoverageScore: session.researchPacket.dataCoverageScore,
    finalReview
  });
}

async function withStage(writeEvent, stage, callback) {
  writeEvent("research_stage", makeStage(stage, "active"));
  try {
    const result = await callback();
    writeEvent("research_stage", makeStage(stage, "complete"));
    return result;
  } catch (error) {
    writeEvent("research_stage", makeStage(stage, "failed", { detail: error.message }));
    throw error;
  }
}

async function emitComplete(writeEvent, stage, extra = {}) {
  writeEvent("research_stage", makeStage(stage, "active"));
  await sleep(120);
  writeEvent("research_stage", makeStage(stage, "complete", extra));
}

function createSession({ ticker, question }) {
  return {
    id: crypto.randomUUID(),
    ticker,
    question,
    createdAtMs: Date.now(),
    closed: false,
    complete: false,
    transcript: [],
    followUpCount: 0,
    researchPacket: null,
    synthesis: null,
    convictionState: null,
    debatePlan: null
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
