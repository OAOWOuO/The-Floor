# THE FLOOR - Product Architecture

The Floor is a research-first live AI trading-floor debate room. The product is not a recommendation engine. It resolves a public-market ticker, gathers a real evidence packet, and only then opens a multi-agent debate.

## Core Experience

The user enters a ticker and optional context question. The center room first shows research stages:

1. Resolving ticker
2. Fetching market data
3. Fetching company profile and key statistics
4. Fetching filings / recent disclosures
5. Reading and extracting evidence
6. Assigning analyst priors
7. Starting debate

Only after those stages complete does the shared chat room stream analyst messages. The public Showcase tab skips the live research timeline, fetches an audited market snapshot, and runs a no-token showcase room. Static API demo mode exists only behind `?static=1`.

## Agents

- Marcus, The Bull: upside, operating leverage, revision momentum.
- Yara, The Bear: cash flow, quality, incentives, downside asymmetry.
- Kenji, The Quant: distribution, volatility, base rates, measurement.
- Priya, Forensic Accounting: accruals, cash conversion, accounting quality, disclosure support.
- Mei, Supply Chain: capacity, inventory, lead times, supplier dependencies.
- Sofia, The Macro: rates, liquidity, FX, cycle transmission.
- Lucas, Regulatory Counsel: antitrust, export controls, litigation, policy constraints.
- Omar, Credit Desk: liquidity, leverage, refinancing, balance-sheet risk.
- The Skeptic: assumption hunting, invalid analogy detection, missing-evidence critique.
- Moderator: synthesizes disagreement, never recommends.

## Data Pipeline

Server-side data comes from `yahoo-finance2`:

- ticker search / symbol resolution
- quote
- six-month chart
- profile / summary profile
- financial data
- default key statistics
- summary detail
- earnings
- Yahoo `secFilings` when available

For US-style tickers, SEC EDGAR enrichment is attempted when Yahoo filings are unavailable. SEC data is best effort and not a hard requirement for non-US symbols.

The normalized research packet includes quote fields, profile fields, key statistics, recent price context, disclosure summary, evidence items, warnings, coverage score, and `readyForDebate`.

Minimum debate threshold:

- resolved ticker
- current quote data
- company profile or fundamentals/key statistics

If coverage is too weak, the system emits an insufficient-data error and does not start a fake debate.

## Generation Pipeline

The system uses a two-step OpenAI flow:

1. Research synthesis: converts the evidence packet into analyst priors, thesis constraints, open questions, initial conviction, and evidence mapping.
2. Debate generation: creates 10-14 structured turns from the synthesis and evidence packet.

The OpenAI Responses API is called with structured JSON output helpers and Zod validation. If `OPENAI_API_KEY` is missing in real mode, the app fails clearly. It does not fall back to canned debate.

## SSE Contract

`GET /api/debate` streams:

- `session`
- `research_stage`
- `research_packet_summary`
- `typing`
- `message`
- `conviction`
- `complete`
- `error`

No `message` event is emitted before research is ready.

## Conviction

Conviction ranges from -100 to +100. Initial scores come from research synthesis and differ by analyst. Every debate turn includes `convictionDeltaByAgent`; the server applies deltas, clamps values, appends history, and streams an updated `conviction` event.

## Follow-Up

Follow-up opens after the Moderator wrap. The follow-up route reuses:

- session transcript
- research packet
- research synthesis
- analyst priors
- evidence items

Selection logic respects @mentions, evidence/data questions, macro questions, meta criticism, and broad invitations such as "anyone else?".

## Boundaries

The product must not output:

- buy/sell/hold recommendations
- target prices
- fair value claims
- personalized financial advice
- fabricated evidence, filings, metrics, or sources
