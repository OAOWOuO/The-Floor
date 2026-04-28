const state = {
  eventSource: null,
  sessionId: null,
  agents: [],
  conviction: {},
  convictionHistory: {},
  messageQueue: Promise.resolve(),
  complete: false,
  mode: "server",
  staticRunId: 0,
  staticMetrics: null,
  staticReplay: null,
  staticHistory: [],
  staticFollowUpCount: 0,
  researchStages: new Map(),
  researchPacket: null,
  evidenceMap: new Map(),
  activeRoomTab: "debate",
  experienceMode: new URLSearchParams(window.location.search).get("live") === "1" ? "live" : "showcase",
  serverCapabilities: null,
  lastError: null,
  canvasStarted: false
};

const elements = {
  form: document.querySelector("#debate-form"),
  experienceButtons: document.querySelectorAll("[data-experience-mode]"),
  showcasePanel: document.querySelector("#showcase-panel"),
  livePanel: document.querySelector("#live-panel"),
  sampleTickerButtons: document.querySelectorAll("[data-showcase-ticker]"),
  liveStatusLabel: document.querySelector("#live-status-label"),
  liveStatusValue: document.querySelector("#live-status-value"),
  apiKeyHelper: document.querySelector("#api-key-helper"),
  generateEnvButton: document.querySelector("#generate-env-button"),
  copyEnvButton: document.querySelector("#copy-env-button"),
  clearKeyButton: document.querySelector("#clear-key-button"),
  apiKeyOutput: document.querySelector("#api-key-output"),
  ticker: document.querySelector("#ticker-input"),
  question: document.querySelector("#question-input"),
  begin: document.querySelector("#begin-button"),
  roomTitle: document.querySelector("#room-title"),
  roomStatus: document.querySelector("#room-status"),
  roomTabButtons: document.querySelectorAll("[data-room-tab]"),
  debatePanel: document.querySelector("#debate-panel"),
  dataPanel: document.querySelector("#data-panel"),
  researchTimeline: document.querySelector("#research-timeline"),
  feed: document.querySelector("#message-feed"),
  typing: document.querySelector("#typing-line"),
  followupForm: document.querySelector("#followup-form"),
  followupInput: document.querySelector("#followup-input"),
  followupButton: document.querySelector("#followup-button"),
  agentList: document.querySelector("#agent-list"),
  researchSummary: document.querySelector("#research-summary"),
  metricsGrid: document.querySelector("#metrics-grid"),
  convictionList: document.querySelector("#conviction-list"),
  coverageChip: document.querySelector("#coverage-chip"),
  evidenceList: document.querySelector("#evidence-list"),
  sessionChip: document.querySelector("#session-chip"),
  canvas: document.querySelector("#market-canvas")
};

const fallbackAgents = [
  { id: "marcus", name: "Marcus", title: "The Bull", short: "BULL", color: "#50e3a4" },
  { id: "yara", name: "Yara", title: "The Bear", short: "BEAR", color: "#ff5a64" },
  { id: "kenji", name: "Kenji", title: "The Quant", short: "QUANT", color: "#56ccf2" },
  { id: "sofia", name: "Sofia", title: "The Macro", short: "MACRO", color: "#f2c94c" },
  { id: "skeptic", name: "The Skeptic", title: "Assumption Hunter", short: "SKEPTIC", color: "#b58cff" }
];

let showcaseReplayCache = null;

state.agents = fallbackAgents;
renderAgents();
startMarketCanvas();
setExperienceMode(state.experienceMode);
refreshHostedStatus();
updateApiKeyHelper();

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  beginDebate();
});

elements.followupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await sendFollowUp();
});

for (const button of elements.roomTabButtons) {
  button.addEventListener("click", () => setRoomTab(button.dataset.roomTab));
}

for (const button of elements.experienceButtons) {
  button.addEventListener("click", () => setExperienceMode(button.dataset.experienceMode));
}

for (const button of elements.sampleTickerButtons) {
  button.addEventListener("click", () => {
    elements.ticker.value = button.dataset.showcaseTicker;
    setExperienceMode("showcase");
    beginDebate();
  });
}

elements.generateEnvButton.addEventListener("click", updateApiKeyHelper);
elements.apiKeyHelper.addEventListener("input", updateApiKeyHelper);
elements.copyEnvButton.addEventListener("click", copyEnvHelper);
elements.clearKeyButton.addEventListener("click", () => {
  elements.apiKeyHelper.value = "";
  updateApiKeyHelper();
});

function setExperienceMode(mode) {
  state.experienceMode = mode === "live" ? "live" : "showcase";
  for (const button of elements.experienceButtons) {
    button.classList.toggle("active", button.dataset.experienceMode === state.experienceMode);
  }
  elements.showcasePanel.hidden = state.experienceMode !== "showcase";
  elements.livePanel.hidden = state.experienceMode !== "live";
  elements.begin.textContent = state.experienceMode === "live" ? "Begin live research" : "Play showcase";
  elements.roomTitle.textContent =
    state.experienceMode === "live" ? "Live research mode" : "Showcase replay ready";
  elements.sessionChip.textContent = state.experienceMode === "live" ? "Self-host" : "Showcase";
  setStatus(state.experienceMode === "live" ? "Live setup" : "Showcase", false);
}

async function refreshHostedStatus() {
  try {
    const response = await fetch("/api/health");
    const payload = await response.json();
    state.serverCapabilities = payload.capabilities || {};
    renderHostedStatus(payload);
  } catch {
    elements.liveStatusLabel.textContent = "Hosted status";
    elements.liveStatusValue.textContent = "Unavailable";
  }
}

function renderHostedStatus(payload) {
  const liveEnabled = Boolean(payload?.capabilities?.liveResearch);
  const commit = payload?.build?.render?.gitCommit?.slice(0, 7);
  elements.liveStatusLabel.textContent = liveEnabled ? "Hosted live mode" : "Hosted live mode";
  elements.liveStatusValue.textContent = liveEnabled ? "Enabled" : "Self-host required";
  elements.liveStatusValue.classList.toggle("positive", liveEnabled);
  elements.liveStatusValue.classList.toggle("neutral", !liveEnabled);
  if (commit) elements.liveStatusLabel.textContent = `Hosted build ${commit}`;
}

function updateApiKeyHelper() {
  const key = elements.apiKeyHelper.value.trim();
  const keyValue = key || "<your OpenAI API key>";
  elements.apiKeyOutput.textContent = [
    "# Local development",
    `export OPENAI_API_KEY=${shellQuote(keyValue)}`,
    "export OPENAI_MODEL='gpt-5.4-mini'",
    "npm install",
    "npm run dev",
    "",
    "# Render environment variables",
    `OPENAI_API_KEY=${keyValue}`,
    "OPENAI_MODEL=gpt-5.4-mini",
    "HOST=0.0.0.0",
    "",
    "# The public hosted demo never receives this key."
  ].join("\n");
}

async function copyEnvHelper() {
  updateApiKeyHelper();
  try {
    await navigator.clipboard.writeText(elements.apiKeyOutput.textContent);
    elements.copyEnvButton.textContent = "Copied";
    window.setTimeout(() => {
      elements.copyEnvButton.textContent = "Copy";
    }, 1200);
  } catch {
    elements.copyEnvButton.textContent = "Select text";
    window.setTimeout(() => {
      elements.copyEnvButton.textContent = "Copy";
    }, 1200);
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function renderLiveUnavailable() {
  if (state.eventSource) state.eventSource.close();
  state.staticRunId += 1;
  state.mode = "setup";
  state.sessionId = null;
  state.complete = false;
  state.messageQueue = Promise.resolve();
  state.researchStages = new Map();
  state.researchPacket = null;
  state.evidenceMap = new Map();
  state.lastError = null;
  state.conviction = {};
  state.convictionHistory = {};
  elements.feed.innerHTML = "";
  elements.researchTimeline.innerHTML = "";
  elements.researchTimeline.hidden = true;
  elements.researchSummary.innerHTML = "";
  elements.metricsGrid.innerHTML = "";
  elements.evidenceList.innerHTML = "";
  elements.coverageChip.textContent = "No packet";
  renderDataPanel(null);
  renderConviction();
  setRoomTab("debate");
  hideTyping();
  elements.followupInput.disabled = true;
  elements.followupButton.disabled = true;
  elements.begin.disabled = false;
  elements.roomTitle.textContent = "Live research requires self-hosting";
  elements.sessionChip.textContent = "Self-host";
  setStatus("Live setup", false);
  renderFailure({
    code: "self_host_required",
    message:
      "This public hosted demo does not run visitor-funded live research or collect browser API keys. Use the Live tab helper to fork/deploy your own copy, then add OPENAI_API_KEY in your Render environment."
  });
}

function beginDebate() {
  const ticker = elements.ticker.value.trim();
  const question = elements.question.value.trim();

  if (state.eventSource) state.eventSource.close();

  if (state.experienceMode === "showcase" || isStaticDemoHost()) {
    beginStaticDebate(ticker, question, "Showcase replay");
    return;
  }

  if (state.serverCapabilities && !state.serverCapabilities.liveResearch) {
    renderLiveUnavailable();
    return;
  }

  state.staticRunId += 1;
  state.mode = "server";
  state.sessionId = null;
  state.complete = false;
  state.messageQueue = Promise.resolve();
  state.researchStages = new Map();
  state.researchPacket = null;
  state.evidenceMap = new Map();
  state.activeRoomTab = "debate";
  state.lastError = null;
  state.conviction = {};
  state.convictionHistory = {};
  elements.feed.innerHTML = "";
  elements.researchTimeline.innerHTML = "";
  elements.researchTimeline.hidden = false;
  elements.researchSummary.innerHTML = "";
  elements.evidenceList.innerHTML = "";
  elements.coverageChip.textContent = "No packet";
  renderDataPanel(null);
  setRoomTab("debate");
  elements.typing.hidden = true;
  elements.followupInput.disabled = true;
  elements.followupButton.disabled = true;
  elements.begin.disabled = true;
  setStatus("Researching", true);
  elements.roomTitle.textContent = `${ticker ? ticker.toUpperCase() : "Ticker"} research queue`;
  elements.sessionChip.textContent = "Research first";

  const params = new URLSearchParams({ ticker, question });
  const source = new EventSource(`/api/debate?${params.toString()}`);
  state.eventSource = source;

  source.addEventListener("session", (event) => {
    const payload = JSON.parse(event.data);
    state.sessionId = payload.sessionId;
    state.agents = payload.agents;
    state.mode = payload.mode || "server";
    renderAgents();
    renderMetrics(null);
    renderConviction();
    elements.roomTitle.textContent = `${payload.ticker || ticker.toUpperCase()} research in progress`;
    elements.sessionChip.textContent = payload.sessionId.slice(0, 8);
    setStatus(payload.mode === "static" ? "Showcase replay" : "Researching", true);
  });

  source.addEventListener("research_stage", (event) => {
    const payload = JSON.parse(event.data);
    updateResearchStage(payload);
    const active = payload.status === "active" ? payload.label : "Researching";
    setStatus(active, payload.status !== "failed");
  });

  source.addEventListener("research_packet_summary", (event) => {
    const payload = JSON.parse(event.data);
    state.researchPacket = payload;
    state.evidenceMap = new Map((payload.evidenceItems || []).map((item) => [item.evidenceId, item]));
    if (payload.initialConviction) state.conviction = payload.initialConviction;
    if (payload.convictionHistory) state.convictionHistory = payload.convictionHistory;
    renderResearchSummary(payload);
    renderMetrics(payload);
    renderEvidence(payload);
    renderDataPanel(payload);
    renderConviction();
    elements.roomTitle.textContent = `${payload.resolvedTicker} research packet ready`;
    elements.coverageChip.textContent = `${payload.dataCoverageScore ?? 0}/100`;
  });

  source.addEventListener("typing", (event) => {
    const payload = JSON.parse(event.data);
    showTyping(payload);
  });

  source.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    hideTyping();
    elements.researchTimeline.hidden = true;
    queueMessage(message, true);
  });

  source.addEventListener("conviction", (event) => {
    const payload = JSON.parse(event.data);
    state.conviction = payload.conviction;
    state.convictionHistory = payload.convictionHistory;
    renderConviction();
  });

  source.addEventListener("complete", (event) => {
    const payload = JSON.parse(event.data);
    state.conviction = payload.conviction;
    state.convictionHistory = payload.convictionHistory;
    state.complete = true;
    renderConviction();
    setStatus("Follow-up open", false);
    elements.begin.disabled = false;
    elements.followupInput.disabled = false;
    elements.followupButton.disabled = false;
    elements.followupInput.focus();
    source.close();
  });

  source.addEventListener("error", (event) => {
    if (!event.data) return;
    const payload = JSON.parse(event.data);
    state.lastError = payload;
    hideTyping();
    renderFailure(payload);
    setStatus("Failed", false);
    elements.begin.disabled = false;
    elements.followupInput.disabled = true;
    elements.followupButton.disabled = true;
    source.close();
  });

  source.onerror = () => {
    if (state.lastError) return;
    if (!state.complete) {
      source.close();
      renderFailure({ code: "stream_interrupted", message: "The research stream was interrupted." });
      setStatus("Stream interrupted", false);
      elements.begin.disabled = false;
    }
  };
}

async function sendFollowUp() {
  const message = elements.followupInput.value.trim();
  if (!message || !state.sessionId || !state.complete) return;

  elements.followupInput.value = "";
  elements.followupInput.disabled = true;
  elements.followupButton.disabled = true;

  const userMessage = {
    id: crypto.randomUUID(),
    agentId: "user",
    name: "You",
    title: "Joined the floor",
    short: "YOU",
    timestamp: new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }),
    body: message,
    citations: []
  };

  queueMessage(userMessage, false);
  setStatus("Agents reading", true);

  if (state.mode === "static") {
    await sendStaticFollowUp(message, userMessage);
    return;
  }

  try {
    const response = await fetch("/api/followup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: state.sessionId, message })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || "Follow-up failed");

    for (const reply of payload.messages) {
      showTyping({ name: reply.name, title: reply.title });
      await delay(500);
      hideTyping();
      queueMessage(reply, true);
    }

    state.conviction = payload.conviction;
    state.convictionHistory = payload.convictionHistory;
    renderConviction();
    setStatus("Follow-up open", false);
  } catch (error) {
    setStatus("Could not send", false);
    renderFailure({ code: "followup_failed", message: error.message });
  } finally {
    elements.followupInput.disabled = false;
    elements.followupButton.disabled = false;
    elements.followupInput.focus();
  }
}

function queueMessage(message, animated) {
  state.messageQueue = state.messageQueue.then(() => renderMessage(message, animated));
  return state.messageQueue;
}

async function loadShowcaseReplay(ticker) {
  try {
    if (!showcaseReplayCache) {
      const response = await fetch("/showcases/replays.json");
      if (!response.ok) throw new Error(`Replay fetch failed: ${response.status}`);
      showcaseReplayCache = await response.json();
    }
    return showcaseReplayCache?.replays?.[ticker] || null;
  } catch {
    return null;
  }
}

async function beginStaticDebate(ticker, question, label = "Showcase replay") {
  const runId = (state.staticRunId += 1);
  const normalizedTicker = ticker.toUpperCase().replace(/[^A-Z0-9.:-]/g, "").slice(0, 14) || "NVDA";
  const random = mulberry32(hashString(`${normalizedTicker}:${question || "demo"}`));
  const replay = await loadShowcaseReplay(normalizedTicker);

  state.mode = "static";
  state.sessionId = `demo-${Date.now().toString(36)}`;
  state.complete = false;
  state.messageQueue = Promise.resolve();
  state.staticReplay = replay;
  state.staticMetrics = replay?.metrics || buildStaticMetrics(normalizedTicker, random);
  state.staticHistory = [];
  state.staticFollowUpCount = 0;
  state.researchStages = new Map();
  state.researchPacket = replay?.researchPacket || buildStaticResearchPacket(normalizedTicker, state.staticMetrics);
  state.evidenceMap = new Map((state.researchPacket.evidenceItems || []).map((item) => [item.evidenceId, item]));
  state.activeRoomTab = "debate";
  state.lastError = null;
  state.conviction = replay?.initialConviction || { marcus: 34, yara: -31, kenji: 0, sofia: 6, skeptic: 0 };
  state.convictionHistory = Object.fromEntries(
    Object.keys(state.conviction).map((agentId) => [agentId, [state.conviction[agentId]]])
  );

  elements.feed.innerHTML = "";
  elements.researchTimeline.innerHTML = "";
  elements.researchTimeline.hidden = true;
  elements.typing.hidden = true;
  elements.followupInput.disabled = true;
  elements.followupButton.disabled = true;
  elements.begin.disabled = true;
  elements.roomTitle.textContent = `${state.researchPacket.resolvedTicker} saved replay`;
  elements.sessionChip.textContent = state.sessionId.slice(0, 8);
  setStatus(label, true);
  renderResearchSummary(state.researchPacket);
  renderMetrics(state.researchPacket);
  renderEvidence(state.researchPacket);
  renderDataPanel(state.researchPacket);
  setRoomTab("debate");
  renderConviction();

  const plan = replay?.turns?.length
    ? replay.turns.map((turn) => replayTurnToMessage(turn))
    : buildStaticPlan(normalizedTicker, question, state.staticMetrics, random);

  for (const message of plan) {
    if (runId !== state.staticRunId) return;
    showTyping(message);
    await delay(720 + random() * 480);
    hideTyping();
    applyStaticConviction(message);
    state.staticHistory.push(message);
    await queueMessage(message, true);
    renderConviction();
    await delay(260 + random() * 420);
  }

  if (runId !== state.staticRunId) return;
  const moderator = replay?.moderator ? replayModeratorToMessage(replay.moderator, normalizedTicker) : buildStaticModerator(normalizedTicker);
  showTyping(moderator);
  await delay(900);
  hideTyping();
  state.staticHistory.push(moderator);
  await queueMessage(moderator, true);
  state.complete = true;
  setStatus("Follow-up open", false);
  elements.begin.disabled = false;
  elements.followupInput.disabled = false;
  elements.followupButton.disabled = false;
  elements.followupInput.focus();
}

function replayTurnToMessage(turn) {
  const agent = fallbackAgents.find((item) => item.id === turn.agentId) || fallbackAgents[0];
  return {
    id: crypto.randomUUID(),
    agentId: agent.id,
    name: agent.name,
    title: agent.title,
    short: agent.short,
    color: agent.color,
    timestamp: timestamp(),
    body: turn.body,
    citedEvidenceIds: turn.citedEvidenceIds || [],
    citations: turn.citations || [],
    bid: turn.bid || { score: 8.6, reason: "Saved showcase replay selected this speaker." },
    effects: turn.effects || turn.convictionDeltaByAgent || {},
    rationaleTag: turn.rationaleTag || "saved replay evidence update"
  };
}

function replayModeratorToMessage(moderator, ticker) {
  return {
    id: crypto.randomUUID(),
    agentId: "moderator",
    name: "Moderator",
    title: "Desk Chair",
    short: "MOD",
    color: "#d9e1ea",
    timestamp: timestamp(),
    body: moderator.body || `Moderator wrap on ${ticker}: saved showcase replay complete.`,
    citedEvidenceIds: moderator.citedEvidenceIds || [],
    citations: moderator.citations || ["saved replay"],
    effects: moderator.effects || {}
  };
}

async function sendStaticFollowUp(message) {
  try {
    state.staticFollowUpCount += 1;
    state.staticHistory.push({
      id: crypto.randomUUID(),
      agentId: "user",
      name: "You",
      title: "Joined the floor",
      short: "YOU",
      timestamp: timestamp(),
      body: message,
      citations: []
    });
    const replies = buildStaticFollowUpReplies(message);
    for (const reply of replies) {
      showTyping(reply);
      await delay(520);
      hideTyping();
      applyStaticConviction(reply);
      state.staticHistory.push(reply);
      await queueMessage(reply, true);
      renderConviction();
    }
    setStatus("Follow-up open", false);
  } finally {
    elements.followupInput.disabled = false;
    elements.followupButton.disabled = false;
    elements.followupInput.focus();
  }
}

function buildStaticPlan(ticker, question, metrics, random) {
  const context = question ? ` The user's frame is: "${question}".` : "";
  const finalBull = random() > 0.5;
  const lines = [
    staticMessage(
      "marcus",
      `${ticker} looks expensive only if you freeze the denominator.${context} Forward revisions are up ${metrics.revisionUpPct}%, and that is the part bears keep underestimating. If the earnings base is moving, today's P/E is a stale argument.`,
      ["revision tape", "growth durability"],
      { marcus: 7, sofia: 2 }
    ),
    staticMessage(
      "yara",
      `@Marcus revisions are not cash. Free cash flow yield is ${metrics.fcfYieldPct}% and accrual pressure is ${metrics.accrualPressure}/100. I want cash conversion before I let a story call itself inevitable.`,
      ["cash conversion", "quality of earnings"],
      { yara: -7, marcus: -3 }
    ),
    staticMessage(
      "kenji",
      `Data check: ${ticker} 60d realized vol is ${metrics.realizedVolPct}%, implied vol is ${metrics.impliedVolPct}%, beta is ${metrics.beta}. The market is admitting uncertainty, even if the room wants clean conviction.`,
      ["volatility sheet", "factor snapshot"],
      { kenji: metrics.impliedVolPct < metrics.realizedVolPct ? -3 : 3 }
    ),
    staticMessage(
      "sofia",
      `The single-name debate needs a macro frame. Rate sensitivity is ${metrics.rateSensitivity}/100 and USD exposure is ${metrics.usdExposurePct}%. Execution can be good while the discount rate still compresses the multiple.`,
      ["rates path", "FX exposure"],
      { sofia: metrics.rateSensitivity > 55 ? -5 : 5 }
    ),
    staticMessage(
      "skeptic",
      `Pause. Marcus is using revisions as demand, Yara is using cash conversion as proof of fragility, and neither is direct evidence. Where is usage, renewal quality, retention, or workload data?`,
      ["assumption audit"],
      { marcus: -4, yara: 2, sofia: -1 }
    ),
    staticMessage(
      "marcus",
      `@The Skeptic fair. But power-law stocks rarely give you clean direct evidence at the exact moment it matters. If revenue growth is ${metrics.revenueGrowthPct}% with gross margin near ${metrics.grossMarginPct}%, the market will pay for optionality.`,
      ["operating leverage"],
      { marcus: 5 }
    ),
    staticMessage(
      "yara",
      `@Marcus optionality is what people say when they do not want to price dilution, working capital, or customer concentration. If receivables keep outrunning revenue, the thesis shifts from growth scarcity to earnings quality.`,
      ["working capital"],
      { yara: -6, marcus: -2 }
    ),
    staticMessage(
      "kenji",
      `I am marking the room's error bars as too narrow. Estimate dispersion is ${metrics.estimateDispersionPct}%. Bull and bear both depend on second derivative evidence, not just this quarter's direction.`,
      ["estimate dispersion"],
      { kenji: 2, marcus: -1, yara: 1 }
    ),
    staticMessage(
      "sofia",
      `Cycle risk is real, but transmission matters. Does macro hit demand, customer budgets, funding conditions, FX translation, or just the multiple? Those are different failure modes.`,
      ["macro transmission"],
      { sofia: 3 }
    ),
    staticMessage(
      "skeptic",
      `The room keeps reaching for analogies. Which year is the comp, and what variable makes it valid? If you cannot name the variable, the analogy is decoration.`,
      ["bias check"],
      { marcus: -3, yara: 1, sofia: -2 }
    ),
    staticMessage(
      finalBull ? "marcus" : "yara",
      finalBull
        ? `My final push: if revisions remain clustered positive, the bear case has to explain why every customer and every analyst is wrong at the same time. That can happen, but it is a high bar.`
        : `My final push: the bull case still assumes the market will keep capitalizing future growth before cash evidence arrives. That is not analysis; that is patience funded by liquidity.`,
      ["closing view"],
      finalBull ? { marcus: 4 } : { yara: -4 }
    )
  ];

  return lines;
}

function staticMessage(agentId, body, citations, effects) {
  const agent = fallbackAgents.find((item) => item.id === agentId);
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
    bid: { score: 8.4, reason: "Showcase replay selected this speaker." },
    effects
  };
}

function buildStaticModerator(ticker) {
  return {
    id: crypto.randomUUID(),
    agentId: "moderator",
    name: "Moderator",
    title: "Desk Chair",
    short: "MOD",
    color: "#d9e1ea",
    timestamp: timestamp(),
    body: [
      `Moderator wrap on ${ticker}:`,
      "",
      "This showcase replay demonstrates the debate mechanics: evidence quality, speaker routing, conviction updates, and follow-up behavior. Marcus wants to underwrite revision momentum and operating leverage. Yara refuses to accept narrative until cash conversion improves. Kenji says the distribution is wider than anyone's language. Sofia separates fundamentals from discount-rate and policy risk. The Skeptic's strongest intervention was forcing the room to stop treating proxies as direct demand evidence.",
      "",
      "No recommendation. This is a public replay, not live research or a trade instruction."
    ].join("\n"),
    citations: ["debate transcript", "conviction tracker"],
    effects: {}
  };
}

function buildStaticFollowUpReplies(body) {
  const metrics = state.staticMetrics;
  const selected = selectStaticFollowUpSpeakers(body);
  const repliesByAgent = {
    marcus: [
      `@You I'll jump in. The bull case needs a sharper test: can ${metrics.ticker} keep revision momentum near ${metrics.revisionUpPct}% without giving back gross margin?`,
      `@You fair. If this debate is going to earn attention, my claim has to be falsifiable: revisions flattening would make me reduce conviction fast.`,
      `@You different angle from Skeptic: optionality is not magic. It has to show up as operating leverage, or the multiple is doing too much work.`
    ],
    yara: [
      `@You I agree the room should not loop. I want the discussion centered on cash conversion, working capital, and whether revenue quality is as clean as the headline growth.`,
      `@You if the answer feels generic, the fix is sharper failure modes. For ${metrics.ticker}, I would ask what breaks first: demand, margins, or accounting quality.`,
      `@You my contribution is simple: narrative is cheap until cash proves it. If cash flow improves, my bear case should weaken; if not, the story is carrying too much weight.`
    ],
    kenji: [
      `@You yes, another voice should enter. I would define a table first: realized vol ${metrics.realizedVolPct}%, implied vol ${metrics.impliedVolPct}%, estimate dispersion ${metrics.estimateDispersionPct}%, and cash conversion.`,
      `@You the repeated answer is a routing problem. A better room needs one claim, one observable, and one conviction update from each analyst.`,
      `@You I do not want more words; I want better measurement. Ask each analyst what number would change their mind, then track whether they actually update.`
    ],
    sofia: [
      `@You I'll add the macro channel. Rate sensitivity is ${metrics.rateSensitivity}/100, so even a good company-level thesis can lose if discount rates reprice.`,
      `@You the debate should separate business execution from market regime. FX exposure near ${metrics.usdExposurePct}% and customer budget cycles are not background details.`,
      `@You more analysts should join only if they widen the frame. My question is whether the cycle hits demand, financing conditions, or just valuation.`
    ],
    skeptic: [
      `@You agreed, repeating the proxy point is not enough. The next useful question is what single datapoint would force each analyst to lower conviction.`,
      `@You more voices can still be fake depth if everyone uses the same missing evidence. I want adversarial updating, not a chorus.`,
      `@You the room should ask: what would prove Marcus wrong, what would prove Yara wrong, and what would make Kenji's distribution narrower?`
    ]
  };

  return selected.map((bid, index) => {
    const pool = repliesByAgent[bid.agentId];
    const variant = hashString(`${body}:${bid.agentId}:${state.staticFollowUpCount}:${index}`) % pool.length;
    return staticMessage(
      bid.agentId,
      pool[variant],
      ["follow-up bid", "shared transcript"],
      bid.agentId === "marcus" ? { marcus: 3 } : bid.agentId === "yara" ? { yara: -3 } : bid.agentId === "sofia" ? { sofia: 2 } : {}
    );
  });
}

function selectStaticFollowUpSpeakers(body) {
  const bids = scoreStaticFollowUpBids(body);
  const direct = findMentionedAgent(body);
  const asksForOthers = /any\s?one else|anyone else|anybody else|someone else|who else|others?|jump in|talk more|chime|其他|還有|誰要|有人要/i.test(body);
  const wantsDepth = /why|evidence|specific|data|number|compare|comp|assumption|debate|more|怎麼|為什麼|證據|數據|更多|辯論/i.test(body);
  const targetCount = direct && !asksForOthers ? (wantsDepth ? 2 : 1) : asksForOthers ? 3 : wantsDepth ? 2 : 1;
  return bids.slice(0, targetCount);
}

function scoreStaticFollowUpBids(body) {
  const direct = findMentionedAgent(body);
  const recentAgents = state.staticHistory
    .filter((message) => fallbackAgents.some((agent) => agent.id === message.agentId))
    .slice(-5)
    .map((message) => message.agentId);
  const lastAgent = recentAgents.at(-1);
  const asksForOthers = /any\s?one else|anyone else|anybody else|someone else|who else|others?|jump in|talk more|chime|其他|還有|誰要|有人要/i.test(body);
  const isMetaCritique = /not good|isn't good|bad|same|repeat|repeated|boring|generic|robotic|doesn't feel|dont think|don't think|不好|一樣|重複|無聊|不像|即時|沒辦法/i.test(body);
  const bids = {
    marcus: { score: 3.8, reason: "Upside case can respond." },
    yara: { score: 3.8, reason: "Bear case can sharpen quality critique." },
    kenji: { score: 3.6, reason: "Quant can define measurement." },
    sofia: { score: 3.3, reason: "Macro can add context." },
    skeptic: { score: 3.1, reason: "Skeptic can audit assumptions." }
  };

  if (direct) bids[direct].score += 6.2;
  if (asksForOthers) {
    for (const agentId of Object.keys(bids)) bids[agentId].score += 2.3;
    if (lastAgent) bids[lastAgent].score -= 4.4;
  }
  if (isMetaCritique) {
    bids.yara.score += 2.8;
    bids.kenji.score += 2.3;
    bids.marcus.score += 1.5;
    bids.skeptic.score -= 1.1;
  }
  if (/data|number|proof|evidence|specific|year|comp|vol|margin|table|數據|證據|哪一年|對標/i.test(body)) bids.kenji.score += 3.6;
  if (/cash|account|fraud|short|bear|quality|現金流|會計|空頭/i.test(body)) bids.yara.score += 3.4;
  if (/rate|macro|policy|fx|currency|cycle|imf|政策|匯率|利率|總經/i.test(body)) bids.sofia.score += 3.4;
  if (/bull|growth|revision|upside|moat|成長|上修|樂觀/i.test(body)) bids.marcus.score += 3.3;
  if (/assumption|bias|logic|why|demand|priced|consensus|skeptic|假設|邏輯|需求|共識/i.test(body)) bids.skeptic.score += 3.4;

  for (const agentId of Object.keys(bids)) {
    const recentCount = recentAgents.filter((id) => id === agentId).length;
    bids[agentId].score -= recentCount * 0.9;
    if (lastAgent === agentId) bids[agentId].score -= 1.7;
  }

  return Object.entries(bids)
    .map(([agentId, bid]) => ({ agentId, score: Math.max(0, Math.min(10, bid.score)), reason: bid.reason }))
    .sort((a, b) => b.score - a.score);
}

function applyStaticConviction(message) {
  for (const [agentId, delta] of Object.entries(message.effects || {})) {
    if (!(agentId in state.conviction)) continue;
    state.conviction[agentId] = Math.max(-100, Math.min(100, state.conviction[agentId] + delta));
  }

  if (message.agentId === "skeptic") {
    for (const agentId of ["marcus", "yara", "sofia"]) {
      const current = state.conviction[agentId];
      state.conviction[agentId] = current > 0 ? Math.max(0, current - 2) : Math.min(0, current + 2);
    }
  }

  for (const agentId of Object.keys(state.convictionHistory)) {
    state.convictionHistory[agentId].push(state.conviction[agentId]);
  }
}

function buildStaticMetrics(ticker, random) {
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
    rateSensitivity: Math.round(25 + random() * 60),
    usdExposurePct: Math.round(28 + random() * 54)
  };
}

function buildStaticResearchPacket(ticker, metrics) {
  return {
    resolvedTicker: ticker,
    displayName: `${ticker} Showcase Replay`,
    exchange: "DEMO",
    currency: "USD",
    marketState: "REPLAY",
    latestPrice: 100,
    priceChange: 1.2,
    marketCap: 100000000000,
    sector: "Demo",
    industry: "Showcase mode",
    businessSummary: "Showcase mode demonstrates the room mechanics with a saved replay packet. Live mode researches the ticker first in a self-hosted deployment.",
    keyStats: {
      trailingPE: metrics.pe,
      beta: metrics.beta,
      revenueGrowth: metrics.revenueGrowthPct / 100,
      grossMargins: metrics.grossMarginPct / 100
    },
    recentPriceContext: { periodReturnPct: 8.4, observations: ["Saved replay price context for showcase mode only."] },
    filingOrDisclosureSummary: { available: false, summary: "Showcase replay does not fetch live filings.", recentFilings: [] },
    evidenceItems: [
      {
        evidenceId: "D01",
        sourceType: "showcase_replay",
        sourceLabel: "Showcase replay packet",
        sourceUrl: null,
        timestamp: new Date().toISOString(),
        claim: "This packet is a saved public showcase replay, not live market research.",
        importance: 1,
        analystRelevance: ["skeptic"]
      }
    ],
    researchWarnings: ["Showcase replay is not live market research."],
    dataCoverageScore: 0,
    readyForDebate: true,
    companySnapshot: "Saved showcase replay. Self-host with an OpenAI API key for live research.",
    analystPriors: null
  };
}

function isStaticDemoHost() {
  return new URLSearchParams(window.location.search).get("static") === "1";
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

async function renderMessage(message, animated) {
  const article = document.createElement("article");
  article.className = `message ${message.agentId || ""}`;
  article.style.setProperty("--agent-color", message.color || "#50e3a4");

  if (message.agentId === "moderator") article.classList.add("moderator");
  if (message.agentId === "user") article.classList.add("user");

  const header = document.createElement("div");
  header.className = "message-header";

  const code = document.createElement("span");
  code.className = "message-code";
  code.textContent = message.short || "DESK";

  const name = document.createElement("span");
  name.className = "message-name";
  name.textContent = message.name;

  const title = document.createElement("span");
  title.className = "message-title";
  title.textContent = message.title ? `(${message.title})` : "";

  const time = document.createElement("span");
  time.className = "message-time";
  time.textContent = message.timestamp || "";

  header.append(code, name, title, time);

  const body = document.createElement("div");
  body.className = "message-body";

  article.append(header, body);

  const citationItems = message.citedEvidenceIds?.length ? message.citedEvidenceIds : message.citations || [];
  if (citationItems.length) {
    const citations = document.createElement("div");
    citations.className = "citation-list";
    for (const item of citationItems) {
      const evidence = state.evidenceMap.get(item);
      const chip = document.createElement(evidence ? "button" : "span");
      if (evidence) chip.type = "button";
      chip.textContent = evidence ? `${item} · ${evidence.sourceLabel}` : item;
      if (evidence) {
        chip.addEventListener("click", () => focusEvidence(item));
      }
      citations.append(chip);
    }
    article.append(citations);
  }

  elements.feed.append(article);
  scrollFeed();

  if (!animated) {
    body.textContent = message.body;
    scrollFeed();
    return;
  }

  await typeText(body, message.body);
  scrollFeed();
}

async function typeText(node, text) {
  node.textContent = "";
  for (let index = 0; index < text.length; index += 1) {
    node.textContent += text[index];
    if (index % 5 === 0) scrollFeed();
    await delay(text[index] === "\n" ? 35 : 8);
  }
}

function showTyping(payload) {
  elements.typing.textContent = `${payload.name} is typing`;
  elements.typing.hidden = false;
}

function hideTyping() {
  elements.typing.hidden = true;
  elements.typing.textContent = "";
}

function setStatus(text, live) {
  elements.roomStatus.textContent = text;
  elements.roomStatus.classList.toggle("live", Boolean(live));
}

function setRoomTab(tab) {
  const next = tab === "data" ? "data" : "debate";
  state.activeRoomTab = next;

  for (const button of elements.roomTabButtons) {
    const active = button.dataset.roomTab === next;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }

  elements.debatePanel.hidden = next !== "debate";
  elements.dataPanel.hidden = next !== "data";
}

function updateResearchStage(stage) {
  if (!stage?.stage) return;
  state.researchStages.set(stage.stage, stage);
  renderResearchTimeline();
}

function renderResearchTimeline() {
  const order = [
    "resolving_ticker",
    "fetching_market_data",
    "fetching_company_profile",
    "fetching_disclosures",
    "building_research_packet",
    "assigning_analyst_priors",
    "ready_to_debate"
  ];
  elements.researchTimeline.innerHTML = "";

  for (const key of order) {
    const stage = state.researchStages.get(key);
    if (!stage) continue;
    const row = document.createElement("div");
    row.className = `stage-row ${stage.status}`;

    const dot = document.createElement("span");
    dot.className = "stage-dot";

    const copy = document.createElement("div");
    copy.className = "stage-copy";

    const label = document.createElement("strong");
    label.textContent = stage.label;

    const meta = document.createElement("span");
    meta.textContent = stage.detail || stage.status;

    copy.append(label, meta);
    row.append(dot, copy);
    elements.researchTimeline.append(row);
  }
}

function renderFailure(error) {
  const article = document.createElement("article");
  article.className = "message moderator failure-card";

  const header = document.createElement("div");
  header.className = "message-header";
  const code = document.createElement("span");
  code.className = "message-code";
  code.textContent = "FAIL";
  const name = document.createElement("span");
  name.className = "message-name";
  name.textContent = "Research stopped";
  const title = document.createElement("span");
  title.className = "message-title";
  title.textContent = `(${error.code || "error"})`;
  header.append(code, name, title);

  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = error.message || "The room could not start a real research-backed debate.";

  article.append(header, body);
  elements.feed.append(article);
  scrollFeed();
}

function renderResearchSummary(packet) {
  if (!packet) {
    elements.researchSummary.innerHTML = "";
    return;
  }

  const warnings = packet.researchWarnings || [];
  elements.researchSummary.innerHTML = "";

  const title = document.createElement("div");
  title.className = "research-summary-title";
  const strong = document.createElement("strong");
  strong.textContent = packet.displayName || packet.resolvedTicker || "Research packet";
  const span = document.createElement("span");
  span.textContent = [packet.exchange, packet.currency, packet.marketState].filter(Boolean).join(" · ");
  title.append(strong, span);

  const snapshot = document.createElement("p");
  snapshot.textContent = packet.companySnapshot || packet.businessSummary || "Research packet created from available market data.";

  elements.researchSummary.append(title, snapshot);

  if (packet.analystPriors) {
    const priors = document.createElement("div");
    priors.className = "prior-list";
    for (const agent of state.agents) {
      const prior = packet.analystPriors[agent.id];
      if (!prior) continue;
      const item = document.createElement("p");
      const label = document.createElement("strong");
      label.textContent = agent.name;
      item.append(label, document.createTextNode(` ${prior}`));
      priors.append(item);
    }
    elements.researchSummary.append(priors);
  }

  if (warnings.length) {
    const warning = document.createElement("p");
    warning.className = "research-warning";
    warning.textContent = warnings.slice(0, 2).join(" ");
    elements.researchSummary.append(warning);
  }
}

function renderEvidence(packet) {
  elements.evidenceList.innerHTML = "";
  const items = packet?.evidenceItems || [];
  elements.coverageChip.textContent = packet ? `${packet.dataCoverageScore ?? 0}/100` : "No packet";

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "empty-evidence";
    empty.textContent = "No evidence packet yet.";
    elements.evidenceList.append(empty);
    return;
  }

  for (const item of items) {
    const card = document.createElement(item.sourceUrl ? "a" : "div");
    card.className = "evidence-card";
    card.id = `evidence-${item.evidenceId}`;
    if (item.sourceUrl) {
      card.href = item.sourceUrl;
      card.target = "_blank";
      card.rel = "noreferrer";
    }

    const head = document.createElement("div");
    head.className = "evidence-head";
    const id = document.createElement("strong");
    id.textContent = item.evidenceId;
    const source = document.createElement("span");
    source.textContent = item.sourceLabel;
    head.append(id, source);

    const claim = document.createElement("p");
    claim.textContent = item.claim;

    card.append(head, claim);
    elements.evidenceList.append(card);
  }
}

function renderDataPanel(packet) {
  elements.dataPanel.innerHTML = "";

  if (!packet) {
    const empty = document.createElement("div");
    empty.className = "data-empty";
    empty.textContent = "Run a ticker research flow to populate the data room.";
    elements.dataPanel.append(empty);
    return;
  }

  const header = document.createElement("div");
  header.className = "data-room-header";
  const title = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "DATA ROOM";
  const heading = document.createElement("h3");
  heading.textContent = `${packet.resolvedTicker} research packet`;
  const meta = document.createElement("span");
  meta.textContent = [packet.displayName, packet.exchange, packet.currency, `coverage ${packet.dataCoverageScore ?? 0}/100`]
    .filter(Boolean)
    .join(" · ");
  title.append(eyebrow, heading, meta);
  header.append(title);
  elements.dataPanel.append(header);

  const quoteGrid = document.createElement("div");
  quoteGrid.className = "data-grid";
  for (const [label, value] of [
    ["Latest price", formatCurrency(packet.latestPrice, packet.currency)],
    ["Price change", formatSigned(packet.priceChange)],
    ["Market cap", formatMarketCap(packet.marketCap)],
    ["Market state", packet.marketState || "n/a"],
    ["Sector", packet.sector || "n/a"],
    ["Industry", packet.industry || "n/a"],
    ["6mo return", packet.recentPriceContext?.periodReturnPct == null ? "n/a" : `${packet.recentPriceContext.periodReturnPct}%`]
  ]) {
    quoteGrid.append(dataMetric(label, value));
  }
  elements.dataPanel.append(sectionBlock("Market Snapshot", quoteGrid));

  const keyStats = document.createElement("div");
  keyStats.className = "data-table";
  const stats = packet.keyStats || {};
  for (const [label, key, digits] of [
    ["Trailing P/E", "trailingPE", 1],
    ["Forward P/E", "forwardPE", 1],
    ["Beta", "beta", 2],
    ["EV/EBITDA", "enterpriseToEbitda", 1],
    ["Price/book", "priceToBook", 1],
    ["Revenue growth", "revenueGrowth", 1],
    ["Gross margin", "grossMargins", 1],
    ["Operating margin", "operatingMargins", 1],
    ["Free cash flow", "freeCashflow", 0],
    ["Operating cash flow", "operatingCashflow", 0],
    ["Total debt", "totalDebt", 0],
    ["SEC revenue", "secRevenue", 0],
    ["SEC net income", "secNetIncome", 0],
    ["SEC assets", "secAssets", 0],
    ["SEC cash", "secCashAndEquivalents", 0],
    ["SEC fiscal year", "secFiscalYear", 0],
    ["SEC fiscal period", "secFiscalPeriod", 0],
    ["SEC period end", "secPeriodEnd", 0],
    ["SEC form", "secForm", 0]
  ]) {
    keyStats.append(dataRow(label, formatStatValue(key, stats[key], digits)));
  }
  elements.dataPanel.append(sectionBlock("Key Statistics", keyStats));

  const disclosure = packet.filingOrDisclosureSummary || {};
  const disclosureBlock = document.createElement("div");
  disclosureBlock.className = "data-table";
  disclosureBlock.append(dataRow("Availability", disclosure.available ? "Available" : "Unavailable"));
  disclosureBlock.append(dataRow("Summary", disclosure.summary || "n/a"));
  for (const filing of disclosure.recentFilings || []) {
    const label = [filing.form, filing.filingDate].filter(Boolean).join(" · ") || "Filing";
    disclosureBlock.append(dataRow(label, filing.url || filing.accessionNumber || filing.reportDate || "n/a"));
  }
  elements.dataPanel.append(sectionBlock("Filings / Disclosures", disclosureBlock));

  if (packet.researchWarnings?.length) {
    const warnings = document.createElement("div");
    warnings.className = "data-warning-list";
    for (const warning of packet.researchWarnings) {
      const item = document.createElement("p");
      item.textContent = warning;
      warnings.append(item);
    }
    elements.dataPanel.append(sectionBlock("Warnings", warnings));
  }

  const evidence = document.createElement("div");
  evidence.className = "data-evidence-grid";
  for (const item of packet.evidenceItems || []) {
    const card = document.createElement(item.sourceUrl ? "a" : "div");
    card.className = "data-evidence-card";
    if (item.sourceUrl) {
      card.href = item.sourceUrl;
      card.target = "_blank";
      card.rel = "noreferrer";
    }
    const cardHead = document.createElement("strong");
    cardHead.textContent = `${item.evidenceId} · ${item.sourceLabel}`;
    const claim = document.createElement("p");
    claim.textContent = item.claim;
    card.append(cardHead, claim);
    evidence.append(card);
  }
  elements.dataPanel.append(sectionBlock("Evidence Items", evidence));

  const raw = document.createElement("details");
  raw.className = "raw-packet";
  const summary = document.createElement("summary");
  summary.textContent = "Raw packet";
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(packet, null, 2);
  raw.append(summary, pre);
  elements.dataPanel.append(raw);
}

function sectionBlock(title, content) {
  const section = document.createElement("section");
  section.className = "data-section";
  const heading = document.createElement("h4");
  heading.textContent = title;
  section.append(heading, content);
  return section;
}

function dataMetric(label, value) {
  const cell = document.createElement("div");
  cell.className = "data-metric";
  const strong = document.createElement("strong");
  strong.textContent = value;
  const span = document.createElement("span");
  span.textContent = label;
  cell.append(strong, span);
  return cell;
}

function dataRow(label, value) {
  const row = document.createElement("div");
  row.className = "data-row";
  const left = document.createElement("span");
  left.textContent = label;
  const right = document.createElement("strong");
  right.textContent = value == null || value === "" ? "n/a" : String(value);
  row.append(left, right);
  return row;
}

function formatStatValue(key, value, digits = 1) {
  if (key === "revenueGrowth" || key === "grossMargins" || key === "operatingMargins") {
    return formatPercent(value);
  }
  if (["secFiscalPeriod", "secPeriodEnd", "secForm"].includes(key)) {
    return value || "n/a";
  }
  if (key === "secFiscalYear") {
    return formatValue(value, 0);
  }
  if (key.endsWith("flow") || key === "totalDebt" || key.startsWith("sec")) {
    return formatMarketCap(value);
  }
  return formatValue(value, digits);
}

function focusEvidence(evidenceId) {
  const card = document.querySelector(`#evidence-${CSS.escape(evidenceId)}`);
  if (!card) return;
  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  card.classList.add("highlight");
  window.setTimeout(() => card.classList.remove("highlight"), 1200);
}

function renderAgents() {
  elements.agentList.innerHTML = "";
  for (const agent of state.agents) {
    const row = document.createElement("div");
    row.className = "agent-row";
    row.style.color = agent.color;

    const code = document.createElement("span");
    code.className = "agent-code";
    code.textContent = agent.short;

    const copy = document.createElement("div");
    copy.className = "agent-copy";

    const name = document.createElement("strong");
    name.textContent = agent.name;

    const title = document.createElement("span");
    title.textContent = agent.title;

    copy.append(name, title);
    row.append(code, copy);
    elements.agentList.append(row);
  }
}

function renderMetrics(metrics) {
  elements.metricsGrid.innerHTML = "";
  if (!metrics) return;

  const rows = metrics.resolvedTicker
    ? [
        ["Price", formatCurrency(metrics.latestPrice, metrics.currency)],
        ["Change", formatSigned(metrics.priceChange)],
        ["Market cap", formatMarketCap(metrics.marketCap)],
        ["Coverage", `${metrics.dataCoverageScore ?? 0}/100`],
        ["Sector", metrics.sector || "n/a"],
        ["Industry", metrics.industry || "n/a"],
        ["Forward P/E", formatValue(metrics.keyStats?.forwardPE, 1)],
        ["Beta", formatValue(metrics.keyStats?.beta, 2)],
        ["6mo return", metrics.recentPriceContext?.periodReturnPct == null ? "n/a" : `${metrics.recentPriceContext.periodReturnPct}%`]
      ]
    : [
        ["P/E", metrics.pe],
        ["Rev growth", `${metrics.revenueGrowthPct}%`],
        ["Gross margin", `${metrics.grossMarginPct}%`],
        ["FCF yield", `${metrics.fcfYieldPct}%`],
        ["Realized vol", `${metrics.realizedVolPct}%`],
        ["Implied vol", `${metrics.impliedVolPct}%`],
        ["Beta", metrics.beta],
        ["Rate sens.", `${metrics.rateSensitivity}/100`]
      ];

  for (const [label, value] of rows) {
    const cell = document.createElement("div");
    cell.className = "metric";

    const strong = document.createElement("strong");
    strong.textContent = value;

    const span = document.createElement("span");
    span.textContent = label;

    cell.append(strong, span);
    elements.metricsGrid.append(cell);
  }
}

function renderConviction() {
  elements.convictionList.innerHTML = "";

  for (const agent of state.agents) {
    const value = Number(state.conviction[agent.id] || 0);
    const history = state.convictionHistory[agent.id] || [value];
    const row = document.createElement("div");
    row.className = "conviction-row";
    row.style.setProperty("--agent-color", agent.color);

    const head = document.createElement("div");
    head.className = "conviction-head";

    const name = document.createElement("span");
    name.className = "conviction-name";
    name.textContent = agent.name;

    const score = document.createElement("span");
    score.className = "conviction-value";
    score.textContent = formatScore(value);

    head.append(name, score);

    const track = document.createElement("div");
    track.className = "conviction-track";

    const marker = document.createElement("span");
    marker.className = "conviction-marker";
    marker.style.setProperty("--position", `${((value + 100) / 200) * 100}%`);
    track.append(marker);

    const sparkline = document.createElement("div");
    sparkline.className = "sparkline";
    history.slice(-16).forEach((point, index, visible) => {
      const dot = document.createElement("span");
      dot.className = "spark-dot";
      const x = visible.length <= 1 ? 50 : (index / (visible.length - 1)) * 100;
      const y = 8 - (Number(point) / 100) * 6;
      dot.style.setProperty("--x", `${x}%`);
      dot.style.top = `${Math.max(1, Math.min(13, y))}px`;
      sparkline.append(dot);
    });

    row.append(head, track, sparkline);
    elements.convictionList.append(row);
  }
}

function formatScore(value) {
  if (value > 12) return `Bull +${value}`;
  if (value < -12) return `Bear ${value}`;
  return `Neutral ${value >= 0 ? "+" : ""}${value}`;
}

function formatCurrency(value, currency) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return `${currency || ""} ${number.toLocaleString(undefined, { maximumFractionDigits: 2 })}`.trim();
}

function formatSigned(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}`;
}

function formatMarketCap(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  const abs = Math.abs(number);
  if (abs >= 1_000_000_000_000) return `${(number / 1_000_000_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  return number.toLocaleString();
}

function formatValue(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return number.toFixed(digits);
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  const scaled = Math.abs(number) <= 2 ? number * 100 : number;
  return `${scaled.toFixed(1)}%`;
}

function scrollFeed() {
  elements.feed.scrollTop = elements.feed.scrollHeight;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestamp(date = new Date()) {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function hashString(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function startMarketCanvas() {
  if (state.canvasStarted) return;
  state.canvasStarted = true;

  const canvas = elements.canvas;
  const ctx = canvas.getContext("2d");
  const lanes = Array.from({ length: 18 }, (_, index) => ({
    y: index * 48,
    phase: index * 13,
    color: index % 4 === 0 ? "#50e3a4" : index % 4 === 1 ? "#ff5a64" : index % 4 === 2 ? "#56ccf2" : "#f2c94c"
  }));

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * ratio);
    canvas.height = Math.floor(window.innerHeight * ratio);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function frame(time) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = 0.18;

    for (const lane of lanes) {
      const y = (lane.y + (time / 80 + lane.phase) % 48) % Math.max(height, 1);
      ctx.strokeStyle = lane.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < width; x += 18) {
        const wave = Math.sin((x + time / 28 + lane.phase) / 42) * 13;
        const drift = Math.sin((x + lane.phase) / 90) * 8;
        if (x === 0) ctx.moveTo(x, y + wave + drift);
        else ctx.lineTo(x, y + wave + drift);
      }
      ctx.stroke();
    }

    ctx.globalAlpha = 0.08;
    ctx.fillStyle = "#d9e1ea";
    ctx.font = "12px SFMono-Regular, Menlo, monospace";
    const tape = "THE FLOOR  BID  ASK  REV  VOL  RATES  FX  CASH  CAPEX  ASSUMPTIONS  ";
    const offset = -((time / 22) % 420);
    for (let x = offset; x < width + 420; x += 420) {
      ctx.fillText(tape, x, height - 24);
    }

    requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(frame);
}
