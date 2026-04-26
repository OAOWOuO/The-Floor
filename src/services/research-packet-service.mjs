import { ResearchPacketSchema } from "../domain/schemas.mjs";
import { round, toNumber } from "../utils/math.mjs";

export function buildResearchPacket({ resolution, marketData, disclosureData }) {
  const quote = marketData?.quote || {};
  const summary = marketData?.summary || {};
  const profile = summary.assetProfile || summary.summaryProfile || {};
  const price = summary.price || {};
  const fallbackQuote = marketData?.fallbackQuote || {};
  const chartMeta = marketData?.chart?.meta || {};
  const financialData = summary.financialData || {};
  const keyStatistics = summary.defaultKeyStatistics || {};
  const summaryDetail = summary.summaryDetail || {};
  const chartContext = buildRecentPriceContext(marketData?.chart);
  const secFacts = disclosureData?.companyFacts || {};
  const evidenceItems = [];
  const researchWarnings = [...(marketData?.warnings || []), ...(disclosureData?.warnings || [])];
  let evidenceIndex = 1;

  const latestPrice = firstNumber(
    quote.regularMarketPrice,
    quote.postMarketPrice,
    quote.preMarketPrice,
    price.regularMarketPrice,
    summaryDetail.previousClose,
    chartMeta.regularMarketPrice,
    chartMeta.previousClose,
    fallbackQuote.regularMarketPrice
  );
  const priceChange = firstNumber(
    quote.regularMarketChange,
    price.regularMarketChange,
    fallbackQuote.regularMarketChange,
    chartMeta.regularMarketPrice && chartMeta.previousClose ? chartMeta.regularMarketPrice - chartMeta.previousClose : null
  );
  const marketCap = firstNumber(quote.marketCap, price.marketCap);
  const displayName =
    firstString(quote.longName, quote.shortName, price.longName, price.shortName, resolution.displayName) ||
    resolution.resolvedTicker;
  const businessSummary = firstString(profile.longBusinessSummary, profile.longBusinessSummary?.fmt);
  const currency = firstString(
    quote.currency,
    price.currency,
    chartMeta.currency,
    fallbackQuote.currency,
    resolution.currency
  );
  const marketState = firstString(quote.marketState, price.marketState, fallbackQuote.marketState);

  const addEvidence = (sourceType, sourceLabel, claim, importance, analystRelevance, sourceUrl, timestamp) => {
    if (!claim) return null;
    const item = {
      evidenceId: `E${String(evidenceIndex).padStart(2, "0")}`,
      sourceType,
      sourceLabel,
      sourceUrl: sourceUrl || null,
      timestamp: timestamp || marketData?.fetchedAt || null,
      claim,
      importance,
      analystRelevance
    };
    evidenceIndex += 1;
    evidenceItems.push(item);
    return item;
  };

  addEvidence(
    "market_data",
    marketData?.quoteSourceLabel || "Yahoo Finance market data",
    `${resolution.resolvedTicker} last traded around ${formatPrice(latestPrice, currency)} with market cap ${formatLargeNumber(marketCap)} and market state ${marketState || "unknown"}.`,
    9,
    ["kenji", "marcus", "yara"],
    marketData?.quoteSourceUrl || yahooQuoteUrl(resolution.resolvedTicker)
  );

  if (businessSummary) {
    addEvidence(
      "company_profile",
      "Yahoo Finance company profile",
      `${displayName} operates in ${profile.sector || "an unspecified sector"} / ${profile.industry || "an unspecified industry"}: ${trimSentence(businessSummary, 360)}`,
      8,
      ["marcus", "yara", "sofia"],
      yahooProfileUrl(resolution.resolvedTicker)
    );
  }

  const revenueGrowth = toNumber(financialData.revenueGrowth);
  const grossMargins = toNumber(financialData.grossMargins);
  const operatingMargins = toNumber(financialData.operatingMargins);
  const fcf = firstNumber(financialData.freeCashflow, financialData.freeCashFlow);
  const opCash = firstNumber(financialData.operatingCashflow, financialData.operatingCashFlow, secFacts.operatingCashflow);
  const secRevenue = firstNumber(secFacts.revenue);
  const secNetIncome = firstNumber(secFacts.netIncome);
  if ([revenueGrowth, grossMargins, operatingMargins, fcf, opCash, secRevenue, secNetIncome].some((value) => value !== null)) {
    const hasYahooFundamentals = [revenueGrowth, grossMargins, operatingMargins, fcf].some((value) => value !== null);
    addEvidence(
      "fundamentals",
      hasYahooFundamentals ? "Yahoo Finance financialData" : "SEC EDGAR companyfacts",
      [
        revenueGrowth !== null ? `revenue growth ${formatPct(revenueGrowth)}` : null,
        grossMargins !== null ? `gross margin ${formatPct(grossMargins)}` : null,
        operatingMargins !== null ? `operating margin ${formatPct(operatingMargins)}` : null,
        secRevenue !== null ? `latest SEC revenue ${formatLargeNumber(secRevenue)}` : null,
        secNetIncome !== null ? `latest SEC net income ${formatLargeNumber(secNetIncome)}` : null,
        fcf !== null ? `free cash flow ${formatLargeNumber(fcf)}` : null,
        opCash !== null ? `operating cash flow ${formatLargeNumber(opCash)}` : null
      ]
        .filter(Boolean)
        .join("; ") + ".",
      8,
      ["marcus", "yara", "kenji"],
      hasYahooFundamentals ? yahooAnalysisUrl(resolution.resolvedTicker) : secFacts.sourceUrl
    );
  }

  const trailingPe = firstNumber(keyStatistics.trailingPE, quote.trailingPE);
  const forwardPe = firstNumber(keyStatistics.forwardPE, quote.forwardPE);
  const beta = firstNumber(keyStatistics.beta, quote.beta);
  const evToEbitda = firstNumber(keyStatistics.enterpriseToEbitda);
  if ([trailingPe, forwardPe, beta, evToEbitda].some((value) => value !== null)) {
    addEvidence(
      "key_statistics",
      "Yahoo Finance key statistics",
      [
        trailingPe !== null ? `trailing P/E ${round(trailingPe, 1)}` : null,
        forwardPe !== null ? `forward P/E ${round(forwardPe, 1)}` : null,
        beta !== null ? `beta ${round(beta, 2)}` : null,
        evToEbitda !== null ? `EV/EBITDA ${round(evToEbitda, 1)}` : null
      ]
        .filter(Boolean)
        .join("; ") + ".",
      7,
      ["yara", "kenji", "marcus"],
      yahooKeyStatsUrl(resolution.resolvedTicker)
    );
  }

  if (chartContext.observations.length) {
    addEvidence(
      "price_history",
      "Yahoo Finance six-month chart",
      chartContext.observations.join(" "),
      6,
      ["kenji", "sofia"],
      yahooChartUrl(resolution.resolvedTicker)
    );
  }

  if (disclosureData?.available) {
    const filingLabels = disclosureData.recentFilings
      .map((filing) => `${filing.form || "filing"} ${filing.filingDate || ""}`.trim())
      .slice(0, 3)
      .join(", ");
    addEvidence(
      "disclosure",
      disclosureData.source || "Recent disclosures",
      `${disclosureData.summary}${filingLabels ? ` Recent items: ${filingLabels}.` : ""}`,
      7,
      ["yara", "sofia", "skeptic"],
      disclosureData.recentFilings?.[0]?.url || null
    );
  } else {
    researchWarnings.push(disclosureData?.summary || "Recent filing/disclosure enrichment unavailable.");
  }

  const keyStats = {
    trailingPE: trailingPe,
    forwardPE: forwardPe,
    beta,
    enterpriseToEbitda: evToEbitda,
    priceToBook: firstNumber(keyStatistics.priceToBook),
    dividendYield: firstNumber(summaryDetail.dividendYield),
    revenueGrowth,
    grossMargins,
    operatingMargins,
    freeCashflow: fcf,
    operatingCashflow: opCash,
    totalDebt: firstNumber(financialData.totalDebt),
    secRevenue,
    secNetIncome,
    secAssets: firstNumber(secFacts.assets),
    secCashAndEquivalents: firstNumber(secFacts.cashAndEquivalents),
    secFiscalYear: secFacts.fiscalYear || null
  };

  const hasQuote = latestPrice !== null;
  const hasProfile = Boolean(businessSummary || profile.sector || profile.industry);
  const hasStats = Object.values(keyStats).some((value) => value !== null && value !== undefined);
  const dataCoverageScore = Math.min(
    100,
    (hasQuote ? 30 : 0) +
      (hasProfile ? 25 : 0) +
      (hasStats ? 25 : 0) +
      (chartContext.observations.length ? 10 : 0) +
      (disclosureData?.available ? 10 : 0)
  );
  const readyForDebate = Boolean(resolution?.resolvedTicker && hasQuote && (hasProfile || hasStats));

  if (!hasQuote) researchWarnings.push("Current quote data is missing.");
  if (!hasProfile && !hasStats) researchWarnings.push("Company profile and fundamentals are both missing.");
  if (!readyForDebate) researchWarnings.push("Coverage is too weak for a research-backed debate.");

  return ResearchPacketSchema.parse({
    resolvedTicker: resolution.resolvedTicker,
    displayName,
    exchange: quote.fullExchangeName || quote.exchange || price.exchangeName || resolution.exchange || null,
    currency: currency || null,
    marketState: marketState || null,
    latestPrice,
    priceChange,
    marketCap,
    sector: profile.sector || null,
    industry: profile.industry || null,
    businessSummary,
    keyStats,
    recentPriceContext: chartContext,
    filingOrDisclosureSummary: {
      available: Boolean(disclosureData?.available),
      summary: disclosureData?.summary || "Disclosure data unavailable.",
      recentFilings: disclosureData?.recentFilings || []
    },
    evidenceItems,
    researchWarnings: [...new Set(researchWarnings)].filter(Boolean),
    likelyMatches: resolution.likelyMatches || [],
    dataCoverageScore,
    readyForDebate
  });
}

export function summarizeResearchPacket(packet, synthesis = null, convictionState = null) {
  return {
    resolvedTicker: packet.resolvedTicker,
    displayName: packet.displayName,
    exchange: packet.exchange,
    currency: packet.currency,
    marketState: packet.marketState,
    latestPrice: packet.latestPrice,
    priceChange: packet.priceChange,
    marketCap: packet.marketCap,
    sector: packet.sector,
    industry: packet.industry,
    businessSummary: packet.businessSummary,
    keyStats: packet.keyStats,
    recentPriceContext: packet.recentPriceContext,
    filingOrDisclosureSummary: packet.filingOrDisclosureSummary,
    evidenceItems: packet.evidenceItems,
    researchWarnings: packet.researchWarnings,
    dataCoverageScore: packet.dataCoverageScore,
    readyForDebate: packet.readyForDebate,
    companySnapshot: synthesis?.company_snapshot || null,
    analystPriors: synthesis?.analyst_priors || null,
    initialConviction: convictionState?.conviction || null,
    convictionHistory: convictionState?.convictionHistory || null,
    openQuestionsForDebate: synthesis?.open_questions_for_debate || []
  };
}

function buildRecentPriceContext(chart) {
  const quotes = (chart?.quotes || [])
    .filter((item) => item?.close || item?.adjclose)
    .map((item) => ({
      date: item.date ? new Date(item.date) : null,
      close: firstNumber(item.close, item.adjclose)
    }))
    .filter((item) => item.date && item.close !== null);

  if (quotes.length < 2) {
    return { rangeStart: null, rangeEnd: null, periodReturnPct: null, high: null, low: null, observations: [] };
  }

  const first = quotes[0];
  const last = quotes.at(-1);
  const closes = quotes.map((item) => item.close);
  const high = Math.max(...closes);
  const low = Math.min(...closes);
  const periodReturnPct = first.close ? round(((last.close - first.close) / first.close) * 100, 1) : null;

  return {
    rangeStart: first.date.toISOString().slice(0, 10),
    rangeEnd: last.date.toISOString().slice(0, 10),
    periodReturnPct,
    high: round(high, 2),
    low: round(low, 2),
    observations: [
      `Over the available six-month chart window (${first.date.toISOString().slice(0, 10)} to ${last.date.toISOString().slice(0, 10)}), shares returned ${periodReturnPct}% with a range of ${round(low, 2)} to ${round(high, 2)}.`
    ]
  };
}

function firstNumber(...values) {
  for (const value of values) {
    const number = toNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function formatPct(value) {
  if (value === null || value === undefined) return "n/a";
  const number = Math.abs(value) <= 2 ? value * 100 : value;
  return `${round(number, 1)}%`;
}

function formatPrice(value, currency) {
  if (value === null || value === undefined) return "unavailable";
  return `${currency || ""} ${round(value, 2)}`.trim();
}

function formatLargeNumber(value) {
  if (value === null || value === undefined) return "unavailable";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) return `${round(value / 1_000_000_000_000, 2)}T`;
  if (abs >= 1_000_000_000) return `${round(value / 1_000_000_000, 2)}B`;
  if (abs >= 1_000_000) return `${round(value / 1_000_000, 2)}M`;
  return String(round(value, 2));
}

function trimSentence(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}...`;
}

function yahooQuoteUrl(symbol) {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}

function yahooProfileUrl(symbol) {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/profile`;
}

function yahooAnalysisUrl(symbol) {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/analysis`;
}

function yahooKeyStatsUrl(symbol) {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/key-statistics`;
}

function yahooChartUrl(symbol) {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/chart`;
}
