import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const debateRuntimeMs = Number(process.env.FLOOR_DEBATE_MS || 90000);
const openaiModel = process.env.OPENAI_MODEL || "gpt-5-mini";
const sessions = new Map();

const agents = {
  marcus: {
    id: "marcus",
    name: "Marcus",
    title: "The Bull",
    short: "BULL",
    color: "#50e3a4",
    philosophy: "Power laws, operating leverage, estimate revisions, long-duration growth."
  },
  yara: {
    id: "yara",
    name: "Yara",
    title: "The Bear",
    short: "BEAR",
    color: "#ff5a64",
    philosophy: "Cash flow, accounting quality, incentive problems, downside asymmetry."
  },
  kenji: {
    id: "kenji",
    name: "Kenji",
    title: "The Quant",
    short: "QUANT",
    color: "#56ccf2",
    philosophy: "Volatility, dispersion, factor exposure, base rates, math before story."
  },
  sofia: {
    id: "sofia",
    name: "Sofia",
    title: "The Macro",
    short: "MACRO",
    color: "#f2c94c",
    philosophy: "Rates, liquidity, policy, FX, capex cycles, country and regime risk."
  },
  skeptic: {
    id: "skeptic",
    name: "The Skeptic",
    title: "Assumption Hunter",
    short: "SKEPTIC",
    color: "#b58cff",
    philosophy: "Finds hidden premises, circular reasoning, survivor bias, and easy consensus."
  }
};

const publicAgents = Object.values(agents).map(({ id, name, title, short, color, philosophy }) => ({
  id,
  name,
  title,
  short,
  color,
  philosophy
}));

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  try {
    if (request.method === "GET" && url.pathname === "/api/debate") {
      await handleDebate(request, response, url);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/followup") {
      await handleFollowUp(request, response);
      return;
    }

    if (request.method === "GET") {
      await serveStatic(url.pathname, response);
      return;
    }

    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      sendJson(response, 500, { error: "Internal server error" });
    } else {
      response.end();
    }
  }
});

server.listen(port, host, () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  console.log(`The Floor is running at http://localhost:${actualPort}`);
});

async function handleDebate(request, response, url) {
  const ticker = sanitizeTicker(url.searchParams.get("ticker") || "NVDA");
  const question = sanitizeText(url.searchParams.get("question") || "");
  const session = createSession(ticker, question);
  sessions.set(session.id, session);

  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });

  request.on("close", () => {
    session.closed = true;
  });

  writeEvent(response, "session", {
    sessionId: session.id,
    ticker: session.ticker,
    question: session.question,
    agents: publicAgents,
    metrics: session.metrics,
    conviction: session.conviction,
    convictionHistory: session.convictionHistory
  });

  const plan = buildDebatePlan(session);
  const perTurnMs = Math.max(850, Math.floor(debateRuntimeMs / Math.max(plan.length + 1, 1)));

  for (const item of plan) {
    if (session.closed) return;

    writeEvent(response, "typing", {
      agentId: item.agentId,
      name: agents[item.agentId].name,
      title: agents[item.agentId].title
    });

    await sleep(Math.min(3200, Math.max(550, perTurnMs * 0.38)));
    if (session.closed) return;

    const message = finalizeMessage(session, item);
    session.history.push(message);
    applyConviction(session, message);

    writeEvent(response, "message", message);
    writeEvent(response, "conviction", {
      conviction: session.conviction,
      convictionHistory: session.convictionHistory
    });

    await sleep(Math.min(4200, Math.max(300, perTurnMs * 0.62)));
  }

  if (session.closed) return;

  const moderator = buildModeratorMessage(session);
  writeEvent(response, "typing", {
    agentId: "moderator",
    name: "Moderator",
    title: "Desk Chair"
  });
  await sleep(Math.min(2600, Math.max(500, perTurnMs * 0.45)));

  session.history.push(moderator);
  writeEvent(response, "message", moderator);
  writeEvent(response, "complete", {
    sessionId: session.id,
    ticker: session.ticker,
    conviction: session.conviction,
    convictionHistory: session.convictionHistory
  });
  response.end();
}

async function handleFollowUp(request, response) {
  const payload = await readJson(request);
  const session = sessions.get(String(payload.sessionId || ""));
  const body = sanitizeText(payload.message || "");

  if (!session || !body) {
    sendJson(response, 400, { error: "Missing session or message" });
    return;
  }

  const userMessage = {
    id: crypto.randomUUID(),
    agentId: "user",
    name: "You",
    title: "Joined the floor",
    short: "YOU",
    timestamp: timestamp(),
    body,
    citations: [],
    bid: null
  };

  session.history.push(userMessage);
  const replies = await buildFollowUpReplies(session, body);
  session.history.push(...replies);
  session.followUpCount += 1;

  for (const reply of replies) {
    applyConviction(session, reply);
  }

  sendJson(response, 200, {
    userMessage,
    messages: replies,
    conviction: session.conviction,
    convictionHistory: session.convictionHistory
  });
}

function createSession(ticker, question) {
  const seed = hashToNumber(`${ticker}:${question || "base"}`);
  const random = mulberry32(seed);
  const conviction = {
    marcus: 34,
    yara: -31,
    kenji: 0,
    sofia: 6,
    skeptic: 0
  };

  return {
    id: crypto.randomUUID(),
    ticker,
    question,
    seed,
    random,
    closed: false,
    metrics: buildMetrics(ticker, random),
    history: [],
    followUpCount: 0,
    conviction,
    convictionHistory: Object.fromEntries(
      Object.keys(conviction).map((key) => [key, [conviction[key]]])
    )
  };
}

function buildDebatePlan(session) {
  const scratchHistory = [];
  const plan = [];
  const turns = 14 + Math.round(session.random() * 2);

  for (let index = 0; index < turns; index += 1) {
    const bids = scoreBids(session, scratchHistory, index);
    const selected = bids.toSorted((a, b) => b.score - a.score)[0];
    const draft = draftAgentMessage(session, selected.agentId, scratchHistory, index, selected);
    plan.push(draft);
    scratchHistory.push(draft);
  }

  return plan;
}

function scoreBids(session, history, turnIndex) {
  const last = history.at(-1);
  const previous = history.at(-2);
  const counts = countSpeakers(history);
  const bullishAgreement =
    last && previous && last.stance > 0 && previous.stance > 0 && last.agentId !== previous.agentId;
  const bearishAgreement =
    last && previous && last.stance < 0 && previous.stance < 0 && last.agentId !== previous.agentId;
  const recentSpeakers = history.slice(-3).map((message) => message.agentId);

  const bidMap = {
    marcus: {
      score: 4.2,
      reason: "Can frame upside and estimate revision debate."
    },
    yara: {
      score: 4.1,
      reason: "Can test cash-flow quality and narrative risk."
    },
    kenji: {
      score: 3.9,
      reason: "Can anchor the room in observable data."
    },
    sofia: {
      score: 3.8,
      reason: "Can place the single-name debate inside cycle conditions."
    },
    skeptic: {
      score: 2.4,
      reason: "Waiting for an unstated assumption or clean consensus."
    }
  };

  if (turnIndex === 0) {
    bidMap.marcus.score += 4.4;
    bidMap.kenji.score += 1.1;
  }

  if (last?.agentId === "marcus") {
    bidMap.yara.score += 3.8;
    bidMap.kenji.score += 1.8;
    bidMap.skeptic.score += 1.1;
  }

  if (last?.agentId === "yara") {
    bidMap.marcus.score += 2.4;
    bidMap.sofia.score += 2.7;
    bidMap.kenji.score += 1.4;
  }

  if (last?.agentId === "kenji") {
    bidMap.sofia.score += 2.2;
    bidMap.marcus.score += 1.1;
    bidMap.yara.score += 1.1;
  }

  if (last?.agentId === "sofia") {
    bidMap.kenji.score += 1.7;
    bidMap.yara.score += 1.3;
    bidMap.skeptic.score += 1.2;
  }

  if (bullishAgreement || bearishAgreement) {
    bidMap.skeptic.score += 5.2;
    bidMap.skeptic.reason = "Consensus is forming too cleanly; assumptions need to be named.";
  }

  if (turnIndex >= 4 && counts.kenji < 2) bidMap.kenji.score += 3.2;
  if (turnIndex >= 5 && counts.sofia < 2) bidMap.sofia.score += 2.8;
  if (turnIndex >= 6 && counts.skeptic < 2) bidMap.skeptic.score += 3.5;
  if (turnIndex >= 9 && counts.yara < 3) bidMap.yara.score += 2.3;
  if (turnIndex >= 9 && counts.marcus < 3) bidMap.marcus.score += 2.1;

  for (const agentId of Object.keys(bidMap)) {
    bidMap[agentId].score += session.random() * 1.6;
    bidMap[agentId].score -= (counts[agentId] || 0) * 0.45;
    if (recentSpeakers.includes(agentId)) bidMap[agentId].score -= 1.4;
    if (last?.agentId === agentId) bidMap[agentId].score -= 4.5;
  }

  return Object.entries(bidMap).map(([agentId, bid]) => ({
    agentId,
    score: clamp(Number(bid.score.toFixed(1)), 0, 10),
    reason: bid.reason
  }));
}

function draftAgentMessage(session, agentId, history, turnIndex, bid) {
  const agent = agents[agentId];
  const last = history.at(-1);
  const metrics = session.metrics;
  const mention = last ? `@${agents[last.agentId]?.name || "desk"}` : "";
  const context = session.question ? ` The user asked: "${session.question}".` : "";
  let body = "";
  let stance = 0;
  let citations = [];
  let effects = {};

  if (agentId === "marcus") {
    stance = 1;
    citations = ["revision tape", "growth durability"];
    effects = { marcus: 7, yara: 2, sofia: 2 };
    body = pick(session, [
      `${metrics.ticker} looks expensive only if you freeze the denominator.${context} Forward earnings revisions are up ${metrics.revisionUpPct}% in the model set I would care about. The market is not paying for last quarter; it is paying for operating leverage that still has room to surprise.`,
      `${mention} I hear the cash-flow objection, but power-law names never screen clean at the inflection. If revenue growth is ${metrics.revenueGrowthPct}% and gross margin is holding near ${metrics.grossMarginPct}%, the question is whether incremental margin expands faster than consensus can update.`,
      `Hot take: the multiple is the least interesting part of ${metrics.ticker}. The real debate is whether the category gets bigger faster than skepticism can normalize it. If it does, today's P/E will look like the wrong yardstick.`,
      `${mention} you are treating estimate optimism as a constant. It is not. When revisions move in clusters, the first upward leg is usually under-owned because everyone waits for the "clean" entry that never comes.`
    ]);
  }

  if (agentId === "yara") {
    stance = -1;
    citations = ["cash conversion", "quality of earnings"];
    effects = { yara: -7, marcus: -3, sofia: -1 };
    body = pick(session, [
      `${mention} revisions are not cash. They are sell-side behavior. ${metrics.ticker} has a free cash flow yield near ${metrics.fcfYieldPct}% and accrual pressure at ${metrics.accrualPressure}/100. That is where narrative can hide the bill.`,
      `I do not care that the story is exciting. I care whether working capital is quietly financing the story. If receivables grow faster than revenue for two more quarters, the debate changes from growth scarcity to earnings quality.`,
      `${mention} "priced for power law" is exactly the phrase people use before they stop asking who is paying. I want customer concentration, contract duration, and cash conversion before I accept the multiple as rational.`,
      `Cycle analog matters. The nasty version is not one big fraud headline; it is a slow estimate reset where every quarter is "still early" until margins stop absorbing the disappointment.`
    ]);
  }

  if (agentId === "kenji") {
    stance = metrics.impliedVolPct < metrics.realizedVolPct ? -0.2 : 0.2;
    citations = ["volatility sheet", "factor snapshot"];
    effects = { kenji: stance > 0 ? 3 : -3, marcus: stance > 0 ? 1 : -1, yara: stance > 0 ? 1 : -1 };
    body = pick(session, [
      `Data check: ${metrics.ticker} 60d realized vol is ${metrics.realizedVolPct}%, implied vol is ${metrics.impliedVolPct}%. If this debate is about regime change, options are ${metrics.impliedVolPct < metrics.realizedVolPct ? "not pricing enough tail" : "already charging for tail"}. [loaded vol surface ->]`,
      `${mention} narratives aside, estimate dispersion is ${metrics.estimateDispersionPct}% and beta is ${metrics.beta}. That means the market itself admits disagreement. High conviction language is not supported by the distribution.`,
      `Base rates: names with ${metrics.revenueGrowthPct}% revenue growth, ${metrics.grossMarginPct}% gross margin, and ${metrics.debtToEbitda}x debt/EBITDA usually trade on revision direction first, valuation second. That does not make them safe. It defines the scoring function.`,
      `I am marking the room's error bars as too narrow. Bull case and bear case both depend on a second derivative: revisions improving or deteriorating. First derivative evidence is not enough.`
    ]);
  }

  if (agentId === "sofia") {
    stance = metrics.rateSensitivity > 55 ? -0.3 : 0.3;
    citations = ["rates path", "capex cycle"];
    effects = { sofia: stance > 0 ? 5 : -5, marcus: stance > 0 ? 2 : -1, yara: stance > 0 ? -1 : 2 };
    body = pick(session, [
      `${mention} the single-name argument needs a macro frame. Rate sensitivity is ${metrics.rateSensitivity}/100, USD revenue exposure is ${metrics.usdExposurePct}%, and the capex cycle score is ${metrics.capexCycle}/100. Those three variables decide how much patience investors will give the story.`,
      `This is not the same tape as 2024. Liquidity is more selective, but capex budgets are not uniformly rolling over. If ${metrics.ticker} is tied to secular infrastructure spend, the cycle risk is real but not automatically fatal.`,
      `Policy risk is under-discussed. A company can execute perfectly and still get multiple compression if rates reprice or FX eats reported growth. That is why I want the debate separated into fundamentals versus discount rate.`,
      `${mention} I agree on cycle risk, but the important question is transmission. Does the macro shock hit demand, funding conditions, customer budgets, or the valuation multiple? Those are different failure modes.`
    ]);
  }

  if (agentId === "skeptic") {
    stance = 0;
    citations = ["assumption audit"];
    effects = { marcus: -5, yara: 3, kenji: 1, sofia: -2, skeptic: 0 };
    body = pick(session, [
      `Pause. Marcus and Sofia are both treating capex as demand. That may be true, but it is still an assumption. Supply-side investment is not the same thing as monetized workload. Who has direct evidence of usage or renewal quality?`,
      `Yara is doing the inverse version of the same move: weak cash conversion becomes proof that the story is suspect. Maybe. Or maybe it is timing. We need to separate accounting smoke from operating investment.`,
      `Kenji gave error bars; everyone else immediately converted them back into confidence. That is a cognitive trap. A wide distribution is not permission to pick the endpoint that matches your prior.`,
      `The room is leaning on analogy. Which year is the actual comp, and which variable makes it a valid comp? If you cannot name that variable, the analogy is decoration.`
    ]);
  }

  return {
    id: crypto.randomUUID(),
    agentId,
    name: agent.name,
    title: agent.title,
    short: agent.short,
    color: agent.color,
    timestamp: null,
    body,
    citations,
    bid,
    stance,
    effects,
    turnIndex
  };
}

function finalizeMessage(session, draft) {
  return {
    id: draft.id,
    agentId: draft.agentId,
    name: draft.name,
    title: draft.title,
    short: draft.short,
    color: draft.color,
    timestamp: timestamp(),
    body: draft.body,
    citations: draft.citations,
    bid: draft.bid,
    stance: draft.stance,
    effects: draft.effects
  };
}

function buildModeratorMessage(session) {
  const convictionLines = Object.entries(session.conviction)
    .map(([agentId, value]) => `${agents[agentId].name}: ${formatConviction(value)}`)
    .join("\n");

  const body = [
    `Moderator wrap on ${session.ticker}:`,
    "",
    "The live disagreement is not simply bull versus bear. Marcus is arguing that estimate revisions and operating leverage can outrun the visible multiple. Yara is asking whether cash conversion and accounting quality can support that story. Kenji says the market distribution is wider than the language in the room. Sofia separates fundamentals from discount-rate and policy risk. The Skeptic's strongest point: several claims still use proxy evidence as if it were direct demand evidence.",
    "",
    "Open questions for the desk:",
    `1. Are ${session.ticker}'s revisions being pulled by real demand or by optimistic model behavior?`,
    "2. Does cash conversion lag because of investment timing or because earnings quality is weaker than reported growth?",
    "3. Which macro variable matters most: rates, FX, customer budget cycles, or policy risk?",
    "",
    "Conviction snapshot:",
    convictionLines,
    "",
    "No recommendation. This is a debate map, not a trade instruction."
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
    citations: ["debate transcript", "conviction tracker"],
    bid: null,
    stance: 0,
    effects: {}
  };
}

async function buildFollowUpReplies(session, userBody) {
  const bids = scoreFollowUpBids(session, userBody);
  const selected = selectFollowUpSpeakers(bids, userBody);
  const llmReplies = await buildLlmFollowUpReplies(session, userBody, selected);

  if (llmReplies?.length) {
    return llmReplies;
  }

  return selected.map((bid, index) => buildTargetedFollowUp(session, bid.agentId, userBody, bid, index));
}

function scoreFollowUpBids(session, userBody) {
  const direct = findMentionedAgent(userBody);
  const recentAgents = session.history
    .filter((message) => agents[message.agentId])
    .slice(-5)
    .map((message) => message.agentId);
  const lastAgent = recentAgents.at(-1);
  const isInvitation = /any\s?one else|anyone else|anybody else|someone else|who else|others?|jump in|talk more|chime|其他|還有|誰要|有人要/i.test(userBody);
  const isMetaCritique = /not good|isn't good|bad|same|repeat|repeated|boring|generic|robotic|doesn't feel|dont think|don't think|不好|一樣|重複|無聊|不像|即時|沒辦法/i.test(userBody);

  const bidMap = {
    marcus: { score: 3.8, reason: "Can reframe the upside case and answer user pushback." },
    yara: { score: 3.8, reason: "Can challenge the quality of the debate and the thesis." },
    kenji: { score: 3.6, reason: "Can add data discipline or measurement criteria." },
    sofia: { score: 3.3, reason: "Can broaden the context beyond the last exchange." },
    skeptic: { score: 3.1, reason: "Can audit assumptions if the user is asking about evidence or logic." }
  };

  if (direct) {
    bidMap[direct].score += 6.2;
    bidMap[direct].reason = "User directly mentioned this analyst.";
  }

  if (isInvitation) {
    for (const agentId of Object.keys(bidMap)) {
      bidMap[agentId].score += 2.3;
      bidMap[agentId].reason = "User invited other analysts to join.";
    }
    if (lastAgent) bidMap[lastAgent].score -= 4.4;
  }

  if (isMetaCritique) {
    bidMap.yara.score += 2.8;
    bidMap.kenji.score += 2.3;
    bidMap.marcus.score += 1.5;
    bidMap.skeptic.score -= 1.1;
    bidMap.yara.reason = "User is criticizing answer quality; Yara should be blunt about what is missing.";
    bidMap.kenji.reason = "User is criticizing answer quality; Kenji can define what would make it better.";
  }

  if (/data|number|proof|evidence|specific|year|comp|vol|margin|table|數據|證據|哪一年|對標/i.test(userBody)) {
    bidMap.kenji.score += 3.6;
    bidMap.skeptic.score += 1.6;
  }

  if (/cash|account|fraud|short|red flag|cycle|bear|quality|現金流|會計|空頭/i.test(userBody)) {
    bidMap.yara.score += 3.4;
  }

  if (/rate|macro|policy|fx|currency|cycle|imf|rates|政策|匯率|利率|總經/i.test(userBody)) {
    bidMap.sofia.score += 3.4;
  }

  if (/bull|growth|revision|upside|moat|buffett|ark|growth|成長|上修|樂觀/i.test(userBody)) {
    bidMap.marcus.score += 3.3;
  }

  if (/assumption|bias|logic|why|demand|priced|consensus|skeptic|假設|邏輯|需求|共識/i.test(userBody)) {
    bidMap.skeptic.score += 3.4;
  }

  for (const agentId of Object.keys(bidMap)) {
    const recentCount = recentAgents.filter((id) => id === agentId).length;
    bidMap[agentId].score -= recentCount * 0.9;
    if (lastAgent === agentId) bidMap[agentId].score -= 1.7;
    bidMap[agentId].score += session.random() * 0.7;
  }

  return Object.entries(bidMap)
    .map(([agentId, bid]) => ({
      agentId,
      score: clamp(Number(bid.score.toFixed(1)), 0, 10),
      reason: bid.reason
    }))
    .toSorted((a, b) => b.score - a.score);
}

function selectFollowUpSpeakers(bids, userBody) {
  const direct = findMentionedAgent(userBody);
  const asksForOthers = /any\s?one else|anyone else|anybody else|someone else|who else|others?|jump in|talk more|chime|其他|還有|誰要|有人要/i.test(userBody);
  const wantsDepth = /why|evidence|specific|data|number|compare|comp|assumption|debate|more|怎麼|為什麼|證據|數據|更多|辯論/i.test(userBody);
  const targetCount = direct && !asksForOthers ? (wantsDepth ? 2 : 1) : asksForOthers ? 3 : wantsDepth ? 2 : 1;
  const selected = [];

  for (const bid of bids) {
    if (selected.length >= targetCount) break;
    if (bid.score < 4.2 && selected.length > 0) continue;
    selected.push(bid);
  }

  if (!selected.length) selected.push(bids[0]);
  return selected;
}

async function buildLlmFollowUpReplies(session, userBody, selectedBids) {
  if (!process.env.OPENAI_API_KEY) return null;

  try {
    const replies = [];

    for (const [index, bid] of selectedBids.entries()) {
      const agent = agents[bid.agentId];
      const body = await generateLlmAgentReply(session, userBody, agent, selectedBids, index);
      if (!body) return null;
      replies.push(buildFollowUpMessage(session, bid.agentId, body, ["LLM follow-up", "shared transcript"], bid));
    }

    return replies;
  } catch (error) {
    console.warn("OpenAI follow-up failed; falling back to local orchestrator.", error.message);
    return null;
  }
}

async function generateLlmAgentReply(session, userBody, agent, selectedBids, index) {
  const transcript = session.history
    .slice(-18)
    .map((message) => `${message.name}: ${message.body}`)
    .join("\n");
  const coSpeakers = selectedBids
    .filter((bid) => bid.agentId !== agent.id)
    .map((bid) => agents[bid.agentId].name)
    .join(", ") || "none";

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: openaiModel,
      store: false,
      max_output_tokens: 170,
      reasoning: { effort: "low" },
      instructions: [
        `You are ${agent.name} (${agent.title}) in The Floor, a live multi-agent stock debate room.`,
        `Persona philosophy: ${agent.philosophy}`,
        "Reply to the user's latest chat message in character.",
        "Do not give buy/sell/hold recommendations, target prices, or personalized financial advice.",
        "Do not repeat earlier wording. Add a fresh angle, answer naturally, and mention another analyst only if useful.",
        "Keep it to 2 concise sentences. If the user criticizes the product or debate quality, acknowledge it directly and say what would make the debate sharper."
      ].join("\n"),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `Ticker: ${session.ticker}`,
                `User's original question: ${session.question || "none"}`,
                `Current metrics snapshot: ${JSON.stringify(session.metrics)}`,
                `Recent transcript:\n${transcript}`,
                `Latest user message: ${userBody}`,
                `Other analysts also selected for this follow-up: ${coSpeakers}`,
                `You are speaker ${index + 1} in this follow-up burst.`
              ].join("\n\n")
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API ${response.status}`);
  }

  const data = await response.json();
  return extractOutputText(data).slice(0, 520).trim();
}

function extractOutputText(data) {
  if (typeof data.output_text === "string") return data.output_text;

  return (data.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text" || content.type === "text")
    .map((content) => content.text || "")
    .join("\n")
    .trim();
}

function buildTargetedFollowUp(session, agentId, userBody, bid, index) {
  const metrics = session.metrics;
  const isMetaCritique = /not good|isn't good|bad|same|repeat|repeated|boring|generic|robotic|doesn't feel|dont think|don't think|不好|一樣|重複|無聊|不像|即時|沒辦法/i.test(userBody);
  const asksForOthers = /any\s?one else|anyone else|anybody else|someone else|who else|others?|jump in|talk more|chime|其他|還有|誰要|有人要/i.test(userBody);
  const personaReplies = {
    marcus: [
      `@You fair push. My sharper version: if ${metrics.ticker}'s revision momentum stays near ${metrics.revisionUpPct}% while gross margin holds around ${metrics.grossMarginPct}%, the bull case is not "vibes"; it is operating leverage that has not finished showing up.`,
      `@You I will add a different angle from Skeptic: the upside case needs a falsifiable trigger. For me, that trigger is two more quarters of revisions moving up without margin leakage.`,
      `@You if the debate felt thin, I would tighten it around one question: is consensus still behind the earnings curve? If the answer is no, I should lower conviction immediately.`
    ],
    yara: [
      `@You I agree the answer should not loop. The better bear question is simple: are earnings converting into cash, or are receivables and capex quietly carrying the story?`,
      `@You if this is going to be useful, we need fewer slogans and more failure modes. For ${metrics.ticker}, I would start with cash conversion, customer concentration, and whether optimistic demand planning is leaking into working capital.`,
      `@You I will be blunt: "more debate" is only better if someone names what would prove them wrong. My line is cash flow quality; if it improves, my short-seller prior should weaken.`
    ],
    kenji: [
      `@You yes, another analyst should jump in. I would score the debate on evidence density: realized vol ${metrics.realizedVolPct}%, implied vol ${metrics.impliedVolPct}%, estimate dispersion ${metrics.estimateDispersionPct}%, and whether anyone can connect those numbers to the thesis.`,
      `@You the repeated Skeptic answer is a routing bug, not a finance insight. My contribution: define the next table before arguing more, then make each analyst update conviction from the same rows.`,
      `@You I want a cleaner protocol: one claim, one observable, one confidence update. Otherwise five voices can still collapse into five versions of the same prior.`
    ],
    sofia: [
      `@You I would bring in the macro channel here. Even if the company case is strong, rate sensitivity at ${metrics.rateSensitivity}/100 means the room has to separate business execution from multiple compression.`,
      `@You another angle: the debate should identify which external variable can break the thesis. For ${metrics.ticker}, that may be rates, FX exposure near ${metrics.usdExposurePct}%, or customer budget timing.`,
      `@You I do want to talk more, but not by repeating the same evidence question. The macro version is: which part of the cycle actually transmits into this company, demand or valuation?`
    ],
    skeptic: [
      `@You agreed, the room should not repeat itself. My next question is different: what single data point would force Marcus, Yara, Kenji, or Sofia to reduce conviction right now?`,
      `@You I will only add value if I attack the process, not repeat the proxy point. The trap is letting "more voices" feel like more evidence when everyone is still orbiting the same missing datapoint.`,
      `@You if the debate is not good enough, the fix is not louder agents. It is adversarial updating: every analyst has to say what would change their mind.`
    ]
  };
  const pool = personaReplies[agentId];
  const variantSeed = hashToNumber(`${session.id}:${session.followUpCount}:${agentId}:${userBody}:${index}`);
  let body = pool[variantSeed % pool.length];

  if (asksForOthers && agentId !== "skeptic") {
    body = body.replace("@You ", "@You I'll jump in. ");
  }

  if (isMetaCritique && agentId === "kenji") {
    body += " In product terms, this should behave like a room, not a single chatbot.";
  }

  return buildFollowUpMessage(session, agentId, body, ["follow-up bid", "shared transcript"], bid);
}

function buildFollowUpMessage(session, agentId, body, citations, bid) {
  const agent = agents[agentId];

  return {
    id: crypto.randomUUID(),
    agentId,
    name: agent.name,
    title: agent.title,
    short: agent.short,
    color: agent.color,
    timestamp: timestamp(),
    body,
    citations,
    bid,
    stance: agentId === "marcus" ? 1 : agentId === "yara" ? -1 : 0,
    effects:
      agentId === "marcus"
        ? { marcus: 3 }
        : agentId === "yara"
          ? { yara: -3 }
          : agentId === "sofia"
            ? { sofia: 2 }
            : {}
  };
}

function applyConviction(session, message) {
  for (const [agentId, delta] of Object.entries(message.effects || {})) {
    if (!(agentId in session.conviction)) continue;
    session.conviction[agentId] = clamp(session.conviction[agentId] + delta, -100, 100);
  }

  if (message.agentId === "skeptic") {
    for (const agentId of ["marcus", "yara", "sofia"]) {
      const current = session.conviction[agentId];
      session.conviction[agentId] = current > 0 ? Math.max(0, current - 2) : Math.min(0, current + 2);
    }
  }

  for (const agentId of Object.keys(session.convictionHistory)) {
    session.convictionHistory[agentId].push(session.conviction[agentId]);
  }
}

function buildMetrics(ticker, random) {
  return {
    ticker,
    pe: Math.round(22 + random() * 66),
    revisionUpPct: Math.round(6 + random() * 28),
    revenueGrowthPct: Math.round(8 + random() * 46),
    grossMarginPct: Math.round(41 + random() * 39),
    fcfYieldPct: Number((1.2 + random() * 5.2).toFixed(1)),
    accrualPressure: Math.round(30 + random() * 55),
    realizedVolPct: Math.round(24 + random() * 42),
    impliedVolPct: Math.round(21 + random() * 42),
    estimateDispersionPct: Math.round(8 + random() * 28),
    beta: Number((0.8 + random() * 1.6).toFixed(2)),
    debtToEbitda: Number((0.2 + random() * 3.8).toFixed(1)),
    rateSensitivity: Math.round(25 + random() * 60),
    usdExposurePct: Math.round(28 + random() * 54),
    capexCycle: Math.round(35 + random() * 55)
  };
}

function findMentionedAgent(body) {
  const lower = body.toLowerCase();
  if (/@marcus|@bull/.test(lower)) return "marcus";
  if (/@yara|@bear/.test(lower)) return "yara";
  if (/@kenji|@quant/.test(lower)) return "kenji";
  if (/@sofia|@macro/.test(lower)) return "sofia";
  if (/@skeptic|the skeptic/.test(lower)) return "skeptic";
  return null;
}

async function serveStatic(pathname, response) {
  const normalized = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(normalized).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");
    const ext = path.extname(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    createReadStream(filePath).pipe(response);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

function countSpeakers(history) {
  return history.reduce(
    (counts, message) => {
      counts[message.agentId] = (counts[message.agentId] || 0) + 1;
      return counts;
    },
    { marcus: 0, yara: 0, kenji: 0, sofia: 0, skeptic: 0 }
  );
}

function pick(session, items) {
  return items[Math.floor(session.random() * items.length)];
}

function writeEvent(response, event, payload) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sanitizeTicker(value) {
  const ticker = String(value).trim().toUpperCase().replace(/[^A-Z0-9.:-]/g, "");
  return ticker.slice(0, 14) || "NVDA";
}

function sanitizeText(value) {
  return String(value).replace(/\s+/g, " ").trim().slice(0, 240);
}

function timestamp(date = new Date()) {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatConviction(value) {
  if (value > 12) return `bullish +${value}`;
  if (value < -12) return `bearish ${value}`;
  return `neutral ${value >= 0 ? "+" : ""}${value}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hashToNumber(input) {
  const hash = crypto.createHash("sha256").update(input).digest();
  return hash.readUInt32LE(0);
}

function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
