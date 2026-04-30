import { AppError } from "../utils/errors.mjs";

let yahooFinance;
const marketDataTimeoutMs = Number(process.env.MARKET_DATA_TIMEOUT_MS || 7000);

const summaryModules = [
  "price",
  "assetProfile",
  "summaryProfile",
  "financialData",
  "defaultKeyStatistics",
  "summaryDetail",
  "earnings",
  "secFilings"
];

export async function fetchMarketData(resolution) {
  if (process.env.THE_FLOOR_FIXTURE_MODE === "1") {
    return fixtureMarketData(resolution);
  }

  const symbol = resolution.resolvedTicker;
  const warnings = [];
  const [quoteResult, summary, chart, nasdaqFallback, stooqFallback] = await Promise.all([
    fetchQuote(symbol),
    fetchQuoteSummary(symbol),
    fetchChart(symbol),
    fetchNasdaqQuote(symbol),
    fetchStooqQuote(symbol)
  ]);
  const fallbackQuote = nasdaqFallback.quote || stooqFallback.quote;
  const fallbackProfile = nasdaqFallback.profile || null;

  if (quoteResult.warning) warnings.push(quoteResult.warning);
  if (!quoteResult.quote && nasdaqFallback.warning) warnings.push(nasdaqFallback.warning);
  if (!quoteResult.quote && !nasdaqFallback.quote && stooqFallback.warning) warnings.push(stooqFallback.warning);
  if (!Object.keys(summary || {}).length) {
    warnings.push("Yahoo Finance quoteSummary unavailable; Yahoo valuation statistics may be incomplete.");
  }

  if (!hasUsableQuote(quoteResult.quote, summary, chart, fallbackQuote)) {
    throw new AppError("market_data_provider_failed", `Could not fetch current quote for ${symbol}.`, 502, {
      reason:
        [quoteResult.warning, nasdaqFallback.warning, stooqFallback.warning].filter(Boolean).join(" ") ||
        "Yahoo Finance did not return usable quote or price summary data."
    });
  }
  const quoteSource = getQuoteSource(symbol, quoteResult.quote, summary, chart, fallbackQuote);

  return {
    quote: quoteResult.quote || {},
    fallbackQuote: fallbackQuote || null,
    fallbackProfile,
    quoteSourceLabel: quoteSource?.label || null,
    quoteSourceUrl: quoteSource?.url || null,
    summary,
    chart,
    warnings,
    fetchedAt: new Date().toISOString()
  };
}

async function fetchQuote(symbol) {
  try {
    const yahoo = await getYahooFinance();
    return {
      quote: await withTimeout(yahoo.quote(symbol), marketDataTimeoutMs, `Yahoo Finance quote timed out for ${symbol}.`),
      warning: null
    };
  } catch (error) {
    return {
      quote: null,
      warning: `Yahoo Finance quote endpoint unavailable for ${symbol}: ${error.message}`
    };
  }
}

async function fetchQuoteSummary(symbol) {
  try {
    const yahoo = await getYahooFinance();
    return await withTimeout(
      yahoo.quoteSummary(symbol, { modules: summaryModules }),
      marketDataTimeoutMs,
      `Yahoo Finance quoteSummary timed out for ${symbol}.`
    );
  } catch {
    try {
      const yahoo = await getYahooFinance();
      return await withTimeout(
        yahoo.quoteSummary(symbol, {
          modules: ["price", "assetProfile", "summaryProfile", "financialData", "defaultKeyStatistics", "summaryDetail"]
        }),
        marketDataTimeoutMs,
        `Yahoo Finance reduced quoteSummary timed out for ${symbol}.`
      );
    } catch {
      return {};
    }
  }
}

function hasUsableQuote(quote, summary, chart, fallbackQuote) {
  return Boolean(
    quote?.regularMarketPrice ||
      quote?.postMarketPrice ||
      quote?.preMarketPrice ||
      summary?.price?.regularMarketPrice ||
      summary?.summaryDetail?.previousClose ||
      fallbackQuote?.regularMarketPrice ||
      chart?.meta?.regularMarketPrice ||
      chart?.meta?.previousClose
  );
}

function getQuoteSource(symbol, quote, summary, chart, fallbackQuote) {
  if (quote?.regularMarketPrice || quote?.postMarketPrice || quote?.preMarketPrice) {
    return { label: "Yahoo Finance quote", url: yahooQuoteUrl(symbol) };
  }
  if (summary?.price?.regularMarketPrice || summary?.summaryDetail?.previousClose) {
    return { label: "Yahoo Finance quoteSummary", url: yahooQuoteUrl(symbol) };
  }
  if (fallbackQuote?.regularMarketPrice) {
    return { label: fallbackQuote.sourceLabel || "Fallback quote", url: fallbackQuote.sourceUrl || null };
  }
  if (chart?.meta?.regularMarketPrice || chart?.meta?.previousClose) {
    return { label: "Yahoo Finance chart metadata", url: yahooChartUrl(symbol) };
  }
  return null;
}

async function fetchNasdaqQuote(symbol) {
  const nasdaqSymbol = toNasdaqSymbol(symbol);
  if (!nasdaqSymbol) return { quote: null, profile: null, warning: null };

  try {
    const [info, summary] = await Promise.all([
      fetchNasdaqJson(`https://api.nasdaq.com/api/quote/${encodeURIComponent(nasdaqSymbol)}/info?assetclass=stocks`),
      fetchNasdaqJson(`https://api.nasdaq.com/api/quote/${encodeURIComponent(nasdaqSymbol)}/summary?assetclass=stocks`).catch(
        () => null
      )
    ]);
    const data = info?.data || {};
    const summaryData = summary?.data?.summaryData || {};
    const primary = data.primaryData || {};
    const secondary = data.secondaryData || {};
    const primaryPrice = parseProviderNumber(primary.lastSalePrice);
    const secondaryPrice = parseProviderNumber(secondary.lastSalePrice);
    const usePrimary = Number.isFinite(primaryPrice) && (primary.isRealTime || data.marketStatus !== "Closed");
    const selected = usePrimary ? primary : Number.isFinite(secondaryPrice) ? secondary : primary;
    const latestPrice = usePrimary ? primaryPrice : secondaryPrice || primaryPrice;
    if (!Number.isFinite(latestPrice) || latestPrice <= 0) throw new Error("Nasdaq returned no usable price.");

    const previousClose = parseProviderNumber(summaryData.PreviousClose?.value);
    const netChange = parseProviderNumber(selected.netChange);
    const marketCap = parseProviderNumber(summaryData.MarketCap?.value);
    const volume = parseProviderNumber(selected.volume || summaryData.ShareVolume?.value);
    const quote = {
      symbol,
      shortName: data.companyName || symbol,
      longName: data.companyName || symbol,
      fullExchangeName: summaryData.Exchange?.value || data.exchange || null,
      exchange: summaryData.Exchange?.value || data.exchange || null,
      currency: "USD",
      marketState: data.marketStatus || (selected.isRealTime ? "REALTIME" : "DELAYED"),
      regularMarketPrice: latestPrice,
      regularMarketPreviousClose: Number.isFinite(previousClose) ? previousClose : null,
      regularMarketChange: Number.isFinite(netChange)
        ? netChange
        : Number.isFinite(previousClose)
          ? latestPrice - previousClose
          : null,
      regularMarketChangePercent: parseProviderPercent(selected.percentageChange),
      regularMarketVolume: Number.isFinite(volume) ? volume : null,
      marketCap: Number.isFinite(marketCap) ? marketCap : null,
      regularMarketTime: parseNasdaqTimestamp(selected.lastTradeTimestamp),
      sourceLabel: usePrimary ? "Nasdaq real-time quote fallback" : "Nasdaq delayed quote fallback",
      sourceUrl: nasdaqQuoteUrl(nasdaqSymbol)
    };
    return {
      quote,
      profile: {
        sector: cleanProviderText(summaryData.Sector?.value),
        industry: cleanProviderText(summaryData.Industry?.value)
      },
      warning: `Yahoo Finance quote path was unavailable; used ${quote.sourceLabel} for ${symbol}.`
    };
  } catch (error) {
    return {
      quote: null,
      profile: null,
      warning: `Nasdaq quote fallback unavailable for ${symbol}: ${error.message}`
    };
  }
}

async function fetchNasdaqJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
    },
    signal: AbortSignal.timeout(marketDataTimeoutMs)
  });
  if (!response.ok) throw new Error(`Nasdaq HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.status?.rCode && payload.status.rCode !== 200) {
    throw new Error(`Nasdaq status ${payload.status.rCode}`);
  }
  return payload;
}

async function fetchChart(symbol) {
  const period2 = new Date();
  const period1 = new Date(period2);
  period1.setMonth(period1.getMonth() - 6);

  try {
    const yahoo = await getYahooFinance();
    return await withTimeout(
      yahoo.chart(symbol, {
        period1,
        period2,
        interval: "1d"
      }),
      marketDataTimeoutMs,
      `Yahoo Finance chart timed out for ${symbol}.`
    );
  } catch {
    return null;
  }
}

async function getYahooFinance() {
  if (!yahooFinance) {
    const { default: YahooFinance } = await import("yahoo-finance2");
    yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  }
  return yahooFinance;
}

async function fetchStooqQuote(symbol) {
  const stooqSymbol = toStooqSymbol(symbol);
  if (!stooqSymbol) return { quote: null, warning: null };

  try {
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(stooqSymbol)}&f=sd2t2ohlcvp&h&e=csv`;
    const response = await fetch(url, {
      headers: { "User-Agent": "The Floor research app" },
      signal: AbortSignal.timeout(marketDataTimeoutMs)
    });
    if (!response.ok) throw new Error(`Stooq HTTP ${response.status}`);
    const text = await response.text();
    const rows = text.trim().split(/\r?\n/);
    if (rows.length < 2) throw new Error("Stooq returned no data rows.");
    const headers = rows[0].split(",");
    const values = rows[1].split(",");
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    const close = Number(record.Close);
    if (!Number.isFinite(close) || close <= 0) throw new Error("Stooq returned no close price.");
    const previousClose = Number(record.Prev);
    const open = Number(record.Open);
    const high = Number(record.High);
    const low = Number(record.Low);
    const volume = Number(record.Volume);
    const asOf = stooqTimestamp(record.Date, record.Time);
    return {
      quote: {
        regularMarketPrice: close,
        regularMarketPreviousClose: Number.isFinite(previousClose) ? previousClose : null,
        regularMarketChange: Number.isFinite(previousClose) ? close - previousClose : null,
        regularMarketOpen: Number.isFinite(open) ? open : null,
        regularMarketDayHigh: Number.isFinite(high) ? high : null,
        regularMarketDayLow: Number.isFinite(low) ? low : null,
        regularMarketVolume: Number.isFinite(volume) ? volume : null,
        currency: "USD",
        marketState: "DELAYED",
        regularMarketTime: asOf,
        sourceUrl: `https://stooq.com/q/?s=${encodeURIComponent(stooqSymbol)}`
      },
      warning: `Yahoo Finance quote path was unavailable; used Stooq delayed quote for ${symbol}.`
    };
  } catch (error) {
    return {
      quote: null,
      warning: `Stooq quote fallback unavailable for ${symbol}: ${error.message}`
    };
  }
}

function toStooqSymbol(symbol) {
  const normalized = String(symbol || "").trim().toLowerCase();
  if (!normalized || /[:]/.test(normalized)) return null;
  if (normalized.endsWith(".t")) return normalized.replace(/\.t$/, ".jp");
  if (normalized.includes(".")) return normalized;
  return `${normalized}.us`;
}

function toNasdaqSymbol(symbol) {
  const normalized = String(symbol || "").trim().toUpperCase();
  if (!normalized || /[:.]/.test(normalized)) return null;
  return normalized;
}

function stooqTimestamp(date, time) {
  if (!date || !time) return null;
  const value = new Date(`${date}T${time}Z`);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

function yahooQuoteUrl(symbol) {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}

function nasdaqQuoteUrl(symbol) {
  return `https://www.nasdaq.com/market-activity/stocks/${encodeURIComponent(symbol.toLowerCase())}`;
}

function yahooChartUrl(symbol) {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/chart`;
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    })
  ]);
}

function parseProviderNumber(value) {
  if (value === null || value === undefined || value === "" || value === "--") return null;
  const cleaned = String(value).replace(/[$,%\s]/g, "").replaceAll(",", "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function parseProviderPercent(value) {
  const number = parseProviderNumber(value);
  return Number.isFinite(number) ? number / 100 : null;
}

function cleanProviderText(value) {
  const text = String(value || "").trim();
  return text && text !== "--" ? text : null;
}

function parseNasdaqTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(`${String(value).replace(" ET", "")} GMT-0400`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function fixtureMarketData(resolution) {
  const now = new Date();
  const quotes = [];
  for (let index = 0; index < 120; index += 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - (120 - index));
    const close = 350 + index * 1.05 + Math.sin(index / 6) * 11;
    quotes.push({ date, close });
  }

  return {
    fetchedAt: now.toISOString(),
    quoteSourceLabel: "Fixture market data",
    quoteSourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(resolution.resolvedTicker)}`,
    quote: {
      symbol: resolution.resolvedTicker,
      shortName: resolution.displayName,
      longName: resolution.displayName,
      fullExchangeName: "NasdaqGS",
      exchange: resolution.exchange,
      currency: "USD",
      marketState: "REGULAR",
      regularMarketPrice: 482.33,
      regularMarketChange: 5.42,
      regularMarketChangePercent: 1.14,
      marketCap: 3580000000000,
      trailingPE: 34.8,
      forwardPE: 27.3,
      beta: 0.92
    },
    summary: {
      price: {
        longName: resolution.displayName,
        shortName: resolution.displayName,
        exchangeName: "NasdaqGS",
        currency: "USD",
        marketCap: 3580000000000,
        regularMarketPrice: 482.33,
        regularMarketChange: 5.42
      },
      assetProfile: {
        sector: "Technology",
        industry: "Software - Infrastructure",
        longBusinessSummary:
          "Fixture company provides cloud software, AI infrastructure, and productivity platforms to enterprise and consumer customers globally."
      },
      financialData: {
        revenueGrowth: 0.16,
        grossMargins: 0.695,
        operatingMargins: 0.455,
        freeCashflow: 74200000000,
        operatingCashflow: 118500000000,
        totalDebt: 110000000000
      },
      defaultKeyStatistics: {
        trailingPE: 34.8,
        forwardPE: 27.3,
        beta: 0.92,
        enterpriseToEbitda: 23.7,
        priceToBook: 11.4
      },
      summaryDetail: {
        dividendYield: 0.007,
        fiftyTwoWeekHigh: 502.44,
        fiftyTwoWeekLow: 366.22
      },
      earnings: {
        financialsChart: {
          quarterly: [
            { date: "1Q2025", revenue: 61800000000, earnings: 21900000000 },
            { date: "2Q2025", revenue: 64700000000, earnings: 23700000000 }
          ]
        }
      },
      secFilings: {
        filings: [
          { type: "10-Q", date: "2026-01-29", edgarUrl: "https://www.sec.gov/ixviewer/doc/action" },
          { type: "10-K", date: "2025-07-30", edgarUrl: "https://www.sec.gov/ixviewer/doc/action" }
        ]
      }
    },
    chart: {
      quotes
    }
  };
}
