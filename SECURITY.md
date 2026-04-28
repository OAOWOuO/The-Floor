# Security

The Floor is designed so the public hosted showcase can be shared without exposing an OpenAI API key or spending tokens on visitor traffic.

## API Keys

- Do not commit `OPENAI_API_KEY` to the repository.
- Do not paste production keys into the public hosted demo.
- The hosted showcase does not accept browser-submitted API keys.
- Live research mode reads `OPENAI_API_KEY` only from server-side environment variables.
- For demos, use a separate capped project key whenever your provider supports budgets or usage limits.

## Deployment Modes

### Hosted Showcase

The public Render deployment is intended to run saved showcase replays only. It demonstrates the room, Data tab, source chips, and conviction tracker without live OpenAI calls.

### Self-Hosted Live Research

Fork the repo or deploy your own Render service, then configure `OPENAI_API_KEY` in the service environment. Keep the service private or protected if you do not want other users spending your quota.

## Abuse Controls

The app includes lightweight in-memory limits:

- `RATE_LIMIT_DEBATE_MAX` debate streams per `RATE_LIMIT_DEBATE_WINDOW_MS`
- `RATE_LIMIT_FOLLOWUP_MAX` follow-up calls per `RATE_LIMIT_FOLLOWUP_WINDOW_MS`
- `MAX_FOLLOWUPS_PER_SESSION`
- `MAX_FOLLOWUP_BODY_BYTES`
- `MAX_JSON_BODY_BYTES`

These limits are appropriate for a demo or small self-hosted deployment. For a public live product, add authentication, persistent rate limits, request logging, and billing controls before exposing server-funded live research.

## Reporting

If you find a security issue, open a private report through GitHub Security Advisories if available on your fork, or contact the repository owner directly. Do not post secrets or exploit details in a public issue.
