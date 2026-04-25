import yahooFinance from "yahoo-finance2";
import { AppError } from "../utils/errors.mjs";

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
  let quote;
  try {
    quote = await yahooFinance.quote(symbol);
  } catch (error) {
    throw new AppError("market_data_provider_failed", `Could not fetch current quote for ${symbol}.`, 502, {
      reason: error.message
    });
  }

  const [summary, chart] = await Promise.all([
    fetchQuoteSummary(symbol),
    fetchChart(symbol)
  ]);

  return {
    quote,
    summary,
    chart,
    fetchedAt: new Date().toISOString()
  };
}

async function fetchQuoteSummary(symbol) {
  try {
    return await yahooFinance.quoteSummary(symbol, { modules: summaryModules });
  } catch {
    try {
      return await yahooFinance.quoteSummary(symbol, {
        modules: ["price", "assetProfile", "summaryProfile", "financialData", "defaultKeyStatistics", "summaryDetail"]
      });
    } catch {
      return {};
    }
  }
}

async function fetchChart(symbol) {
  const period2 = new Date();
  const period1 = new Date(period2);
  period1.setMonth(period1.getMonth() - 6);

  try {
    return await yahooFinance.chart(symbol, {
      period1,
      period2,
      interval: "1d"
    });
  } catch {
    return null;
  }
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

