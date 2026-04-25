# Deployment

The Floor has two deploy paths.

## Explicit Static Preview

Static mode is now explicit. It does not fetch market data and should not be presented as researched analysis.

Shareable preview:

```text
https://raw.githack.com/OAOWOuO/The-Floor/main/public/index.html?static=1
```

This version is useful for quick UI demos only. Real research mode requires the Node/SSE server and `OPENAI_API_KEY`.

## GitHub Pages

The repo includes a GitHub Actions workflow that deploys `public/` as a static demo whenever `main` is pushed:

```text
https://oaowouo.github.io/The-Floor/
```

This is a static host. Add `?static=1` if you intentionally want the in-browser demo.

If the first workflow run fails with `Resource not accessible by integration`, GitHub blocked the workflow from enabling Pages for the first time. Enable it once as the repo owner:

```text
Settings -> Pages -> Build and deployment -> Source: GitHub Actions
```

Then re-run the workflow or push another commit.

## Full Server Deployment

Use this when you want the real Node/SSE orchestrator online.

### Render

1. Open Render and create a new Blueprint or Web Service from `https://github.com/OAOWOuO/The-Floor`.
2. Render can read `render.yaml`.
3. Make sure these environment variables are set:

```text
HOST=0.0.0.0
FLOOR_DEBATE_MS=90000
OPENAI_MODEL=gpt-5.4-mini
OPENAI_API_KEY=<your OpenAI key>
SEC_USER_AGENT="The Floor contact@example.com"
```

### Railway

1. Create a new Railway project from the GitHub repo.
2. Railway can read `railway.json`.
3. Set:

```text
HOST=0.0.0.0
FLOOR_DEBATE_MS=90000
OPENAI_MODEL=gpt-5.4-mini
OPENAI_API_KEY=<your OpenAI key>
```

The start command is `npm start`.
