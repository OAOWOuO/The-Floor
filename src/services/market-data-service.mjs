import { AppError } from "../utils/errors.mjs";

let yahooFinance;
const marketDataTimeoutMs = Number(process.env.MARKET_DATA_TIMEOUT_MS || 7000);
const yahooFinanceEnabled = process.env.THE_FLOOR_ENABLE_YAHOO_FINANCE2 === "1";

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
  const [
    quoteResult,
    summary,
    chartBundle,
    nasdaqFallback,
    cnbcFallback,
    nasdaqFinancialsResult,
    stooqFallback
  ] = await Promise.all([
    fetchQuote(symbol),
    fetchQuoteSummary(symbol),
    fetchPriceChart(symbol),
    fetchNasdaqQuote(symbol),
    fetchCnbcQuoteStats(symbol),
    fetchNasdaqFinancials(symbol),
    fetchStooqQuote(symbol)
  ]);
  const fallbackQuote = nasdaqFallback.quote || cnbcFallback.quote || stooqFallback.quote;
  const fallbackProfile = nasdaqFallback.profile || null;
  const cnbcStats = cnbcFallback.stats || null;
  const nasdaqFinancials = nasdaqFinancialsResult.financials || null;
  const chart = chartBundle.chart || null;
  const chartSourceLabel = chartBundle.sourceLabel || null;
  const chartSourceUrl = chartBundle.sourceUrl || null;

  if (quoteResult.warning) warnings.push(quoteResult.warning);
  if (!quoteResult.quote && nasdaqFallback.warning) warnings.push(nasdaqFallback.warning);
  if (!quoteResult.quote && !nasdaqFallback.quote && cnbcFallback.warning) warnings.push(cnbcFallback.warning);
  if (!quoteResult.quote && !nasdaqFallback.quote && !cnbcFallback.quote && stooqFallback.warning) {
    warnings.push(stooqFallback.warning);
  }
  if (!chart && chartBundle.warning) warnings.push(chartBundle.warning);
  if (!Object.keys(summary || {}).length) {
    if (yahooFinanceEnabled && !cnbcStats) {
      warnings.push("Yahoo Finance quoteSummary unavailable; valuation statistics may be incomplete.");
    }
    if (!nasdaqFinancials && nasdaqFinancialsResult.warning) {
      warnings.push(nasdaqFinancialsResult.warning);
    }
    if (cnbcFallback.warning && !cnbcStats) warnings.push(cnbcFallback.warning);
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
    cnbcStats,
    nasdaqFinancials,
    chartSourceLabel,
    chartSourceUrl,
    quoteSourceLabel: quoteSource?.label || null,
    quoteSourceUrl: quoteSource?.url || null,
    summary,
    chart,
    warnings,
    fetchedAt: new Date().toISOString()
  };
}

async function fetchQuote(symbol) {
  if (!yahooFinanceEnabled) return { quote: null, warning: null };

  try {
    return {
      quote: await withTimeout(
        (async () => {
          const yahoo = await getYahooFinance();
          return yahoo.quote(symbol);
        })(),
        marketDataTimeoutMs,
        `Yahoo Finance quote timed out for ${symbol}.`
      ),
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
  if (!yahooFinanceEnabled) return {};

  try {
    return await withTimeout(
      (async () => {
        const yahoo = await getYahooFinance();
        return yahoo.quoteSummary(symbol, { modules: summaryModules });
      })(),
      marketDataTimeoutMs,
      `Yahoo Finance quoteSummary timed out for ${symbol}.`
    );
  } catch {
    try {
      return await withTimeout(
        (async () => {
          const yahoo = await getYahooFinance();
          return yahoo.quoteSummary(symbol, {
            modules: [
              "price",
              "assetProfile",
              "summaryProfile",
              "financialData",
              "defaultKeyStatistics",
              "summaryDetail"
            ]
          });
        })(),
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
    const companyName = cleanNasdaqCompanyName(data.companyName || symbol);
    const quote = {
      symbol,
      shortName: companyName,
      longName: companyName,
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
      sourceLabel: usePrimary
        ? yahooFinanceEnabled
          ? "Nasdaq real-time quote fallback"
          : "Nasdaq real-time quote"
        : yahooFinanceEnabled
          ? "Nasdaq delayed quote fallback"
          : "Nasdaq delayed quote",
      sourceUrl: nasdaqQuoteUrl(nasdaqSymbol)
    };
    return {
      quote,
      profile: {
        sector: cleanProviderText(summaryData.Sector?.value),
        industry: cleanProviderText(summaryData.Industry?.value)
      },
      warning: yahooFinanceEnabled ? `Yahoo Finance quote path was unavailable; used ${quote.sourceLabel} for ${symbol}.` : null
    };
  } catch (error) {
    return {
      quote: null,
      profile: null,
      warning: `Nasdaq quote fallback unavailable for ${symbol}: ${error.message}`
    };
  }
}

async function fetchCnbcQuoteStats(symbol) {
  const cnbcSymbol = toCnbcSymbol(symbol);
  if (!cnbcSymbol) return { quote: null, stats: null, warning: null };

  try {
    const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(
      cnbcSymbol
    )}&output=json`;
    const response = await fetch(url, {
      headers: { Accept: "application/json,text/plain,*/*", "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(marketDataTimeoutMs)
    });
    if (!response.ok) throw new Error(`CNBC HTTP ${response.status}`);
    const payload = await response.json();
    const row = payload?.FormattedQuoteResult?.FormattedQuote?.[0];
    if (!row || Number(row.code || 0) !== 0) throw new Error("CNBC returned no usable quote row.");

    const last = parseProviderNumber(row.last);
    const previousClose = parseProviderNumber(row.previous_day_closing);
    const change = parseProviderNumber(row.change);
    const marketCap = parseProviderNumber(row.mktcapView);
    const volume = parseProviderNumber(row.volume);
    const quote =
      Number.isFinite(last) && last > 0
        ? {
            symbol,
            shortName: cleanProviderText(row.name || row.shortName || symbol),
            longName: cleanProviderText(row.name || row.shortName || symbol),
            fullExchangeName: cleanProviderText(row.exchange),
            exchange: cleanProviderText(row.exchange),
            currency: cleanProviderText(row.currencyCode) || "USD",
            marketState: cleanProviderText(row.curmktstatus) || (row.realTime === "true" ? "REALTIME" : "DELAYED"),
            regularMarketPrice: last,
            regularMarketPreviousClose: Number.isFinite(previousClose) ? previousClose : null,
            regularMarketChange: Number.isFinite(change)
              ? change
              : Number.isFinite(previousClose)
                ? last - previousClose
                : null,
            regularMarketChangePercent: parseProviderPercent(row.change_pct),
            regularMarketVolume: Number.isFinite(volume) ? volume : null,
            marketCap: Number.isFinite(marketCap) ? marketCap : null,
            regularMarketTime: parseCnbcTimestamp(row.last_time),
            sourceLabel: "CNBC quote service",
            sourceUrl: cnbcQuoteUrl(cnbcSymbol)
          }
        : null;

    const stats = {
      sourceLabel: "CNBC quote statistics",
      sourceUrl: cnbcQuoteUrl(cnbcSymbol),
      trailingPE: parseProviderNumber(row.pe),
      forwardPE: parseProviderNumber(row.fpe),
      beta: parseProviderNumber(row.beta),
      epsTtm: parseProviderNumber(row.eps),
      forwardEps: parseProviderNumber(row.feps),
      priceToSales: parseProviderNumber(row.psales),
      forwardPriceToSales: parseProviderNumber(row.fpsales),
      revenueTtm: parseProviderNumber(row.revenuettm),
      forecastSales: parseProviderNumber(row.fsales),
      ebitdaTtm: parseProviderNumber(row.TTMEBITD),
      dividendPerShare: parseProviderNumber(row.dividend),
      dividendYield: parseProviderPercent(row.dividendyield),
      returnOnEquity: parseProviderPercent(row.ROETTM),
      profitMargin: parseProviderPercent(row.NETPROFTTM),
      grossMargins: parseProviderPercent(row.GROSMGNTTM),
      debtToEquity: parseProviderPercent(row.DEBTEQTYQ),
      sharesOutstanding: parseProviderNumber(row.sharesout)
    };
    const hasStats = Object.entries(stats).some(
      ([key, value]) => !["sourceLabel", "sourceUrl"].includes(key) && Number.isFinite(value)
    );

    return {
      quote,
      stats: hasStats ? stats : null,
      warning: null
    };
  } catch (error) {
    return {
      quote: null,
      stats: null,
      warning: `CNBC quote statistics unavailable for ${symbol}: ${error.message}`
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

async function fetchNasdaqFinancials(symbol) {
  const nasdaqSymbol = toNasdaqSymbol(symbol);
  if (!nasdaqSymbol) return { financials: null, warning: null };

  try {
    const url = `https://api.nasdaq.com/api/company/${encodeURIComponent(nasdaqSymbol)}/financials?frequency=1`;
    const payload = await fetchNasdaqJson(url);
    const data = payload?.data || {};
    const income = data.incomeStatementTable || {};
    const balance = data.balanceSheetTable || {};
    const cashFlow = data.cashFlowTable || {};
    const ratios = data.financialRatiosTable || {};

    const revenue = nasdaqStatementValue(findNasdaqRow(income, "Total Revenue"), "value2");
    const priorRevenue = nasdaqStatementValue(findNasdaqRow(income, "Total Revenue"), "value3");
    const grossProfit = nasdaqStatementValue(findNasdaqRow(income, "Gross Profit"), "value2");
    const operatingIncome = nasdaqStatementValue(findNasdaqRow(income, "Operating Income"), "value2");
    const netIncome = nasdaqStatementValue(findNasdaqRow(income, "Net Income"), "value2");
    const operatingCashflow = nasdaqStatementValue(findNasdaqRow(cashFlow, "Net Cash Flow-Operating"), "value2");
    const capitalExpenditures = nasdaqStatementValue(findNasdaqRow(cashFlow, "Capital Expenditures"), "value2");
    const cashAndEquivalents = nasdaqStatementValue(findNasdaqRow(balance, "Cash and Cash Equivalents"), "value2");
    const totalAssets = nasdaqStatementValue(findNasdaqRow(balance, "Total Assets"), "value2");
    const shortTermDebt = nasdaqStatementValue(
      findNasdaqRow(balance, "Short-Term Debt / Current Portion of Long-Term Debt"),
      "value2"
    );
    const longTermDebt = nasdaqStatementValue(findNasdaqRow(balance, "Long-Term Debt"), "value2");
    const totalDebt = [shortTermDebt, longTermDebt]
      .filter((value) => Number.isFinite(value))
      .reduce((sum, value) => sum + value, 0);
    const freeCashflow =
      Number.isFinite(operatingCashflow) && Number.isFinite(capitalExpenditures)
        ? operatingCashflow + capitalExpenditures
        : null;

    const financials = {
      sourceLabel: "Nasdaq annual financials",
      sourceUrl: nasdaqFinancialsUrl(nasdaqSymbol),
      periodEnd: nasdaqPeriodEnd(income.headers?.value2),
      revenue,
      priorRevenue,
      revenueGrowth:
        Number.isFinite(revenue) && Number.isFinite(priorRevenue) && priorRevenue !== 0
          ? (revenue - priorRevenue) / Math.abs(priorRevenue)
          : null,
      grossProfit,
      operatingIncome,
      netIncome,
      operatingCashflow,
      capitalExpenditures,
      freeCashflow,
      totalDebt: totalDebt || null,
      cashAndEquivalents,
      totalAssets,
      grossMargins: nasdaqRatioValue(findNasdaqRow(ratios, "Gross Margin"), "value2"),
      operatingMargins: nasdaqRatioValue(findNasdaqRow(ratios, "Operating Margin"), "value2"),
      profitMargin: nasdaqRatioValue(findNasdaqRow(ratios, "Profit Margin"), "value2"),
      currentRatio: nasdaqRatioValue(findNasdaqRow(ratios, "Current Ratio"), "value2"),
      quickRatio: nasdaqRatioValue(findNasdaqRow(ratios, "Quick Ratio"), "value2"),
      cashRatio: nasdaqRatioValue(findNasdaqRow(ratios, "Cash Ratio"), "value2"),
      afterTaxRoe: nasdaqRatioValue(findNasdaqRow(ratios, "After Tax ROE"), "value2")
    };

    if (!Object.values(financials).some((value) => typeof value === "number" && Number.isFinite(value))) {
      throw new Error("Nasdaq returned no usable annual financial values.");
    }

    return { financials, warning: null };
  } catch (error) {
    return {
      financials: null,
      warning: `Nasdaq annual financials fallback unavailable for ${symbol}: ${error.message}`
    };
  }
}

async function fetchNasdaqHistoricalChart(symbol) {
  const nasdaqSymbol = toNasdaqSymbol(symbol);
  if (!nasdaqSymbol) return { chart: null, sourceLabel: null, sourceUrl: null, warning: null };

  const period2 = new Date();
  const period1 = new Date(period2);
  period1.setMonth(period1.getMonth() - 6);
  const sourceUrl = [
    `https://api.nasdaq.com/api/quote/${encodeURIComponent(nasdaqSymbol)}/historical?assetclass=stocks`,
    `fromdate=${period1.toISOString().slice(0, 10)}`,
    `todate=${period2.toISOString().slice(0, 10)}`,
    "limit=9999"
  ].join("&");

  try {
    const payload = await fetchNasdaqJson(sourceUrl);
    const rows = payload?.data?.tradesTable?.rows || [];
    const quotes = rows
      .map((row) => {
        const close = parseProviderNumber(row.close);
        const date = parseNasdaqHistoricalDate(row.date);
        return Number.isFinite(close) && date ? { date, close } : null;
      })
      .filter(Boolean)
      .sort((left, right) => left.date - right.date);
    if (quotes.length < 2) throw new Error("Nasdaq returned too few historical closes.");
    return {
      chart: {
        quotes,
        meta: {
          currency: "USD",
          regularMarketPrice: quotes.at(-1)?.close || null,
          previousClose: quotes.at(-2)?.close || null
        }
      },
      sourceLabel: "Nasdaq six-month price history",
      sourceUrl: nasdaqHistoricalUrl(nasdaqSymbol),
      warning: null
    };
  } catch (error) {
    return {
      chart: null,
      sourceLabel: null,
      sourceUrl: null,
      warning: `Nasdaq historical fallback unavailable for ${symbol}: ${error.message}`
    };
  }
}

function findNasdaqRow(table, label) {
  const rows = table?.rows || [];
  const normalizedLabel = normalizeLabel(label);
  return rows.find((row) => normalizeLabel(row.value1) === normalizedLabel) || null;
}

function normalizeLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function nasdaqStatementValue(row, key) {
  const number = parseProviderNumber(row?.[key]);
  return Number.isFinite(number) ? number * 1000 : null;
}

function nasdaqRatioValue(row, key) {
  return parseProviderPercent(row?.[key]);
}

function nasdaqPeriodEnd(value) {
  if (!value) return null;
  const parsed = new Date(`${value} 00:00:00 GMT-0500`);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString().slice(0, 10);
}

function parseNasdaqHistoricalDate(value) {
  if (!value) return null;
  const parsed = new Date(`${value} 00:00:00 GMT-0500`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function fetchChart(symbol) {
  if (!yahooFinanceEnabled) return null;

  const period2 = new Date();
  const period1 = new Date(period2);
  period1.setMonth(period1.getMonth() - 6);

  try {
    return await withTimeout(
      (async () => {
        const yahoo = await getYahooFinance();
        return yahoo.chart(symbol, {
          period1,
          period2,
          interval: "1d"
        });
      })(),
      marketDataTimeoutMs,
      `Yahoo Finance chart timed out for ${symbol}.`
    );
  } catch {
    return null;
  }
}

async function fetchPriceChart(symbol) {
  const warnings = [];
  const yahooChart = await fetchChart(symbol);
  if (yahooChart) {
    return {
      chart: yahooChart,
      sourceLabel: "Yahoo Finance six-month chart",
      sourceUrl: yahooChartUrl(symbol),
      warning: null
    };
  }

  const nasdaqHistoricalChart = await fetchNasdaqHistoricalChart(symbol);
  if (nasdaqHistoricalChart.chart) return nasdaqHistoricalChart;
  if (nasdaqHistoricalChart.warning) warnings.push(nasdaqHistoricalChart.warning);

  const stooqChart = await fetchStooqChart(symbol);
  if (stooqChart.chart) return stooqChart;
  if (stooqChart.warning) warnings.push(stooqChart.warning);

  return {
    chart: null,
    sourceLabel: null,
    sourceUrl: null,
    warning: warnings.join(" ")
  };
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
      warning: `${yahooFinanceEnabled ? "Yahoo Finance quote path was unavailable" : "Public quote feeds were unavailable"}; used Stooq delayed quote for ${symbol}.`
    };
  } catch (error) {
    return {
      quote: null,
      warning: `Stooq quote fallback unavailable for ${symbol}: ${error.message}`
    };
  }
}

async function fetchStooqChart(symbol) {
  const stooqSymbol = toStooqSymbol(symbol);
  if (!stooqSymbol) return { chart: null, sourceLabel: null, sourceUrl: null, warning: null };

  const period2 = new Date();
  const period1 = new Date(period2);
  period1.setMonth(period1.getMonth() - 6);
  const d1 = stooqDate(period1);
  const d2 = stooqDate(period2);
  const sourceUrl = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&d1=${d1}&d2=${d2}&i=d`;

  try {
    const response = await fetch(sourceUrl, {
      headers: { "User-Agent": "The Floor research app" },
      signal: AbortSignal.timeout(marketDataTimeoutMs)
    });
    if (!response.ok) throw new Error(`Stooq historical HTTP ${response.status}`);
    const text = await response.text();
    const rows = text.trim().split(/\r?\n/);
    if (rows.length < 3) throw new Error("Stooq returned too few historical rows.");
    const headers = rows[0].split(",");
    const quotes = rows
      .slice(1)
      .map((row) => {
        const values = row.split(",");
        const record = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
        const close = Number(record.Close);
        const date = record.Date ? new Date(`${record.Date}T00:00:00Z`) : null;
        return Number.isFinite(close) && date && !Number.isNaN(date.getTime()) ? { date, close } : null;
      })
      .filter(Boolean);
    if (quotes.length < 2) throw new Error("Stooq returned no usable historical closes.");
    return {
      chart: {
        quotes,
        meta: {
          currency: "USD",
          regularMarketPrice: quotes.at(-1)?.close || null,
          previousClose: quotes.at(-2)?.close || null
        }
      },
      sourceLabel: "Stooq six-month price history",
      sourceUrl,
      warning: null
    };
  } catch (error) {
    return {
      chart: null,
      sourceLabel: null,
      sourceUrl: null,
      warning: `Stooq historical fallback unavailable for ${symbol}: ${error.message}`
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

function toCnbcSymbol(symbol) {
  const normalized = String(symbol || "").trim().toUpperCase();
  if (!normalized || /[:]/.test(normalized)) return null;
  return normalized;
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

function stooqDate(date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function yahooQuoteUrl(symbol) {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}

function nasdaqQuoteUrl(symbol) {
  return `https://www.nasdaq.com/market-activity/stocks/${encodeURIComponent(symbol.toLowerCase())}`;
}

function nasdaqFinancialsUrl(symbol) {
  return `https://www.nasdaq.com/market-activity/stocks/${encodeURIComponent(symbol.toLowerCase())}/financials`;
}

function nasdaqHistoricalUrl(symbol) {
  return `https://www.nasdaq.com/market-activity/stocks/${encodeURIComponent(symbol.toLowerCase())}/historical`;
}

function cnbcQuoteUrl(symbol) {
  return `https://www.cnbc.com/quotes/${encodeURIComponent(symbol)}`;
}

function yahooChartUrl(symbol) {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/chart`;
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function parseProviderNumber(value) {
  if (value === null || value === undefined || value === "" || value === "--" || value === "N/A") return null;
  let cleaned = String(value).trim();
  if (!cleaned || cleaned === "--" || /^n\/a$/i.test(cleaned)) return null;
  const isParentheticalNegative = /^\(.+\)$/.test(cleaned);
  cleaned = cleaned.replace(/[$,%\s]/g, "").replaceAll(",", "").replace(/[()]/g, "");
  const match = cleaned.match(/^([-+]?\d*\.?\d+)([KMBT])?$/i);
  if (!match) return null;
  const multiplier = {
    K: 1e3,
    M: 1e6,
    B: 1e9,
    T: 1e12
  }[String(match[2] || "").toUpperCase()] || 1;
  const number = Number(match[1]) * multiplier;
  if (!Number.isFinite(number)) return null;
  return isParentheticalNegative ? -number : number;
}

function parseProviderPercent(value) {
  const number = parseProviderNumber(value);
  return Number.isFinite(number) ? number / 100 : null;
}

function cleanProviderText(value) {
  const text = String(value || "").trim();
  return text && text !== "--" ? text : null;
}

function cleanNasdaqCompanyName(value) {
  return (
    cleanProviderText(value)
      ?.replace(/\s+Common Stock$/i, "")
      .replace(/\s+Ordinary Shares$/i, "")
      .trim() || null
  );
}

function parseNasdaqTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(`${String(value).replace(" ET", "")} GMT-0400`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseCnbcTimestamp(value) {
  if (!value) return null;
  const normalized = String(value).replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const parsed = new Date(normalized);
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
