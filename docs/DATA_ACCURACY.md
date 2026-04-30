# Data Accuracy Policy

The Floor must not present stale or fabricated financial data as current market research.

## Showcase Mode

Showcase mode is no longer allowed to store stock prices, market caps, valuation multiples, margins, cash-flow figures, or financial statements in `public/showcases/replays.json`.

When a user presses `Play showcase`, the browser calls:

```text
GET /api/showcase-snapshot?ticker=TSLA
```

The server then:

1. Resolves the ticker through `yahoo-finance2`.
2. Fetches quote, profile, key statistics, financial data, six-month chart context, and disclosures where available.
3. Attempts SEC EDGAR enrichment for US-listed companies.
4. Builds a normalized research packet.
5. Adds `dataTimestamp`, `quoteSourceLabel`, `quoteSourceUrl`, and `snapshotPolicy`.
6. Refuses to start the showcase if the snapshot does not meet the minimum evidence threshold.

Every price shown in Showcase should be read as:

```text
price captured at dataTimestamp from quoteSourceLabel
```

Quotes may be delayed by the upstream provider. If the provider cannot return a usable quote, the UI must show a failure state instead of falling back to an old saved value.

Provider behavior must be explicit:

- Yahoo Finance quote and quoteSummary are preferred when available.
- If Yahoo quote is unavailable or rate-limited, Nasdaq quote/profile data is the first fallback for common US equities and must be labeled as such.
- If Nasdaq is unavailable, Stooq delayed quote may be used and must be labeled as such.
- SEC companyfacts can enrich annual financial statement values and shares outstanding, but the UI must distinguish SEC fields from Yahoo fields.
- `null`, `undefined`, and empty provider fields must render as `n/a`, never as `0`.
- Market cap may be derived only when a current quote and SEC shares outstanding are both available; the warning list must say it was derived.
- JSON research endpoints must send `Cache-Control: no-store`, and the showcase client must request a new snapshot on every Play action.

## Live Mode

Live mode uses the same research packet construction, then adds OpenAI synthesis and debate generation. It requires `OPENAI_API_KEY` on the server.

## Static API Mode

The explicit static API mode is for SSE mechanics only. Its packet contains no price, market cap, valuation, margin, or cash-flow values.

## Audit Checklist

- No saved financial values in `public/showcases/replays.json`.
- No client-side fallback to `NVDA` when a user enters a different ticker.
- No showcase debate starts unless `/api/showcase-snapshot` returns a ready packet.
- Data tab shows snapshot timestamp and quote source.
- Source chips cite evidence IDs from the current packet.
- Missing data is shown as missing, not patched over with demo numbers.
- Missing numeric fields do not render as zero.
