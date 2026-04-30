import { AppError } from "../utils/errors.mjs";
import { sanitizeTicker } from "../utils/sanitize.mjs";

const equityTypes = new Set(["EQUITY", "ETF", "MUTUALFUND"]);
let yahooFinance;
const resolverTimeoutMs = Number(process.env.MARKET_DATA_TIMEOUT_MS || 7000);

export async function resolveTicker(input) {
  const query = sanitizeTicker(input);
  if (!query) {
    throw new AppError("invalid_ticker", "Enter a public-market ticker symbol.", 400);
  }

  if (process.env.THE_FLOOR_FIXTURE_MODE === "1") {
    return fixtureResolution(query);
  }

  let result;
  try {
    const yahoo = await getYahooFinance();
    result = await withTimeout(
      yahoo.search(query, {
        quotesCount: 8,
        newsCount: 0,
        enableFuzzyQuery: true
      }),
      resolverTimeoutMs,
      `Ticker resolution timed out for ${query}.`
    );
  } catch (error) {
    return providerFallbackResolution(query, error.message);
  }

  const likelyMatches = normalizeMatches(result?.quotes || []);
  const exact = likelyMatches.find((item) => item.symbol.toUpperCase() === query.toUpperCase());
  const selected =
    exact ||
    likelyMatches.find((item) => equityTypes.has(String(item.quoteType || "").toUpperCase())) ||
    likelyMatches[0];

  if (!selected) {
    throw new AppError("ticker_not_found", `Could not resolve "${query}" to a listed security.`, 404, {
      likelyMatches
    });
  }

  return {
    inputTicker: query,
    resolvedTicker: selected.symbol,
    displayName: selected.name || selected.symbol,
    exchange: selected.exchange || selected.exchangeDisp || null,
    quoteType: selected.quoteType || null,
    currency: selected.currency || null,
    likelyMatches
  };
}

function providerFallbackResolution(query, warning) {
  return {
    inputTicker: query,
    resolvedTicker: query,
    displayName: query,
    exchange: null,
    quoteType: "EQUITY",
    currency: null,
    likelyMatches: [{ symbol: query, name: query, exchange: null, quoteType: "EQUITY" }],
    researchWarnings: [`Ticker search provider unavailable: ${warning}`]
  };
}

async function getYahooFinance() {
  if (!yahooFinance) {
    const { default: YahooFinance } = await import("yahoo-finance2");
    yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  }
  return yahooFinance;
}

function normalizeMatches(quotes) {
  return quotes
    .filter((quote) => quote?.symbol)
    .map((quote) => ({
      symbol: String(quote.symbol).toUpperCase(),
      name: quote.longname || quote.shortname || quote.name || null,
      exchange: quote.exchange || quote.exchDisp || quote.exchangeDisp || null,
      quoteType: quote.quoteType || quote.typeDisp || null,
      currency: quote.currency || null
    }))
    .slice(0, 6);
}

function fixtureResolution(query) {
  const upper = query.toUpperCase();
  const fixtures = {
    MSFT: {
      inputTicker: upper,
      resolvedTicker: "MSFT",
      displayName: "Microsoft Corporation",
      exchange: "NMS",
      quoteType: "EQUITY",
      currency: "USD",
      likelyMatches: [
        { symbol: "MSFT", name: "Microsoft Corporation", exchange: "NMS", quoteType: "EQUITY" }
      ]
    },
    NVDA: {
      inputTicker: upper,
      resolvedTicker: "NVDA",
      displayName: "NVIDIA Corporation",
      exchange: "NMS",
      quoteType: "EQUITY",
      currency: "USD",
      likelyMatches: [
        { symbol: "NVDA", name: "NVIDIA Corporation", exchange: "NMS", quoteType: "EQUITY" }
      ]
    }
  };

  return (
    fixtures[upper] || {
      inputTicker: upper,
      resolvedTicker: upper,
      displayName: `${upper} Fixture Corp.`,
      exchange: "NMS",
      quoteType: "EQUITY",
      currency: "USD",
      likelyMatches: [{ symbol: upper, name: `${upper} Fixture Corp.`, exchange: "NMS", quoteType: "EQUITY" }]
    }
  );
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new AppError("provider_timeout", message, 504)), ms);
    })
  ]);
}
