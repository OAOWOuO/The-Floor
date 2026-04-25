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

  const replies = buildFollowUpReplies(session, body);
  session.history.push(userMessage, ...replies);

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

function buildFollowUpReplies(session, userBody) {
  const target = findMentionedAgent(userBody) || selectFollowUpAgent(session, userBody);
  const replies = [buildTargetedFollowUp(session, target, userBody)];

  if (target !== "skeptic" && shouldSkepticJoin(userBody)) {
    replies.push(buildTargetedFollowUp(session, "skeptic", userBody));
  } else if (target !== "kenji" && /data|number|proof|evidence|specific|year|comp|vol|margin/i.test(userBody)) {
    replies.push(buildTargetedFollowUp(session, "kenji", userBody));
  }

  return replies;
}

function buildTargetedFollowUp(session, agentId, userBody) {
  const metrics = session.metrics;
  const agent = agents[agentId];
  const bodyByAgent = {
    marcus: `@You I would frame it through revision durability. If ${metrics.ticker} keeps positive estimate revisions near ${metrics.revisionUpPct}% while gross margin stays around ${metrics.grossMarginPct}%, the market will forgive a lot. If revisions flatten, my case loses force quickly.`,
    yara: `@You the comp I would test is the late-2021 growth reset and, for semis or hardware-linked names, the 2018 inventory correction. I am not saying the chart repeats. I am asking whether the same variable shows up: optimistic demand planning turning into cash-flow pressure.`,
    kenji: `@You I would not settle this with one anecdote. I would build a three-column table: estimate revisions, cash conversion, and realized versus implied vol. For ${metrics.ticker}, the live tension is ${metrics.realizedVolPct}% realized vol against ${metrics.impliedVolPct}% implied vol.`,
    sofia: `@You I would split the macro channel. Rates hit the discount rate, FX hits reported growth, and customer budget cycles hit demand. ${metrics.ticker}'s rate sensitivity score is ${metrics.rateSensitivity}/100, so I would not treat macro as background noise.`,
    skeptic: `@You my objection is evidentiary. The room keeps using proxies: capex, revisions, margins, or cycle analogs. Useful proxies, yes. But if the question is demand, ask for direct usage, retention, renewal, workload, or unit-economics evidence.`
  };

  return {
    id: crypto.randomUUID(),
    agentId,
    name: agent.name,
    title: agent.title,
    short: agent.short,
    color: agent.color,
    timestamp: timestamp(),
    body: bodyByAgent[agentId],
    citations: ["follow-up context"],
    bid: {
      score: 8.6,
      reason: `User asked a follow-up${userBody.includes("@") ? " with a direct mention" : ""}.`
    },
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

function selectFollowUpAgent(session, body) {
  if (/cash|account|fraud|short|red flag|cycle|bear|quality/i.test(body)) return "yara";
  if (/data|quant|vol|number|table|evidence|proof/i.test(body)) return "kenji";
  if (/rate|macro|policy|fx|currency|cycle|imf/i.test(body)) return "sofia";
  if (/assumption|bias|skeptic|logic|wrong/i.test(body)) return "skeptic";
  if (/bull|growth|revision|upside|moat|buffett|ark/i.test(body)) return "marcus";

  const lastNonModerator = session.history.filter((message) => agents[message.agentId]).at(-1);
  return lastNonModerator?.agentId || "skeptic";
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

function shouldSkepticJoin(body) {
  return /assumption|agree|consensus|why|evidence|demand|priced|specific|compare|comp/i.test(body);
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
