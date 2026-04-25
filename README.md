# The Floor

Five analysts. One stock. No mercy.

The Floor is a live AI trading-floor prototype: enter a ticker, start a debate, and watch five analyst personas argue in one shared chat room. The current first commit is a zero-dependency local demo with a real SSE stream, an orchestrator, bid-based turn selection, typing indicators, follow-up chat, and a conviction tracker.

## Run locally

```bash
npm run dev
```

Then open:

```text
http://localhost:3000
```

For hosted deployment, set `HOST=0.0.0.0`.

## Online preview

GitHub Pages static demo:

```text
https://oaowouo.github.io/The-Floor/
```

Raw static preview:

```text
https://raw.githack.com/OAOWOuO/The-Floor/main/public/index.html
```

For a full Node/SSE deployment, use Render or Railway with the included `render.yaml`, `railway.json`, and `Procfile`.

If the GitHub Pages workflow fails on the first run, open GitHub repo settings and enable Pages once:

```text
Settings -> Pages -> Build and deployment -> Source: GitHub Actions
```

After that, pushes to `main` deploy automatically.

## What is implemented

- Full-screen trading-room chat UI.
- Shared group chat, not separate panes.
- Five analyst personas: Marcus, Yara, Kenji, Sofia, and The Skeptic.
- Moderator wrap-up after the debate.
- Server-Sent Events stream for live messages.
- Typing indicators and typewriter message reveal.
- Bid-based turn selection scaffold.
- Bid-based follow-up selection, so multiple analysts can join user questions.
- Optional OpenAI-powered follow-up replies when `OPENAI_API_KEY` is set.
- Conviction Tracker showing how analyst stances move.
- User follow-up chat after the debate ends.

## Optional LLM mode

The local demo works without API keys. To make follow-up chat genuinely generative, set:

```bash
export OPENAI_API_KEY="your_key"
export OPENAI_MODEL="gpt-5-mini"
npm run dev
```

The server uses the OpenAI Responses API for selected follow-up agents, then falls back to the local orchestrator if the API is unavailable.

## What comes next

- Replace deterministic local agent text with OpenAI-backed agent calls.
- Add real market data and filings tools.
- Persist sessions and replay debate transcripts.
- Add source cards for citations and downloaded peer tables.
- Add auth/rate limits before public deployment.

## Scripts

```bash
npm run check
npm run smoke
```

This product is an educational debate simulation. It is not financial advice, a stock recommendation system, or a price prediction tool.
