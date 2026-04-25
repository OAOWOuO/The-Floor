const state = {
  eventSource: null,
  sessionId: null,
  agents: [],
  conviction: {},
  convictionHistory: {},
  messageQueue: Promise.resolve(),
  complete: false,
  canvasStarted: false
};

const elements = {
  form: document.querySelector("#debate-form"),
  ticker: document.querySelector("#ticker-input"),
  question: document.querySelector("#question-input"),
  begin: document.querySelector("#begin-button"),
  roomTitle: document.querySelector("#room-title"),
  roomStatus: document.querySelector("#room-status"),
  feed: document.querySelector("#message-feed"),
  typing: document.querySelector("#typing-line"),
  followupForm: document.querySelector("#followup-form"),
  followupInput: document.querySelector("#followup-input"),
  followupButton: document.querySelector("#followup-button"),
  agentList: document.querySelector("#agent-list"),
  metricsGrid: document.querySelector("#metrics-grid"),
  convictionList: document.querySelector("#conviction-list"),
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

state.agents = fallbackAgents;
renderAgents();
startMarketCanvas();

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  beginDebate();
});

elements.followupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await sendFollowUp();
});

function beginDebate() {
  const ticker = elements.ticker.value.trim() || "NVDA";
  const question = elements.question.value.trim();

  if (state.eventSource) state.eventSource.close();

  state.sessionId = null;
  state.complete = false;
  state.messageQueue = Promise.resolve();
  elements.feed.innerHTML = "";
  elements.typing.hidden = true;
  elements.followupInput.disabled = true;
  elements.followupButton.disabled = true;
  elements.begin.disabled = true;
  setStatus("Connecting", true);
  elements.roomTitle.textContent = `${ticker.toUpperCase()} debate warming up`;
  elements.sessionChip.textContent = "Opening floor";

  const params = new URLSearchParams({ ticker, question });
  const source = new EventSource(`/api/debate?${params.toString()}`);
  state.eventSource = source;

  source.addEventListener("session", (event) => {
    const payload = JSON.parse(event.data);
    state.sessionId = payload.sessionId;
    state.agents = payload.agents;
    state.conviction = payload.conviction;
    state.convictionHistory = payload.convictionHistory;
    renderAgents();
    renderMetrics(payload.metrics);
    renderConviction();
    elements.roomTitle.textContent = `${payload.ticker} live debate`;
    elements.sessionChip.textContent = payload.sessionId.slice(0, 8);
    setStatus("Live", true);
  });

  source.addEventListener("typing", (event) => {
    const payload = JSON.parse(event.data);
    showTyping(payload);
  });

  source.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    hideTyping();
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

  source.onerror = () => {
    if (!state.complete) {
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

  try {
    const response = await fetch("/api/followup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: state.sessionId, message })
    });

    if (!response.ok) throw new Error("Follow-up failed");

    const payload = await response.json();
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
  } catch {
    setStatus("Could not send", false);
  } finally {
    elements.followupInput.disabled = false;
    elements.followupButton.disabled = false;
    elements.followupInput.focus();
  }
}

function queueMessage(message, animated) {
  state.messageQueue = state.messageQueue.then(() => renderMessage(message, animated));
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

  if (message.citations?.length) {
    const citations = document.createElement("div");
    citations.className = "citation-list";
    for (const item of message.citations) {
      const chip = document.createElement("span");
      chip.textContent = item;
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
  if (!metrics) return;

  const rows = [
    ["P/E", metrics.pe],
    ["Rev growth", `${metrics.revenueGrowthPct}%`],
    ["Gross margin", `${metrics.grossMarginPct}%`],
    ["FCF yield", `${metrics.fcfYieldPct}%`],
    ["Realized vol", `${metrics.realizedVolPct}%`],
    ["Implied vol", `${metrics.impliedVolPct}%`],
    ["Beta", metrics.beta],
    ["Rate sens.", `${metrics.rateSensitivity}/100`]
  ];

  elements.metricsGrid.innerHTML = "";
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

function scrollFeed() {
  elements.feed.scrollTop = elements.feed.scrollHeight;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
