# Deployment

The Floor has two deploy paths.

## Instant Static Preview

The browser app automatically falls back to a static in-browser debate engine when it is opened from a static host such as GitHub Pages or RawGitHack.

Shareable preview:

```text
https://raw.githack.com/OAOWOuO/The-Floor/main/public/index.html
```

This version is useful for quick demos. It does not run the Node SSE server, but it preserves the full visual flow: debate stream, typing indicators, Moderator wrap, follow-up chat, and Conviction Tracker.

## GitHub Pages

If GitHub Pages is enabled from `main` / root, the root `index.html` redirects into the static app:

```text
https://oaowouo.github.io/The-Floor/
```

## Full Server Deployment

Use this when you want the real Node/SSE orchestrator online.

### Render

1. Open Render and create a new Blueprint or Web Service from `https://github.com/OAOWOuO/The-Floor`.
2. Render can read `render.yaml`.
3. Make sure these environment variables are set:

```text
HOST=0.0.0.0
FLOOR_DEBATE_MS=90000
```

### Railway

1. Create a new Railway project from the GitHub repo.
2. Railway can read `railway.json`.
3. Set:

```text
HOST=0.0.0.0
FLOOR_DEBATE_MS=90000
```

The start command is `npm start`.
