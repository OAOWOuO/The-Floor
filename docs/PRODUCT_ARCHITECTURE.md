# THE FLOOR - Product Architecture

This document is the working architecture for the rebuilt version of The Floor.

## Product Identity

Name: The Floor

Tagline: Five analysts. One stock. No mercy.

One-line definition: The Floor is a live AI trading floor where five specialist analyst-agents debate any global stock in real time, and the user watches the argument happen.

## Core Experience

The app opens directly into a full-screen immersive chat room. The user enters a ticker and optional context question, then starts a debate. A shared chat room begins streaming messages from five analyst personas:

- Marcus, The Bull: ex-growth fund PM; power-law thinker; confident, narrative-aware, but grounded in operating leverage and estimate revisions.
- Yara, The Bear: ex-short seller; cold, cash-flow-driven, allergic to narrative; looks for accounting quality and incentive problems.
- Kenji, The Quant: ex-Two Sigma engineer; data-first; cares about realized volatility, factor exposure, dispersion, and base rates.
- Sofia, The Macro: ex-IMF economist; frames the company inside rates, policy, FX, liquidity, and cycle risk.
- The Skeptic: nameless, backstory-free, and central to the product; identifies unstated assumptions, circular reasoning, survivor bias, and over-clean consensus.

After the analyst debate, a Moderator summarizes the real disagreements and surfaces the remaining questions. The user can then enter the room and ask follow-up questions, including direct mentions such as `@Yara`.

## Debate Orchestration

The orchestrator owns:

- Shared chat history.
- Agent definitions and system behavior.
- Debate runtime.
- Turn queue.
- Bid evaluation.
- Conviction state.
- SSE streaming to the browser.

Turn selection is intentionally not round-robin. Each candidate agent scores its urge to respond from 0 to 10 based on the last message, current consensus, underrepresented viewpoints, and persona-specific triggers. The orchestrator chooses the highest bid, appends the generated message to shared history, updates conviction, and streams the result.

The Skeptic has a special bidding rule: intervene when two agents agree too easily, when a bullish or bearish thesis relies on an unstated assumption, or when the debate starts using a proxy as if it were direct evidence.

## Current Implementation

The current local version is designed to run without external dependencies or API keys. It simulates analyst output using deterministic ticker-specific metrics and a real bid-based orchestrator. This makes the demo runnable immediately while preserving the shape of the future multi-agent system.

Follow-up chat also uses bidding. Direct mentions get priority, broad prompts such as "anyone else?" invite multiple analysts, and recent speakers are penalized so the room does not collapse into the same respondent every time. When `OPENAI_API_KEY` is set, selected follow-up agents use the OpenAI Responses API to generate fresh in-character replies; when the API is unavailable, the local orchestrator still produces varied fallback responses.

Files:

- `server.mjs`: local HTTP server, SSE endpoint, debate orchestrator, follow-up endpoint.
- `public/index.html`: app shell.
- `public/styles.css`: full-screen trading-room UI.
- `public/app.js`: browser state, EventSource stream, typewriter rendering, conviction tracker.
- `scripts/smoke.mjs`: lightweight local smoke test.

## Future Live-Agent Architecture

The local deterministic agent generator should be replaced by an agent adapter with this interface:

```text
agent.generate({
  persona,
  ticker,
  question,
  marketSnapshot,
  filings,
  news,
  chatHistory,
  availableTools
}) -> message
```

The bid step can also be model-backed:

```text
agent.bid({
  persona,
  ticker,
  question,
  lastMessages,
  currentConviction
}) -> { score: 0..10, reason: string }
```

This lets the product preserve emergent debate while making each agent genuinely responsive to the shared room.

## Data Boundaries

The product must avoid:

- Buy or sell recommendations.
- Target prices.
- Fair value claims.
- Personalized financial advice.
- Unsupported factual claims about live data.

All live-market integrations should be shown as evidence inside the debate, not as final recommendations.

## Visual System

The Floor should feel like Discord crossed with a Bloomberg terminal and an institutional investment committee. It should be dark, dense, fast, and readable.

Principles:

- One shared chat room is the product.
- The UI must make the debate feel live.
- The Conviction Tracker should show opinion updating, not prediction.
- The right rail should support the chat, not dominate it.
- Disclaimers should be visible but quiet.
