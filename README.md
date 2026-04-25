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

Static demo preview:

```text
https://raw.githack.com/OAOWOuO/The-Floor/main/public/index.html
```

For a full Node/SSE deployment, use Render or Railway with the included `render.yaml`, `railway.json`, and `Procfile`.

## What is implemented

- Full-screen trading-room chat UI.
- Shared group chat, not separate panes.
- Five analyst personas: Marcus, Yara, Kenji, Sofia, and The Skeptic.
- Moderator wrap-up after the debate.
- Server-Sent Events stream for live messages.
- Typing indicators and typewriter message reveal.
- Bid-based turn selection scaffold.
- Conviction Tracker showing how analyst stances move.
- User follow-up chat after the debate ends.

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
