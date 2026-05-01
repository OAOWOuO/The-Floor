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
  { id: "marcus", name: "Marcus", title: "The Bull", short: "BULL", category: "Thesis Desk", color: "#50e3a4" },
  { id: "yara", name: "Yara", title: "The Bear", short: "BEAR", category: "Thesis Desk", color: "#ff5a64" },
  { id: "kenji", name: "Kenji", title: "The Quant", short: "QUANT", category: "Evidence Desk", color: "#56ccf2" },
  { id: "priya", name: "Priya", title: "Forensic Accounting", short: "ACCT", category: "Evidence Desk", color: "#ff9f43" },
  { id: "mei", name: "Mei", title: "Supply Chain", short: "CHAIN", category: "Evidence Desk", color: "#a3e635" },
  { id: "sofia", name: "Sofia", title: "The Macro", short: "MACRO", category: "Risk Desk", color: "#f2c94c" },
  { id: "lucas", name: "Lucas", title: "Regulatory Counsel", short: "REG", category: "Risk Desk", color: "#7fdbca" },
  { id: "omar", name: "Omar", title: "Credit Desk", short: "CRDT", category: "Risk Desk", color: "#c084fc" },
  { id: "skeptic", name: "The Skeptic", title: "Assumption Hunter", short: "SKEPTIC", category: "Epistemic Desk", color: "#b58cff" }
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
  const nextMode = mode === "live" ? "live" : "showcase";
  const modeChanged = state.experienceMode !== nextMode;
  state.experienceMode = nextMode;
  for (const button of elements.experienceButtons) {
    button.classList.toggle("active", button.dataset.experienceMode === state.experienceMode);
  }
  elements.showcasePanel.hidden = state.experienceMode !== "showcase";
  elements.livePanel.hidden = state.experienceMode !== "live";
  elements.begin.textContent = state.experienceMode === "live" ? "Begin live research" : "Play showcase";
  if (modeChanged || !state.sessionId) {
    resetRoomForMode(state.experienceMode);
  }
}

async function refreshHostedStatus() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
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
  if (state.experienceMode === "live" && state.mode === "setup" && !state.sessionId) {
    resetRoomForMode("live", { abortStatic: false });
  }
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

function clearRoomState({ closeStream = true, abortStatic = true } = {}) {
  if (closeStream && state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  if (abortStatic) state.staticRunId += 1;
  state.mode = "setup";
  state.sessionId = null;
  state.complete = false;
  state.messageQueue = Promise.resolve();
  state.staticReplay = null;
  state.staticHistory = [];
  state.staticFollowUpCount = 0;
  state.researchStages = new Map();
  state.researchPacket = null;
  state.evidenceMap = new Map();
  state.activeRoomTab = "debate";
  state.lastError = null;
  state.conviction = {};
  state.convictionHistory = {};
  elements.feed.innerHTML = "";
  elements.researchTimeline.innerHTML = "";
  elements.researchTimeline.hidden = true;
  elements.researchSummary.innerHTML = "";
  renderMetrics(null);
  elements.evidenceList.innerHTML = "";
  elements.coverageChip.textContent = "No packet";
  renderDataPanel(null);
  renderConviction();
  setRoomTab("debate");
  hideTyping();
  elements.followupInput.disabled = true;
  elements.followupButton.disabled = true;
  elements.begin.disabled = false;
}

function resetRoomForMode(mode, options = {}) {
  clearRoomState(options);
  state.agents = fallbackAgents;
  renderAgents();

  if (mode === "live") {
    elements.roomTitle.textContent = "Live research room";
    elements.sessionChip.textContent = "Self-host";
    setStatus("Live setup", false);
    renderRoomNotice({
      code: "LIVE",
      name: state.serverCapabilities?.liveResearch ? "Live room ready" : "Self-host room",
      title: state.serverCapabilities?.liveResearch ? "server key detected" : "server key required",
      message: state.serverCapabilities?.liveResearch
        ? "This is a separate live room. Press Begin live research to run ticker resolution, market data, synthesis, debate, and follow-up with server-side OpenAI."
        : "This hosted demo does not collect visitor API keys. Fork or self-host, set OPENAI_API_KEY on the server, then this room becomes the live research room."
    });
    return;
  }

  elements.roomTitle.textContent = "Showcase room ready";
  elements.sessionChip.textContent = "Showcase";
  setStatus("Showcase", false);
  renderRoomNotice({
    code: "SHOW",
    name: "Showcase room",
    title: "fresh snapshot on play",
    message:
      "This is a separate showcase room. Press Play showcase to fetch a fresh market snapshot and run the audited no-token debate without showing the live research pipeline."
  });
}

function renderLiveUnavailable() {
  clearRoomState();
  elements.roomTitle.textContent = "Live research requires self-hosting";
  elements.sessionChip.textContent = "Self-host";
  setStatus("Live setup", false);
  renderFailure({
    code: "self_host_required",
    message:
      "This public hosted demo does not run visitor-funded live research or collect browser API keys. Use the Live tab helper to fork/deploy your own copy, then add OPENAI_API_KEY in your Render environment."
  });
}

function resetRoomForFailure(status = "Failed") {
  clearRoomState();
  elements.roomTitle.textContent = "Could not start room";
  elements.sessionChip.textContent = "No session";
  setStatus(status, false);
}

function beginDebate() {
  const ticker = elements.ticker.value.trim();
  const question = elements.question.value.trim();

  if (state.eventSource) state.eventSource.close();

  if (state.experienceMode === "showcase" || isStaticDemoHost()) {
    beginStaticDebate(ticker, question, "Showcase room");
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

async function loadShowcaseSnapshot(ticker) {
  const params = new URLSearchParams({
    ticker,
    snapshot: Date.now().toString()
  });
  const response = await fetch(`/api/showcase-snapshot?${params.toString()}`, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `Could not fetch showcase data for ${ticker}.`;
    const error = new Error(message);
    error.code = payload?.error?.code || "showcase_snapshot_failed";
    error.details = payload?.error?.details || {};
    throw error;
  }
  return payload.researchPacket;
}

async function beginStaticDebate(ticker, question, label = "Showcase replay") {
  const runId = (state.staticRunId += 1);
  const normalizedTicker = ticker.toUpperCase().replace(/[^A-Z0-9.:-]/g, "").slice(0, 14);
  if (!normalizedTicker) {
    resetRoomForFailure("Showcase");
    renderFailure({ code: "invalid_ticker", message: "Enter a ticker before starting showcase." });
    return;
  }
  const random = mulberry32(hashString(`${normalizedTicker}:${question || "demo"}`));

  state.mode = "static";
  state.sessionId = `demo-${Date.now().toString(36)}`;
  state.complete = false;
  state.messageQueue = Promise.resolve();
  state.staticReplay = null;
  state.staticHistory = [];
  state.staticFollowUpCount = 0;
  state.researchStages = new Map();
  state.researchPacket = null;
  state.evidenceMap = new Map();
  state.activeRoomTab = "debate";
  state.lastError = null;
  state.conviction = {};
  state.convictionHistory = {};
  state.agents = fallbackAgents;
  renderAgents();

  elements.feed.innerHTML = "";
  elements.researchTimeline.innerHTML = "";
  elements.researchTimeline.hidden = true;
  elements.typing.hidden = true;
  elements.followupInput.disabled = true;
  elements.followupButton.disabled = true;
  elements.begin.disabled = true;
  elements.roomTitle.textContent = `${normalizedTicker} fetching showcase snapshot`;
  elements.sessionChip.textContent = state.sessionId.slice(0, 8);
  setStatus("Fetching market snapshot", true);
  renderDataPanel(null);
  setRoomTab("debate");

  let replay;
  let snapshot;
  try {
    [replay, snapshot] = await Promise.all([
      loadShowcaseReplay(normalizedTicker),
      loadShowcaseSnapshot(normalizedTicker)
    ]);
  } catch (error) {
    if (runId !== state.staticRunId) return;
    elements.researchTimeline.hidden = true;
    elements.begin.disabled = false;
    setStatus("Failed", false);
    renderFailure({
      code: error.code || "showcase_snapshot_failed",
      message: `${error.message} The app will not display stale saved prices.`
    });
    return;
  }

  if (runId !== state.staticRunId) return;

  state.staticReplay = replay;
  state.researchPacket = snapshot;
  state.evidenceMap = new Map((state.researchPacket.evidenceItems || []).map((item) => [item.evidenceId, item]));
  state.conviction = initialConvictionFromPacket(snapshot, replay?.initialConviction);
  state.convictionHistory = Object.fromEntries(
    Object.keys(state.conviction).map((agentId) => [agentId, [state.conviction[agentId]]])
  );
  elements.researchTimeline.hidden = true;
  elements.roomTitle.textContent = `${state.researchPacket.resolvedTicker} showcase snapshot`;
  setStatus(label, true);
  renderResearchSummary(state.researchPacket);
  renderMetrics(state.researchPacket);
  renderEvidence(state.researchPacket);
  renderDataPanel(state.researchPacket);
  renderConviction();

  const plan = buildAuditedShowcasePlan(normalizedTicker, question, state.researchPacket);

  for (const message of plan.turns) {
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
  const moderator = plan.moderator;
  showTyping(moderator);
  await delay(900);
  hideTyping();
  state.staticHistory.push(moderator);
  await queueMessage(moderator, true);

  if (runId !== state.staticRunId) return;
  const finalReview = plan.finalReview;
  showTyping(finalReview);
  await delay(900);
  hideTyping();
  state.staticHistory.push(finalReview);
  await queueMessage(finalReview, true);

  state.complete = true;
  setStatus("Follow-up open", false);
  elements.begin.disabled = false;
  elements.followupInput.disabled = false;
  elements.followupButton.disabled = false;
  elements.followupInput.focus();
}

function initialConvictionFromPacket(packet, overrides = {}) {
  const stats = packet?.keyStats || {};
  const growth = finiteNumber(stats.revenueGrowth);
  const margin = finiteNumber(stats.grossMargins);
  const beta = finiteNumber(stats.beta);
  const trailingPe = finiteNumber(stats.trailingPE);
  const periodReturn = finiteNumber(packet?.recentPriceContext?.periodReturnPct);
  const fcf = finiteNumber(stats.freeCashflow);
  const totalDebt = finiteNumber(stats.totalDebt);
  const baseline = {
    marcus: clampConviction(18 + (Number.isFinite(growth) ? growth * 40 : 0) + (Number.isFinite(margin) ? margin * 12 : 0)),
    yara: clampConviction(-18 - (Number.isFinite(trailingPe) && trailingPe > 60 ? 12 : 0)),
    kenji: clampConviction(Number.isFinite(beta) ? (beta > 1.6 ? -8 : 4) : 0),
    sofia: clampConviction(Number.isFinite(periodReturn) && periodReturn < -15 ? -8 : 3),
    priya: clampConviction((Number.isFinite(margin) && margin > 0.35 ? 5 : -2) + (Number.isFinite(fcf) && fcf > 0 ? 3 : -4)),
    lucas: packet?.filingOrDisclosureSummary?.available ? -2 : -7,
    mei: /technology|consumer|industrial/i.test(packet?.sector || "") ? 3 : 0,
    omar: clampConviction(
      Number.isFinite(totalDebt) && totalDebt > 0 && (!Number.isFinite(fcf) || fcf <= 0)
        ? -10
        : Number.isFinite(totalDebt) && totalDebt > 0
          ? -4
          : 4
    ),
    skeptic: 0
  };
  return Object.fromEntries(
    fallbackAgents.map((agent) => {
      const override = Number(overrides?.[agent.id]);
      return [agent.id, Number.isFinite(override) ? clampConviction(override) : baseline[agent.id] || 0];
    })
  );
}

function buildAuditedShowcasePlan(ticker, question, packet) {
  const ids = evidenceIds(packet);
  const stats = packet.keyStats || {};
  const context = question ? ` The user's frame is: "${question}".` : "";
  const captured = formatTimestamp(packet.dataTimestamp);
  const quoteLine = `${packet.resolvedTicker} snapshot at ${captured}: price ${formatCurrency(packet.latestPrice, packet.currency)}, change ${formatSigned(packet.priceChange)}, market cap ${formatMarketCap(packet.marketCap)}.`;
  const growthLine = metricSentence([
    ["revenue growth", formatPercent(stats.revenueGrowth)],
    ["gross margin", formatPercent(stats.grossMargins)],
    ["operating margin", formatPercent(stats.operatingMargins)]
  ]);
  const cashLine = metricSentence([
    ["free cash flow", formatMarketCap(stats.freeCashflow)],
    ["operating cash flow", formatMarketCap(stats.operatingCashflow)],
    ["total debt", formatMarketCap(stats.totalDebt)]
  ]);
  const valuationLine = metricSentence([
    ["trailing P/E", formatValue(stats.trailingPE, 1)],
    ["forward P/E", formatValue(stats.forwardPE, 1)],
    ["beta", formatValue(stats.beta, 2)]
  ]);
  const chart = packet.recentPriceContext || {};
  const chartLine = chart.periodReturnPct == null
    ? "The six-month chart did not return enough observations for a clean price-history read."
    : `Six-month context ${chart.rangeStart} to ${chart.rangeEnd}: return ${chart.periodReturnPct}%, range ${formatCurrency(chart.low, packet.currency)} to ${formatCurrency(chart.high, packet.currency)}.`;

  const turns = [
    auditedMessage(
      "marcus",
      `${quoteLine}${context} The constructive case has to start with current evidence, not old replay numbers. ${growthLine || "Growth and margin fields are unavailable in this snapshot, so I would keep the upside case conditional."}`,
      [ids.market, ids.fundamentals, ids.stats],
      { marcus: 4, sofia: 1 },
      "current snapshot anchored upside case"
    ),
    auditedMessage(
      "yara",
      `@Marcus current price is not evidence of durability. ${cashLine || "This snapshot does not provide enough cash-flow fields, which is itself a quality warning."} I need cash economics before I let narrative raise conviction.`,
      [ids.fundamentals, ids.disclosure],
      { yara: -5, marcus: -2 },
      "cash-flow quality challenged"
    ),
    auditedMessage(
      "kenji",
      `${chartLine} ${valuationLine || "Valuation and beta fields are incomplete."} The distribution should stay wide until the data narrows it.`,
      [ids.priceHistory, ids.stats, ids.market],
      { kenji: 3, marcus: -1 },
      "distribution widened"
    ),
    auditedMessage(
      "priya",
      `Accounting desk: ${cashLine || "cash-flow fields are incomplete in this snapshot."} I am not calling the books clean or dirty from summary data alone; I am setting the burden of proof around cash conversion and disclosure support.`,
      [ids.fundamentals, ids.disclosure],
      { priya: -2, yara: -1, marcus: -1 },
      "accounting quality burden added"
    ),
    auditedMessage(
      "sofia",
      `${packet.displayName} is classified as ${packet.sector || "sector unavailable"} / ${packet.industry || "industry unavailable"} in this snapshot. Macro framing should flow through that business mix, currency ${packet.currency || "n/a"}, and market state ${packet.marketState || "n/a"}.`,
      [ids.profile, ids.market],
      { sofia: 3 },
      "macro channel contextualized"
    ),
    auditedMessage(
      "mei",
      `Supply-chain desk: the packet gives profile and price context, but not supplier concentration, lead times, inventory turns, or unit availability. Any demand thesis should keep that missing operations evidence visible.`,
      [ids.profile, ids.priceHistory],
      { mei: 3, marcus: -1, skeptic: 1 },
      "supply-chain evidence gap named"
    ),
    auditedMessage(
      "lucas",
      `Regulatory desk: ${packet.filingOrDisclosureSummary?.available ? "disclosures are available in the packet, so policy risk should be tied to filed language." : "disclosure enrichment is unavailable here, so I will not pretend we read legal risk that was not fetched."} Generic regulation fear is not evidence.`,
      [ids.disclosure, ids.profile],
      { lucas: -1, sofia: 1 },
      "regulatory scope constrained"
    ),
    auditedMessage(
      "omar",
      `Credit desk: equity debate still has a funding channel. ${cashLine || "With incomplete cash-flow data, liquidity risk should stay open."} If leverage or refinancing pressure rises, the story gets less room for error.`,
      [ids.fundamentals, ids.stats, ids.market],
      { omar: -3, marcus: -1, yara: 1 },
      "liquidity risk added"
    ),
    auditedMessage(
      "skeptic",
      `Pause. More desks do not automatically mean more truth. The snapshot records quote, profile, stats, and disclosures, but it does not prove direct demand. I still want workload usage, retention, customer ROI, paid adoption, or unit economics before the room treats proxies as facts.`,
      [ids.market, ids.profile, ids.disclosure],
      { marcus: -4, yara: 1, priya: 1, mei: 1, skeptic: 2 },
      "missing direct evidence"
    ),
    auditedMessage(
      "marcus",
      `@The Skeptic fair. My bull case should update only if the next snapshots show the same direction in fundamentals and cash economics. Current evidence gives me a thesis, not permission to ignore falsifiers.`,
      [ids.fundamentals, ids.stats],
      { marcus: 2, kenji: 1 },
      "bull case made falsifiable"
    ),
    auditedMessage(
      "yara",
      `Then the scorecard is explicit: keep checking cash flow, margin shape, leverage, and disclosures against the captured snapshot. If those do not improve, the story should not get more credit just because the tape moved.`,
      [ids.fundamentals, ids.disclosure],
      { yara: -3 },
      "quality scorecard tightened"
    ),
    auditedMessage(
      "kenji",
      `I would mark this as an audited showcase run, not a recommendation. The scorecard is now wider: market, fundamentals, accounting quality, macro, regulatory scope, supply chain, and credit. Every displayed number ties back to a snapshot timestamp and source.`,
      [ids.market, ids.priceHistory],
      { kenji: 2, priya: 1, lucas: 1, mei: 1, omar: 1, skeptic: 1 },
      "source discipline improved"
    )
  ];
  const moderator = {
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
        `This showcase used a market data snapshot captured at ${captured}. The strongest bull point was evidence-based operating upside where fundamentals support it. The strongest bear point was cash-flow and direct-demand proof. Kenji kept the distribution wide. Priya added accounting-quality discipline, Mei named missing operations evidence, Lucas constrained regulatory claims to disclosures, Omar added funding risk, and Sofia put the company back into sector, currency, and market-state context. The Skeptic forced the room to separate sourced metrics from assumptions.`,
        "",
        "No recommendation. This is an educational showcase with a captured data snapshot, not financial advice."
      ].join("\n"),
      citedEvidenceIds: [ids.market, ids.fundamentals, ids.disclosure].filter(Boolean),
      citations: [],
      effects: {}
    };
  const projectedConviction = projectedShowcaseConviction(turns);
  const averageConviction =
    Object.values(projectedConviction).reduce((sum, value) => sum + Number(value || 0), 0) /
    Math.max(1, Object.values(projectedConviction).length);
  const finalReview = {
    id: crypto.randomUUID(),
    agentId: "reviewer",
    name: "Final Review Officer",
    title: "IC Chair",
    short: "IC",
    color: "#f2c94c",
    timestamp: timestamp(),
    body: [
      `Final Review Officer on ${ticker}:`,
      "",
      `Decision direction (non-advisory): ${showcaseDirectionLabel(averageConviction, packet.dataCoverageScore)}`,
      `Evidence grade: ${packet.dataCoverageScore >= 80 ? "strong" : packet.dataCoverageScore >= 60 ? "mixed" : "weak"}`,
      `Committee verdict: The room has a research direction, not a portfolio instruction. The constructive case needs the displayed fundamentals and cash economics to keep confirming the thesis; the risk case keeps priority if direct demand, disclosure, liquidity, or valuation evidence weakens.`,
      `Primary risk gate: ${packet.evidenceItems?.length ? "whether the next evidence packet confirms the current source-labeled snapshot." : "insufficient source evidence."}`,
      "",
      "What would change the direction:",
      "1. Direct demand evidence improves or deteriorates, not just proxy metrics.",
      "2. Cash conversion, margins, leverage, and disclosures move against the current scorecard.",
      "3. Macro, regulatory, supply-chain, or liquidity risks become more material in filings or market data.",
      "",
      "Next diligence steps:",
      "1. Open the Data tab and check every provider-labeled metric before trusting the debate.",
      "2. Compare this snapshot with the next filing or quarterly update.",
      "3. Ask the room which specific evidence item would force each desk to lower or raise conviction.",
      "",
      "This is a research direction for educational analysis, not financial advice or a buy/sell/hold recommendation."
    ].join("\n"),
    citedEvidenceIds: [ids.market, ids.fundamentals, ids.stats, ids.disclosure].filter(Boolean),
    citations: [],
    effects: {}
  };

  return { turns, moderator, finalReview };
}

function showcaseDirectionLabel(averageConviction, coverageScore) {
  if (coverageScore < 55) return "Insufficient evidence: do more diligence before forming a view";
  if (averageConviction > 12) return "Constructive, but conditional on evidence improving";
  if (averageConviction < -12) return "Cautious, risk-first: unresolved issues dominate";
  return "Balanced watchlist: evidence mixed, monitor the gates";
}

function projectedShowcaseConviction(turns) {
  const projected = { ...(state.conviction || {}) };
  for (const message of turns) {
    for (const [agentId, delta] of Object.entries(message.effects || {})) {
      if (!(agentId in projected)) continue;
      projected[agentId] = Math.max(-100, Math.min(100, projected[agentId] + delta));
    }
    if (message.agentId === "skeptic") {
      for (const agentId of ["marcus", "yara", "sofia", "priya", "lucas", "mei", "omar"]) {
        const current = projected[agentId] || 0;
        projected[agentId] = current > 0 ? Math.max(0, current - 2) : Math.min(0, current + 2);
      }
    }
  }
  return projected;
}

function auditedMessage(agentId, body, citedEvidenceIds, effects, rationaleTag) {
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
    citedEvidenceIds: [...new Set(citedEvidenceIds.filter(Boolean))],
    citations: [],
    bid: { score: 8.8, reason: "Audited showcase route selected this speaker from the current snapshot." },
    effects,
    rationaleTag
  };
}

function evidenceIds(packet) {
  const byType = new Map((packet.evidenceItems || []).map((item) => [item.sourceType, item.evidenceId]));
  return {
    market: byType.get("market_data") || packet.evidenceItems?.[0]?.evidenceId,
    profile: byType.get("company_profile") || packet.evidenceItems?.[1]?.evidenceId,
    fundamentals: byType.get("fundamentals") || packet.evidenceItems?.[2]?.evidenceId,
    stats: byType.get("key_statistics") || packet.evidenceItems?.[3]?.evidenceId,
    priceHistory: byType.get("price_history") || packet.evidenceItems?.[4]?.evidenceId,
    disclosure: byType.get("disclosure") || packet.evidenceItems?.at(-1)?.evidenceId
  };
}

function metricSentence(items) {
  const visible = items.filter(([, value]) => value && value !== "n/a");
  if (!visible.length) return "";
  return visible.map(([label, value]) => `${label} ${value}`).join("; ") + ".";
}

function clampConviction(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(-100, Math.min(100, Math.round(number)));
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

function staticMessage(agentId, body, citations, effects) {
  const agent = fallbackAgents.find((item) => item.id === agentId);
  const evidenceIds = (citations || []).filter((item) => state.evidenceMap.has(item));
  return {
    id: crypto.randomUUID(),
    agentId,
    name: agent.name,
    title: agent.title,
    short: agent.short,
    color: agent.color,
    timestamp: timestamp(),
    body,
    citedEvidenceIds: evidenceIds,
    citations: (citations || []).filter((item) => !state.evidenceMap.has(item)),
    bid: { score: 8.4, reason: "Follow-up router selected this speaker from the current snapshot." },
    effects
  };
}

function buildStaticFollowUpReplies(body) {
  const packet = state.researchPacket || {};
  const stats = packet.keyStats || {};
  const snapshot = formatTimestamp(packet.dataTimestamp);
  const selected = selectStaticFollowUpSpeakers(body);
  const repliesByAgent = {
    marcus: [
      `@You I'll jump in. Using the ${snapshot} snapshot, the bull case should be tested against revenue growth ${formatPercent(stats.revenueGrowth)} and gross margin ${formatPercent(stats.grossMargins)}.`,
      `@You fair. If this debate is going to earn attention, my claim has to be falsifiable: future snapshots need improving fundamentals, not just a higher tape.`,
      `@You different angle from Skeptic: optionality is not magic. It has to show up as operating leverage or cash economics in the sourced data.`
    ],
    yara: [
      `@You I agree the room should not loop. Current cash fields: free cash flow ${formatMarketCap(stats.freeCashflow)}, operating cash flow ${formatMarketCap(stats.operatingCashflow)}, debt ${formatMarketCap(stats.totalDebt)}.`,
      `@You if the answer feels generic, the fix is sharper failure modes. For ${packet.resolvedTicker}, I would ask what breaks first: demand, margins, cash flow, or disclosure quality.`,
      `@You my contribution is simple: narrative is cheap until cash proves it. If future snapshots show better cash conversion, my bear case should weaken.`
    ],
    kenji: [
      `@You yes, another voice should enter. My table starts with price ${formatCurrency(packet.latestPrice, packet.currency)}, beta ${formatValue(stats.beta, 2)}, and six-month return ${packet.recentPriceContext?.periodReturnPct ?? "n/a"}%.`,
      `@You the repeated answer is a routing problem. A better room needs one claim, one observable from the snapshot, and one conviction update from each analyst.`,
      `@You I do not want more words; I want better measurement. Ask each analyst what number in the Data tab would change their mind, then track whether they update.`
    ],
    sofia: [
      `@You I'll add the macro channel. The snapshot classifies ${packet.resolvedTicker} as ${packet.sector || "sector unavailable"} / ${packet.industry || "industry unavailable"}, so cycle risk should be framed through that business mix.`,
      `@You the debate should separate business execution from market regime. Currency ${packet.currency || "n/a"} and market state ${packet.marketState || "n/a"} are part of that frame.`,
      `@You more analysts should join only if they widen the frame. My question is whether the cycle hits demand, financing conditions, or just valuation.`
    ],
    priya: [
      `@You Priya here. I would audit cash conversion first: free cash flow ${formatMarketCap(stats.freeCashflow)}, operating cash flow ${formatMarketCap(stats.operatingCashflow)}, and margin quality ${formatPercent(stats.operatingMargins)}.`,
      `@You the accounting lane is not vibes. I want the Data tab to show whether margins, cash flow, and disclosures support the claim or merely decorate it.`,
      `@You if the debate feels thin, ask whether earnings quality changed. That forces the room away from pure narrative.`
    ],
    lucas: [
      `@You Lucas jumping in. Regulatory risk should be tied to disclosures when available; otherwise we should label it as an open risk, not pretend it was researched.`,
      `@You the legal frame is constraint, not drama. I care whether filed disclosures or sector policy actually change the room's assumptions.`,
      `@You if someone says antitrust, export controls, or litigation, they need to point to an evidence chip or call the gap out clearly.`
    ],
    mei: [
      `@You Mei here. Demand arguments need an operations check: capacity, supplier dependence, lead times, inventory, and unit availability. This snapshot does not magically prove those.`,
      `@You I can add a useful lane only if we keep supply-chain evidence separate from revenue or capex proxies.`,
      `@You if the Data tab lacks inventory or supplier evidence, that is not a failure of the UI; it is a research limitation the debate should preserve.`
    ],
    omar: [
      `@You Omar from credit. I am watching total debt ${formatMarketCap(stats.totalDebt)}, cash generation, beta ${formatValue(stats.beta, 2)}, and whether liquidity gives the equity story enough room for error.`,
      `@You funding risk matters because a good story can still get repriced when credit conditions tighten.`,
      `@You ask what happens if refinancing becomes harder or cash conversion disappoints. That is where equity optimism usually meets the balance sheet.`
    ],
    skeptic: [
      `@You agreed, repeating the proxy point is not enough. The next useful question is what single sourced datapoint would force each analyst to lower conviction.`,
      `@You more voices can still be fake depth if everyone uses the same missing evidence. I want adversarial updating anchored to the captured snapshot.`,
      `@You the room should ask: what would prove each desk wrong, and what would make Kenji's distribution narrower in the Data tab?`
    ]
  };

  return selected.map((bid, index) => {
    const pool = repliesByAgent[bid.agentId];
    const variant = hashString(`${body}:${bid.agentId}:${state.staticFollowUpCount}:${index}`) % pool.length;
    return staticMessage(
      bid.agentId,
      pool[variant],
      state.researchPacket?.evidenceItems?.slice(0, 2).map((item) => item.evidenceId) || ["shared transcript"],
      staticFollowUpEffects(bid.agentId)
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
    priya: { score: 3.5, reason: "Accounting desk can audit quality." },
    mei: { score: 3.3, reason: "Supply-chain desk can test operations." },
    sofia: { score: 3.3, reason: "Macro can add context." },
    lucas: { score: 3.2, reason: "Regulatory desk can constrain policy claims." },
    omar: { score: 3.3, reason: "Credit desk can test liquidity risk." },
    skeptic: { score: 3.1, reason: "Skeptic can audit assumptions." }
  };

  if (direct && bids[direct]) bids[direct].score += 6.2;
  if (asksForOthers) {
    for (const agentId of Object.keys(bids)) bids[agentId].score += 2.3;
    if (lastAgent) bids[lastAgent].score -= 4.4;
  }
  if (isMetaCritique) {
    bids.yara.score += 2.8;
    bids.kenji.score += 2.3;
    bids.marcus.score += 1.5;
    bids.priya.score += 2.1;
    bids.mei.score += 1.6;
    bids.skeptic.score -= 1.1;
  }
  if (/data|number|proof|evidence|specific|year|comp|vol|margin|table|數據|證據|哪一年|對標/i.test(body)) bids.kenji.score += 3.6;
  if (/cash|account|fraud|short|bear|quality|accrual|revenue recognition|現金流|會計|空頭|收入認列/i.test(body)) {
    bids.yara.score += 2.8;
    bids.priya.score += 3.8;
  }
  if (/rate|macro|policy|fx|currency|cycle|imf|政策|匯率|利率|總經/i.test(body)) bids.sofia.score += 3.4;
  if (/regulat|legal|lawsuit|antitrust|export|policy|法規|監管|訴訟|反壟斷|出口/i.test(body)) bids.lucas.score += 3.6;
  if (/supply|supplier|inventory|capacity|lead time|unit|供應鏈|庫存|產能|供應商/i.test(body)) bids.mei.score += 3.6;
  if (/credit|debt|liquidity|refinanc|balance sheet|spread|leverage|債務|流動性|槓桿|資產負債/i.test(body)) bids.omar.score += 3.6;
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

function staticFollowUpEffects(agentId) {
  const effects = {
    marcus: { marcus: 3 },
    yara: { yara: -3 },
    kenji: { kenji: 2 },
    sofia: { sofia: 2 },
    priya: { priya: -2, yara: -1 },
    lucas: { lucas: -2 },
    mei: { mei: 2, marcus: -1 },
    omar: { omar: -2, marcus: -1 },
    skeptic: { skeptic: 1, marcus: -1, yara: 1 }
  };
  return effects[agentId] || { [agentId]: 1 };
}

function applyStaticConviction(message) {
  for (const [agentId, delta] of Object.entries(message.effects || {})) {
    if (!(agentId in state.conviction)) continue;
    state.conviction[agentId] = Math.max(-100, Math.min(100, state.conviction[agentId] + delta));
  }

  if (message.agentId === "skeptic") {
    for (const agentId of ["marcus", "yara", "sofia", "priya", "lucas", "mei", "omar"]) {
      const current = state.conviction[agentId];
      state.conviction[agentId] = current > 0 ? Math.max(0, current - 2) : Math.min(0, current + 2);
    }
  }

  for (const agentId of Object.keys(state.convictionHistory)) {
    state.convictionHistory[agentId].push(state.conviction[agentId]);
  }
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
  if (/@priya|@acct|accounting|forensic/.test(lower)) return "priya";
  if (/@lucas|@reg|regulatory|legal/.test(lower)) return "lucas";
  if (/@mei|@chain|supply/.test(lower)) return "mei";
  if (/@omar|@crdt|credit/.test(lower)) return "omar";
  if (/@skeptic|the skeptic/.test(lower)) return "skeptic";
  return null;
}

async function renderMessage(message, animated) {
  const article = document.createElement("article");
  article.className = `message ${message.agentId || ""}`;
  article.style.setProperty("--agent-color", message.color || "#50e3a4");

  if (message.agentId === "moderator") article.classList.add("moderator");
  if (message.agentId === "reviewer") article.classList.add("reviewer");
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

function renderRoomNotice({ code, name, title, message }) {
  const article = document.createElement("article");
  article.className = "message moderator room-notice";

  const header = document.createElement("div");
  header.className = "message-header";
  const deskCode = document.createElement("span");
  deskCode.className = "message-code";
  deskCode.textContent = code || "ROOM";
  const deskName = document.createElement("span");
  deskName.className = "message-name";
  deskName.textContent = name || "Room ready";
  const deskTitle = document.createElement("span");
  deskTitle.className = "message-title";
  deskTitle.textContent = title ? `(${title})` : "";
  header.append(deskCode, deskName, deskTitle);

  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = message;

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
  span.textContent = [
    packet.exchange,
    packet.currency,
    packet.marketState,
    packet.dataTimestamp ? `captured ${formatTimestamp(packet.dataTimestamp)}` : null
  ].filter(Boolean).join(" · ");
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

  if (packet.snapshotPolicy) {
    const policy = document.createElement("p");
    policy.className = "research-warning";
    policy.textContent = packet.snapshotPolicy;
    elements.researchSummary.append(policy);
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
  meta.textContent = [
    packet.displayName,
    packet.exchange,
    packet.currency,
    `coverage ${packet.dataCoverageScore ?? 0}/100`,
    packet.dataTimestamp ? `captured ${formatTimestamp(packet.dataTimestamp)}` : null
  ]
    .filter(Boolean)
    .join(" · ");
  title.append(eyebrow, heading, meta);
  header.append(title, dataFreshnessBadge(packet));
  elements.dataPanel.append(header);
  elements.dataPanel.append(dataQualityStrip(packet));

  const quoteGrid = document.createElement("div");
  quoteGrid.className = "data-grid";
  for (const [label, value] of [
    ["Latest price", formatCurrency(packet.latestPrice, packet.currency)],
    ["Price change", formatSigned(packet.priceChange)],
    ["Market cap", formatMarketCap(packet.marketCap)],
    ["Market state", packet.marketState || "n/a"],
    ["Snapshot time", formatTimestamp(packet.dataTimestamp)],
    ["Quote source", packet.quoteSourceLabel || "n/a"],
    ["Sector", packet.sector || "n/a"],
    ["Industry", packet.industry || "n/a"],
    ["6mo return", packet.recentPriceContext?.periodReturnPct == null ? "n/a" : `${packet.recentPriceContext.periodReturnPct}%`]
  ]) {
    quoteGrid.append(dataMetric(label, value));
  }
  elements.dataPanel.append(sectionBlock("Market Snapshot", quoteGrid));

  const stats = packet.keyStats || {};
  const valuationRows = [
    ["Trailing P/E", "trailingPE", 1],
    ["Forward P/E", "forwardPE", 1],
    ["Beta", "beta", 2],
    ["EV/EBITDA", "enterpriseToEbitda", 1],
    ["Price/book", "priceToBook", 1],
    ["Price/sales", "priceToSales", 1],
    ["Forward P/S", "forwardPriceToSales", 1],
    ["EPS TTM", "epsTtm", 2],
    ["Forward EPS", "forwardEps", 2],
    ["Dividend yield", "dividendYield", 2],
    ["Dividend/share", "dividendPerShare", 2]
  ];
  elements.dataPanel.append(sectionBlock("Valuation & Market Ratios", dataTable(valuationRows, stats)));

  const operatingRows = [
    ["Revenue growth", "revenueGrowth", 1],
    ["Revenue TTM", "revenueTtm", 0],
    ["Forecast sales", "forecastSales", 0],
    ["EBITDA TTM", "ebitdaTtm", 0],
    ["Gross margin", "grossMargins", 1],
    ["Operating margin", "operatingMargins", 1],
    ["Profit margin", "profitMargin", 1],
    ["Return on equity", "returnOnEquity", 1],
    ["Debt/equity", "debtToEquity", 1],
    ["Current ratio", "currentRatio", 2],
    ["Quick ratio", "quickRatio", 2],
    ["Cash ratio", "cashRatio", 2],
    ["Nasdaq fiscal period end", "nasdaqPeriodEnd", 0]
  ];
  elements.dataPanel.append(sectionBlock("Profitability & Balance Sheet Quality", dataTable(operatingRows, stats)));

  const cashRows = [
    ["Free cash flow", "freeCashflow", 0],
    ["Operating cash flow", "operatingCashflow", 0],
    ["Capital expenditures", "capitalExpenditures", 0],
    ["Total debt", "totalDebt", 0],
    ["Cash & equivalents", "cashAndEquivalents", 0],
    ["Stockholders' equity", "stockholdersEquity", 0]
  ];
  elements.dataPanel.append(sectionBlock("Cash Flow & Leverage", dataTable(cashRows, stats)));

  const secRows = [
    ["SEC revenue", "secRevenue", 0],
    ["SEC net income", "secNetIncome", 0],
    ["SEC gross profit", "secGrossProfit", 0],
    ["SEC operating income", "secOperatingIncome", 0],
    ["SEC gross margin", "secGrossMargins", 1],
    ["SEC operating margin", "secOperatingMargins", 1],
    ["SEC assets", "secAssets", 0],
    ["SEC equity", "secStockholdersEquity", 0],
    ["SEC cash", "secCashAndEquivalents", 0],
    ["Shares outstanding", "sharesOutstanding", 0],
    ["SEC fiscal year", "secFiscalYear", 0],
    ["SEC fiscal period", "secFiscalPeriod", 0],
    ["SEC period end", "secPeriodEnd", 0],
    ["SEC form", "secForm", 0]
  ];
  elements.dataPanel.append(sectionBlock("SEC Statement Snapshot", dataTable(secRows, stats)));

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

function dataFreshnessBadge(packet) {
  const badge = document.createElement("div");
  badge.className = "data-freshness-badge";
  const label = document.createElement("span");
  label.textContent = packet.quoteSourceLabel ? "Source-Labeled Snapshot" : "Snapshot";
  const time = document.createElement("strong");
  time.textContent = formatTimestamp(packet.dataTimestamp);
  badge.append(label, time);
  return badge;
}

function dataQualityStrip(packet) {
  const stats = packet.keyStats || {};
  const strip = document.createElement("div");
  strip.className = "data-quality-strip";
  strip.append(
    sourcePill("Quote", packet.quoteSourceLabel || "n/a", packet.quoteSourceLabel ? "ok" : "warn"),
    sourcePill("Fundamentals", stats.fundamentalsSource || "n/a", stats.fundamentalsSource ? "ok" : "warn"),
    sourcePill(
      "Valuation",
      stats.valuationSource || "Provider unavailable",
      stats.valuationSource ? "ok" : "warn"
    ),
    sourcePill("Filings", packet.filingOrDisclosureSummary?.available ? "SEC EDGAR" : "Unavailable", packet.filingOrDisclosureSummary?.available ? "ok" : "warn")
  );
  if (stats.valuationUnavailableReason) {
    const note = document.createElement("p");
    note.className = "data-quality-note";
    note.textContent = stats.valuationUnavailableReason;
    strip.append(note);
  }
  return strip;
}

function sourcePill(label, value, tone = "ok") {
  const pill = document.createElement("div");
  pill.className = `data-source-pill ${tone}`;
  const span = document.createElement("span");
  span.textContent = label;
  const strong = document.createElement("strong");
  strong.textContent = value || "n/a";
  pill.append(span, strong);
  return pill;
}

function dataTable(rows, stats) {
  const table = document.createElement("div");
  table.className = "data-table";
  for (const [label, key, digits] of rows) {
    table.append(dataRow(label, formatStatValue(key, stats[key], digits)));
  }
  return table;
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
  if (right.textContent === "n/a") {
    row.classList.add("missing");
    right.title = "Provider did not return this metric in the current snapshot.";
  }
  row.append(left, right);
  return row;
}

function formatStatValue(key, value, digits = 1) {
  if (isMissingNumber(value)) return "n/a";
  if (
    key === "revenueGrowth" ||
    key === "grossMargins" ||
    key === "operatingMargins" ||
    key === "profitMargin" ||
    key === "returnOnEquity" ||
    key === "debtToEquity" ||
    key === "dividendYield" ||
    key === "secGrossMargins" ||
    key === "secOperatingMargins"
  ) {
    return formatPercent(value);
  }
  if (["secFiscalPeriod", "secPeriodEnd", "secForm", "nasdaqPeriodEnd"].includes(key)) {
    return value || "n/a";
  }
  if (["currentRatio", "quickRatio", "cashRatio"].includes(key)) {
    return formatRatio(value, digits);
  }
  if (key === "secFiscalYear") {
    return formatValue(value, 0);
  }
  if (key === "sharesOutstanding") {
    return formatMarketCap(value);
  }
  if (
    key.endsWith("flow") ||
    [
      "capitalExpenditures",
      "totalDebt",
      "cashAndEquivalents",
      "stockholdersEquity",
      "revenueTtm",
      "forecastSales",
      "ebitdaTtm"
    ].includes(key) ||
    key.startsWith("sec")
  ) {
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
  let currentCategory = "";
  for (const agent of state.agents) {
    if (agent.category && agent.category !== currentCategory) {
      currentCategory = agent.category;
      const category = document.createElement("div");
      category.className = "agent-category";
      category.textContent = currentCategory;
      elements.agentList.append(category);
    }

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

  const rows = [
    ["Price", formatCurrency(metrics.latestPrice, metrics.currency)],
    ["Change", formatSigned(metrics.priceChange)],
    ["Market cap", formatMarketCap(metrics.marketCap)],
    ["Captured", formatTimestamp(metrics.dataTimestamp)],
    ["Coverage", `${metrics.dataCoverageScore ?? 0}/100`],
    ["Sector", metrics.sector || "n/a"],
    ["Industry", metrics.industry || "n/a"],
    ["Forward P/E", formatValue(metrics.keyStats?.forwardPE, 1)],
    ["Beta", formatValue(metrics.keyStats?.beta, 2)],
    ["6mo return", metrics.recentPriceContext?.periodReturnPct == null ? "n/a" : `${metrics.recentPriceContext.periodReturnPct}%`]
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
  if (isMissingNumber(value)) return "n/a";
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return `${currency || ""} ${number.toLocaleString(undefined, { maximumFractionDigits: 2 })}`.trim();
}

function formatSigned(value) {
  if (isMissingNumber(value)) return "n/a";
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}`;
}

function formatMarketCap(value) {
  if (isMissingNumber(value)) return "n/a";
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  const abs = Math.abs(number);
  if (abs >= 1_000_000_000_000) return `${(number / 1_000_000_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  return number.toLocaleString();
}

function formatValue(value, digits = 1) {
  if (isMissingNumber(value)) return "n/a";
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return number.toFixed(digits);
}

function formatPercent(value) {
  if (isMissingNumber(value)) return "n/a";
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  const scaled = Math.abs(number) <= 2 ? number * 100 : number;
  return `${scaled.toFixed(1)}%`;
}

function formatRatio(value, digits = 2) {
  if (isMissingNumber(value)) return "n/a";
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return `${number.toFixed(digits)}x`;
}

function formatTimestamp(value) {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().replace(".000Z", "Z");
}

function isMissingNumber(value) {
  return value === null || value === undefined || value === "";
}

function finiteNumber(value) {
  if (isMissingNumber(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
