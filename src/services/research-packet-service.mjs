import { ResearchPacketSchema } from "../domain/schemas.mjs";
import { round, toNumber } from "../utils/math.mjs";

export function buildResearchPacket({ resolution, marketData, disclosureData }) {
  const quote = marketData?.quote || {};
  const summary = marketData?.summary || {};
  const yahooProfile = firstObject(summary.assetProfile, summary.summaryProfile);
  const profile = firstObject(yahooProfile, marketData?.fallbackProfile) || {};
  const profileSourceLabel = yahooProfile ? "Yahoo Finance company profile" : "Nasdaq company profile";
  const price = summary.price || {};
  const fallbackQuote = marketData?.fallbackQuote || {};
  const chartMeta = marketData?.chart?.meta || {};
  const financialData = summary.financialData || {};
  const keyStatistics = summary.defaultKeyStatistics || {};
  const summaryDetail = summary.summaryDetail || {};
  const cnbcStats = marketData?.cnbcStats || {};
  const nasdaqFinancials = marketData?.nasdaqFinancials || {};
  const chartContext = buildRecentPriceContext(marketData?.chart);
  const secFacts = disclosureData?.companyFacts || {};
  const evidenceItems = [];
  const researchWarnings = [
    ...(resolution?.researchWarnings || []),
    ...(marketData?.warnings || []),
    ...(disclosureData?.warnings || [])
  ];
  let evidenceIndex = 1;

  const latestPrice = firstNumber(
    quote.regularMarketPrice,
    quote.postMarketPrice,
    quote.preMarketPrice,
    price.regularMarketPrice,
    summaryDetail.previousClose,
    fallbackQuote.regularMarketPrice,
    chartMeta.regularMarketPrice,
    chartMeta.previousClose
  );
  const priceChange = firstNumber(
    quote.regularMarketChange,
    price.regularMarketChange,
    fallbackQuote.regularMarketChange,
    chartMeta.regularMarketPrice && chartMeta.previousClose ? chartMeta.regularMarketPrice - chartMeta.previousClose : null
  );
  const secSharesOutstanding = firstNumber(secFacts.sharesOutstanding);
  const marketCap = firstNumber(
    quote.marketCap,
    price.marketCap,
    fallbackQuote.marketCap,
    latestPrice !== null && secSharesOutstanding !== null ? latestPrice * secSharesOutstanding : null
  );
  if (
    quote.marketCap == null &&
    price.marketCap == null &&
    fallbackQuote.marketCap == null &&
    marketCap !== null &&
    secSharesOutstanding !== null
  ) {
    researchWarnings.push("Market cap was derived from latest quote multiplied by SEC shares outstanding.");
  }
  const displayName =
    firstString(
      quote.longName,
      quote.shortName,
      fallbackQuote.longName,
      fallbackQuote.shortName,
      price.longName,
      price.shortName,
      resolution.displayName
    ) ||
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
    ["kenji", "marcus", "yara", "omar"],
    marketData?.quoteSourceUrl || yahooQuoteUrl(resolution.resolvedTicker)
  );

  if (businessSummary) {
    addEvidence(
      "company_profile",
      profileSourceLabel,
      `${displayName} operates in ${profile.sector || "an unspecified sector"} / ${profile.industry || "an unspecified industry"}: ${trimSentence(businessSummary, 360)}`,
      8,
      ["marcus", "yara", "sofia", "lucas", "mei"],
      yahooProfile ? yahooProfileUrl(resolution.resolvedTicker) : marketData?.quoteSourceUrl || yahooProfileUrl(resolution.resolvedTicker)
    );
  }

  const yahooRevenueGrowth = toNumber(financialData.revenueGrowth);
  const yahooGrossMargins = toNumber(financialData.grossMargins);
  const yahooOperatingMargins = toNumber(financialData.operatingMargins);
  const yahooFcf = firstNumber(financialData.freeCashflow, financialData.freeCashFlow);
  const cnbcGrossMargins = firstNumber(cnbcStats.grossMargins);
  const cnbcProfitMargin = firstNumber(cnbcStats.profitMargin);
  const cnbcReturnOnEquity = firstNumber(cnbcStats.returnOnEquity);
  const nasdaqRevenueGrowth = firstNumber(nasdaqFinancials.revenueGrowth);
  const nasdaqGrossMargins = firstNumber(nasdaqFinancials.grossMargins);
  const nasdaqOperatingMargins = firstNumber(nasdaqFinancials.operatingMargins);
  const nasdaqFcf = firstNumber(nasdaqFinancials.freeCashflow);
  const revenueGrowth = firstNumber(yahooRevenueGrowth, nasdaqRevenueGrowth);
  const grossMargins = firstNumber(yahooGrossMargins, nasdaqGrossMargins, cnbcGrossMargins, secFacts.grossMargins);
  const operatingMargins = firstNumber(yahooOperatingMargins, nasdaqOperatingMargins, secFacts.operatingMargins);
  const fcf = firstNumber(yahooFcf, nasdaqFcf);
  const opCash = firstNumber(
    financialData.operatingCashflow,
    financialData.operatingCashFlow,
    nasdaqFinancials.operatingCashflow,
    secFacts.operatingCashflow
  );
  const capex = firstNumber(nasdaqFinancials.capitalExpenditures);
  const totalDebt = firstNumber(financialData.totalDebt, nasdaqFinancials.totalDebt, secFacts.totalDebt);
  const cashAndEquivalents = firstNumber(nasdaqFinancials.cashAndEquivalents, secFacts.cashAndEquivalents);
  const stockholdersEquity = firstNumber(secFacts.stockholdersEquity);
  const secRevenue = firstNumber(secFacts.revenue);
  const secNetIncome = firstNumber(secFacts.netIncome);
  const secPeriodLabel = secFactPeriodLabel(secFacts);
  if ([revenueGrowth, grossMargins, operatingMargins, fcf, opCash, totalDebt, secRevenue, secNetIncome].some((value) => value !== null)) {
    const hasYahooFundamentals = [yahooRevenueGrowth, yahooGrossMargins, yahooOperatingMargins, yahooFcf].some(
      (value) => value !== null
    );
    const hasNasdaqFundamentals = [
      nasdaqRevenueGrowth,
      nasdaqGrossMargins,
      nasdaqOperatingMargins,
      nasdaqFcf,
      nasdaqFinancials.operatingCashflow,
      nasdaqFinancials.totalDebt
    ].some((value) => firstNumber(value) !== null);
    const hasCnbcFundamentals = [
      cnbcStats.revenueTtm,
      cnbcStats.ebitdaTtm,
      cnbcStats.grossMargins,
      cnbcStats.profitMargin
    ].some((value) => firstNumber(value) !== null);
    const fundamentalsSourceLabel = hasYahooFundamentals
      ? "Yahoo Finance financialData"
      : hasNasdaqFundamentals
        ? "Nasdaq annual financials"
        : hasCnbcFundamentals
          ? "CNBC quote statistics"
        : "SEC EDGAR companyfacts";
    addEvidence(
      "fundamentals",
      fundamentalsSourceLabel,
      [
        revenueGrowth !== null ? `revenue growth ${formatPct(revenueGrowth)}` : null,
        grossMargins !== null ? `gross margin ${formatPct(grossMargins)}` : null,
        operatingMargins !== null ? `operating margin ${formatPct(operatingMargins)}` : null,
        secRevenue !== null ? `latest SEC revenue ${formatLargeNumber(secRevenue)}${secPeriodLabel}` : null,
        secNetIncome !== null ? `latest SEC net income ${formatLargeNumber(secNetIncome)}${secPeriodLabel}` : null,
        fcf !== null ? `free cash flow ${formatLargeNumber(fcf)}` : null,
        opCash !== null ? `operating cash flow ${formatLargeNumber(opCash)}` : null,
        totalDebt !== null ? `total debt ${formatLargeNumber(totalDebt)}` : null
      ]
        .filter(Boolean)
        .join("; ") + ".",
      8,
      ["marcus", "yara", "kenji", "priya", "omar"],
      hasYahooFundamentals
        ? yahooAnalysisUrl(resolution.resolvedTicker)
        : hasNasdaqFundamentals
          ? nasdaqFinancials.sourceUrl
          : hasCnbcFundamentals
            ? cnbcStats.sourceUrl
          : secFacts.sourceUrl
    );
  }

  const trailingPe = firstNumber(keyStatistics.trailingPE, quote.trailingPE, cnbcStats.trailingPE);
  const forwardPe = firstNumber(keyStatistics.forwardPE, quote.forwardPE, cnbcStats.forwardPE);
  const beta = firstNumber(keyStatistics.beta, quote.beta, cnbcStats.beta);
  const ebitdaTtm = firstNumber(cnbcStats.ebitdaTtm);
  const derivedEvToEbitda =
    marketCap !== null && ebitdaTtm !== null && ebitdaTtm !== 0
      ? (marketCap + (totalDebt || 0) - (cashAndEquivalents || 0)) / ebitdaTtm
      : null;
  const evToEbitda = firstNumber(keyStatistics.enterpriseToEbitda, derivedEvToEbitda);
  const derivedPriceToBook =
    marketCap !== null && stockholdersEquity !== null && stockholdersEquity !== 0
      ? marketCap / stockholdersEquity
      : null;
  const priceToBook = firstNumber(keyStatistics.priceToBook, derivedPriceToBook);
  const priceToSales = firstNumber(cnbcStats.priceToSales);
  const hasYahooValuation = [keyStatistics.trailingPE, quote.trailingPE, keyStatistics.forwardPE, quote.forwardPE, keyStatistics.beta, quote.beta, keyStatistics.enterpriseToEbitda, keyStatistics.priceToBook].some(
    (value) => firstNumber(value) !== null
  );
  const hasCnbcValuation = [cnbcStats.trailingPE, cnbcStats.forwardPE, cnbcStats.beta, cnbcStats.priceToSales].some(
    (value) => firstNumber(value) !== null
  );
  const hasDerivedValuation = [derivedEvToEbitda, derivedPriceToBook].some((value) => value !== null);
  const valuationSourceLabel = hasYahooValuation
    ? "Yahoo Finance key statistics"
    : hasCnbcValuation
      ? "CNBC quote statistics"
      : hasDerivedValuation
        ? "Derived from market cap and filings"
        : null;
  if ([trailingPe, forwardPe, beta, evToEbitda, priceToBook, priceToSales].some((value) => value !== null)) {
    addEvidence(
      "key_statistics",
      valuationSourceLabel || "Valuation statistics",
      [
        trailingPe !== null ? `trailing P/E ${round(trailingPe, 1)}` : null,
        forwardPe !== null ? `forward P/E ${round(forwardPe, 1)}` : null,
        beta !== null ? `beta ${round(beta, 2)}` : null,
        evToEbitda !== null ? `EV/EBITDA ${round(evToEbitda, 1)}` : null,
        priceToBook !== null ? `price/book ${round(priceToBook, 1)}` : null,
        priceToSales !== null ? `price/sales ${round(priceToSales, 1)}` : null
      ]
        .filter(Boolean)
        .join("; ") + ".",
      7,
      ["yara", "kenji", "marcus", "priya", "omar"],
      hasYahooValuation
        ? yahooKeyStatsUrl(resolution.resolvedTicker)
        : hasCnbcValuation
          ? cnbcStats.sourceUrl
          : secFacts.sourceUrl || marketData?.quoteSourceUrl
    );
  }

  if (chartContext.observations.length) {
    addEvidence(
      "price_history",
      marketData?.chartSourceLabel || "Six-month price history",
      chartContext.observations.join(" "),
      6,
      ["kenji", "sofia", "omar"],
      marketData?.chartSourceUrl || yahooChartUrl(resolution.resolvedTicker)
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
      ["yara", "sofia", "skeptic", "priya", "lucas"],
      disclosureData.recentFilings?.[0]?.url || null
    );
  } else {
    researchWarnings.push(disclosureData?.summary || "Recent filing/disclosure enrichment unavailable.");
  }

  const keyStats = {
    fundamentalsSource:
      [yahooRevenueGrowth, yahooGrossMargins, yahooOperatingMargins, yahooFcf].some((value) => value !== null)
        ? "Yahoo Finance financialData"
        : [
              nasdaqRevenueGrowth,
              nasdaqGrossMargins,
              nasdaqOperatingMargins,
              nasdaqFcf,
              nasdaqFinancials.operatingCashflow,
              nasdaqFinancials.totalDebt
            ].some((value) => firstNumber(value) !== null)
          ? "Nasdaq annual financials"
          : [cnbcStats.revenueTtm, cnbcStats.ebitdaTtm, cnbcStats.grossMargins].some(
                (value) => firstNumber(value) !== null
              )
            ? "CNBC quote statistics"
            : "SEC EDGAR companyfacts",
    valuationSource: valuationSourceLabel,
    valuationUnavailableReason: valuationSourceLabel
      ? null
      : "Valuation statistics were unavailable from the active public providers in this run.",
    trailingPE: trailingPe,
    forwardPE: forwardPe,
    beta,
    enterpriseToEbitda: evToEbitda,
    priceToBook,
    priceToSales,
    forwardPriceToSales: firstNumber(cnbcStats.forwardPriceToSales),
    epsTtm: firstNumber(cnbcStats.epsTtm),
    forwardEps: firstNumber(cnbcStats.forwardEps),
    revenueTtm: firstNumber(cnbcStats.revenueTtm),
    forecastSales: firstNumber(cnbcStats.forecastSales),
    ebitdaTtm,
    dividendYield: firstNumber(summaryDetail.dividendYield, cnbcStats.dividendYield),
    dividendPerShare: firstNumber(cnbcStats.dividendPerShare),
    revenueGrowth,
    grossMargins,
    operatingMargins,
    profitMargin: firstNumber(cnbcProfitMargin, nasdaqFinancials.profitMargin),
    returnOnEquity: firstNumber(cnbcReturnOnEquity, nasdaqFinancials.afterTaxRoe),
    debtToEquity: firstNumber(cnbcStats.debtToEquity),
    freeCashflow: fcf,
    capitalExpenditures: capex,
    operatingCashflow: opCash,
    totalDebt,
    cashAndEquivalents,
    stockholdersEquity,
    currentRatio: firstNumber(nasdaqFinancials.currentRatio),
    quickRatio: firstNumber(nasdaqFinancials.quickRatio),
    cashRatio: firstNumber(nasdaqFinancials.cashRatio),
    nasdaqPeriodEnd: nasdaqFinancials.periodEnd || null,
    secRevenue,
    secNetIncome,
    secGrossProfit: firstNumber(secFacts.grossProfit),
    secOperatingIncome: firstNumber(secFacts.operatingIncome),
    secAssets: firstNumber(secFacts.assets),
    secStockholdersEquity: firstNumber(secFacts.stockholdersEquity),
    secCashAndEquivalents: firstNumber(secFacts.cashAndEquivalents),
    secGrossMargins: firstNumber(secFacts.grossMargins),
    secOperatingMargins: firstNumber(secFacts.operatingMargins),
    sharesOutstanding: firstNumber(secSharesOutstanding, cnbcStats.sharesOutstanding),
    secFiscalYear: secFacts.fiscalYear || null,
    secFiscalPeriod: secFacts.fiscalPeriod || null,
    secPeriodEnd: secFacts.periodEnd || null,
    secForm: secFacts.form || null
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
    exchange:
      quote.fullExchangeName ||
      quote.exchange ||
      fallbackQuote.fullExchangeName ||
      fallbackQuote.exchange ||
      price.exchangeName ||
      resolution.exchange ||
      null,
    currency: currency || null,
    marketState: marketState || null,
    dataTimestamp: marketData?.fetchedAt || null,
    quoteSourceLabel: marketData?.quoteSourceLabel || null,
    quoteSourceUrl: marketData?.quoteSourceUrl || null,
    snapshotPolicy: null,
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
    dataTimestamp: packet.dataTimestamp,
    quoteSourceLabel: packet.quoteSourceLabel,
    quoteSourceUrl: packet.quoteSourceUrl,
    snapshotPolicy: packet.snapshotPolicy,
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

function firstObject(...values) {
  for (const value of values) {
    if (value && typeof value === "object" && Object.keys(value).length) return value;
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

function secFactPeriodLabel(secFacts) {
  const parts = [
    secFacts?.fiscalYear ? `FY${secFacts.fiscalYear}` : null,
    secFacts?.fiscalPeriod || null,
    secFacts?.periodEnd ? `period ended ${secFacts.periodEnd}` : null
  ].filter(Boolean);
  return parts.length ? ` (${parts.join(" · ")})` : "";
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
