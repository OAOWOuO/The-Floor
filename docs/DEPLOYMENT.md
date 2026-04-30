# Deployment

The Floor is designed to be safe as a public showcase and useful as a self-hosted live research app.

## Modes

### Hosted Showcase

The public site can run without secrets:

```text
https://the-floor.onrender.com/
```

Showcase mode loads ticker metadata from:

```text
public/showcases/replays.json
```

It does not spend OpenAI tokens and does not collect visitor API keys. It does fetch a server-side market/disclosure snapshot when playback starts so the Data tab does not show stale saved prices.

### Self-Hosted Live

Live mode is for your own deployment. Your OpenAI API key belongs only in server-side environment variables.

## Deploy To Render

Fast path:

```text
https://render.com/deploy?repo=https://github.com/OAOWOuO/The-Floor
```

Manual path:

1. Fork `https://github.com/OAOWOuO/The-Floor`.
2. In Render, create a Blueprint or Web Service from your fork.
3. Render can read `render.yaml`.
4. Add the required environment variables.
5. Deploy.
6. Visit `/api/health` and confirm `capabilities.liveResearch` is `true`.

Required live env:

```text
HOST=0.0.0.0
OPENAI_API_KEY=<your OpenAI key>
OPENAI_MODEL=gpt-5.4-mini
```

Recommended env:

```text
FLOOR_DEBATE_MS=90000
OPENAI_RESEARCH_MODEL=gpt-5.4-mini
OPENAI_RESEARCH_REASONING=medium
OPENAI_DEBATE_REASONING=low
SEC_USER_AGENT="The Floor contact@example.com"
MAX_FOLLOWUPS_PER_SESSION=8
MAX_FOLLOWUP_BODY_BYTES=8192
MAX_JSON_BODY_BYTES=16384
RATE_LIMIT_DEBATE_WINDOW_MS=600000
RATE_LIMIT_DEBATE_MAX=20
RATE_LIMIT_FOLLOWUP_WINDOW_MS=600000
RATE_LIMIT_FOLLOWUP_MAX=60
```

## Verify Deployment

Health:

```bash
curl -L https://your-service.onrender.com/api/health
```

Expected live response includes:

```json
{
  "ok": true,
  "capabilities": {
    "showcaseReplay": true,
    "liveResearch": true,
    "acceptsBrowserApiKeys": false
  }
}
```

If `liveResearch` is `false`, the server does not have `OPENAI_API_KEY` configured.

## Railway

1. Create a Railway project from your fork.
2. Railway can read `railway.json`.
3. Set the same environment variables as Render.
4. Start command is `npm start`.

## Cost And Key Safety

- Do not commit API keys.
- Do not paste API keys into the hosted public demo.
- Use an OpenAI project key dedicated to this app.
- Set a monthly budget limit in the OpenAI dashboard.
- Rotate the key after public demos or judging sessions.
- Keep hosted public demo in Showcase mode unless you add authentication, persistent rate limits, and billing.
- Built-in rate limits are in-memory and useful for demos, but they reset on process restart. Use a persistent limiter before running a high-traffic public live service.

## CI

The repo includes `.github/workflows/ci.yml`.

It runs:

```bash
npm ci
npm run check
npm run test
npm run smoke
```

The smoke test uses fixture market data and OpenAI mock mode, so CI does not spend tokens.
