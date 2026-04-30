export async function fetchDisclosureData(resolution, marketData) {
  if (process.env.THE_FLOOR_FIXTURE_MODE === "1") {
    return fixtureDisclosure();
  }

  const yahooFilings = normalizeYahooFilings(marketData?.summary?.secFilings?.filings || []);
  const sec = await fetchSecFilings(resolution).catch((error) => ({
    available: false,
    source: "SEC EDGAR",
    summary: "SEC EDGAR enrichment unavailable for this symbol.",
    recentFilings: [],
    companyFacts: null,
    warnings: [error.message]
  }));

  if (yahooFilings.length) {
    return {
      available: true,
      source: "Yahoo Finance secFilings",
      summary: `Found ${yahooFilings.length} recent disclosure item(s) from Yahoo Finance.`,
      recentFilings: yahooFilings,
      companyFacts: sec.companyFacts || null,
      warnings: sec.warnings || []
    };
  }

  return sec;
}

const secTimeoutMs = Number(process.env.SEC_TIMEOUT_MS || process.env.MARKET_DATA_TIMEOUT_MS || 7000);

function normalizeYahooFilings(filings) {
  return filings
    .filter((filing) => filing?.type || filing?.form)
    .map((filing) => ({
      form: filing.type || filing.form || null,
      filingDate: filing.date || filing.filingDate || null,
      reportDate: filing.epochDate ? new Date(Number(filing.epochDate) * 1000).toISOString().slice(0, 10) : null,
      accessionNumber: filing.accessionNumber || null,
      url: filing.edgarUrl || filing.url || null
    }))
    .slice(0, 5);
}

async function fetchSecFilings(resolution) {
  const symbol = String(resolution.resolvedTicker || "").toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  if (!symbol || /[.:]/.test(symbol)) {
    return {
      available: false,
      source: "SEC EDGAR",
      summary: "SEC enrichment was skipped because this symbol does not look like a US EDGAR ticker.",
      recentFilings: [],
      companyFacts: null,
      warnings: ["SEC data unavailable or not applicable."]
    };
  }

  const userAgent = process.env.SEC_USER_AGENT || "The Floor research app contact@example.com";
  const tickersResponse = await fetch("https://www.sec.gov/files/company_tickers.json", {
    headers: { "User-Agent": userAgent, Accept: "application/json" },
    signal: AbortSignal.timeout(secTimeoutMs)
  });

  if (!tickersResponse.ok) {
    throw new Error(`SEC ticker lookup failed (${tickersResponse.status}).`);
  }

  const companies = Object.values(await tickersResponse.json());
  const match = companies.find((company) => String(company.ticker || "").toUpperCase() === symbol);
  if (!match?.cik_str) {
    return {
      available: false,
      source: "SEC EDGAR",
      summary: "SEC ticker lookup did not find this symbol.",
      recentFilings: [],
      companyFacts: null,
      warnings: ["SEC CIK not found."]
    };
  }

  const cik = String(match.cik_str).padStart(10, "0");
  const [submissionsResponse, companyFacts] = await Promise.all([
    fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: { "User-Agent": userAgent, Accept: "application/json" },
      signal: AbortSignal.timeout(secTimeoutMs)
    }),
    fetchCompanyFacts(cik, userAgent)
  ]);

  if (!submissionsResponse.ok) {
    throw new Error(`SEC submissions lookup failed (${submissionsResponse.status}).`);
  }

  const submissions = await submissionsResponse.json();
  const recent = submissions?.filings?.recent || {};
  const recentFilings = (recent.form || [])
    .map((form, index) => ({
      form,
      filingDate: recent.filingDate?.[index] || null,
      reportDate: recent.reportDate?.[index] || null,
      accessionNumber: recent.accessionNumber?.[index] || null,
      url: recent.accessionNumber?.[index]
        ? `https://www.sec.gov/Archives/edgar/data/${Number(match.cik_str)}/${String(recent.accessionNumber[index]).replaceAll("-", "")}/`
        : null
    }))
    .filter((filing) => ["10-K", "10-Q", "8-K", "20-F", "6-K"].includes(filing.form))
    .slice(0, 5);

  return {
    available: recentFilings.length > 0,
    source: "SEC EDGAR",
    summary: recentFilings.length
      ? `Found ${recentFilings.length} recent SEC disclosure item(s).`
      : "SEC lookup succeeded, but no recent core filings were found.",
    recentFilings,
    companyFacts,
    warnings: recentFilings.length ? [] : ["No recent core SEC filings found."]
  };
}

async function fetchCompanyFacts(cik, userAgent) {
  const response = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
    headers: { "User-Agent": userAgent, Accept: "application/json" },
    signal: AbortSignal.timeout(secTimeoutMs)
  }).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  const facts = await response.json();
  const gaap = facts?.facts?.["us-gaap"] || {};
  const dei = facts?.facts?.dei || {};
  const revenue = latestAnnualFactFrom([
    gaap.Revenues,
    gaap.RevenueFromContractWithCustomerExcludingAssessedTax,
    gaap.SalesRevenueNet
  ]);
  const netIncome = latestAnnualFactFrom([gaap.NetIncomeLoss]);
  const grossProfit = latestAnnualFactFrom([gaap.GrossProfit]);
  const operatingIncome = latestAnnualFactFrom([gaap.OperatingIncomeLoss]);
  const operatingCashflow = latestAnnualFactFrom([gaap.NetCashProvidedByUsedInOperatingActivities]);
  const assets = latestInstantFactFrom([gaap.Assets]);
  const cashAndEquivalents = latestInstantFactFrom([
    gaap.CashAndCashEquivalentsAtCarryingValue,
    gaap.CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents
  ]);
  const sharesOutstanding = latestInstantFactFrom([dei.EntityCommonStockSharesOutstanding]);
  const currentDebt = latestInstantFactFrom([
    gaap.ShortTermBorrowings,
    gaap.ShortTermDebt,
    gaap.LongTermDebtAndFinanceLeaseObligationsCurrent,
    gaap.CurrentPortionOfLongTermDebt
  ]);
  const noncurrentDebt = latestInstantFactFrom([
    gaap.LongTermDebtAndFinanceLeaseObligationsNoncurrent,
    gaap.LongTermDebtNoncurrent,
    gaap.LongTermDebt
  ]);
  const totalDebt = sumFacts(currentDebt, noncurrentDebt);

  return {
    sourceLabel: "SEC EDGAR companyfacts",
    sourceUrl: `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
    fiscalYear: revenue?.fy || netIncome?.fy || operatingCashflow?.fy || null,
    fiscalPeriod: revenue?.fp || netIncome?.fp || operatingCashflow?.fp || null,
    periodEnd: revenue?.end || netIncome?.end || operatingCashflow?.end || null,
    form: revenue?.form || netIncome?.form || operatingCashflow?.form || null,
    revenue: revenue?.val ?? null,
    netIncome: netIncome?.val ?? null,
    grossProfit: grossProfit?.val ?? null,
    operatingIncome: operatingIncome?.val ?? null,
    operatingCashflow: operatingCashflow?.val ?? null,
    grossMargins: ratio(grossProfit?.val, revenue?.val),
    operatingMargins: ratio(operatingIncome?.val, revenue?.val),
    assets: assets?.val ?? null,
    cashAndEquivalents: cashAndEquivalents?.val ?? null,
    totalDebt,
    sharesOutstanding: sharesOutstanding?.val ?? null
  };
}

function latestFactFrom(concepts) {
  return concepts.flatMap((concept) => factRows(concept)).toSorted(sortFactRows)[0] || null;
}

function latestAnnualFactFrom(concepts) {
  const annual = concepts
    .flatMap((concept) => factRows(concept))
    .filter((row) => row.fp === "FY")
    .filter((row) => ["10-K", "20-F", "40-F"].includes(row.form))
    .filter((row) => hasAnnualDuration(row));
  return annual.toSorted(sortFactRows)[0] || latestFactFrom(concepts);
}

function latestInstantFactFrom(concepts) {
  const instant = concepts
    .flatMap((concept) => factRows(concept))
    .filter((row) => !row.start || row.start === row.end)
    .filter((row) => ["10-K", "10-Q", "20-F", "40-F"].includes(row.form));
  return instant.toSorted(sortFactRows)[0] || latestFactFrom(concepts);
}

function factRows(concept) {
  const rows = concept?.units?.USD || concept?.units?.shares || [];
  return rows.filter((row) => Number.isFinite(Number(row.val)));
}

function sortFactRows(a, b) {
  return `${b.filed || ""}:${b.end || ""}`.localeCompare(`${a.filed || ""}:${a.end || ""}`);
}

function hasAnnualDuration(row) {
  if (!row.start || !row.end) return true;
  const start = new Date(row.start);
  const end = new Date(row.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return true;
  const days = (end.getTime() - start.getTime()) / 86_400_000;
  return days >= 250 && days <= 380;
}

function ratio(numerator, denominator) {
  const top = Number(numerator);
  const bottom = Number(denominator);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom === 0) return null;
  return top / bottom;
}

function sumFacts(...facts) {
  const values = facts.map((fact) => Number(fact?.val)).filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

function fixtureDisclosure() {
  return {
    available: true,
    source: "SEC EDGAR fixture",
    summary: "Found recent 10-Q and 10-K disclosures in fixture mode.",
    recentFilings: [
      {
        form: "10-Q",
        filingDate: "2026-01-29",
        reportDate: "2025-12-31",
        accessionNumber: "0000000000-26-000001",
        url: "https://www.sec.gov/ixviewer/doc/action"
      },
      {
        form: "10-K",
        filingDate: "2025-07-30",
        reportDate: "2025-06-30",
        accessionNumber: "0000000000-25-000002",
        url: "https://www.sec.gov/ixviewer/doc/action"
      }
    ],
    companyFacts: {
      sourceLabel: "SEC EDGAR companyfacts fixture",
      sourceUrl: "https://data.sec.gov/api/xbrl/companyfacts/CIK0000000000.json",
      fiscalYear: 2025,
      fiscalPeriod: "FY",
      periodEnd: "2025-12-31",
      form: "10-K",
      revenue: 245000000000,
      netIncome: 88000000000,
      operatingCashflow: 118500000000,
      assets: 512000000000,
      cashAndEquivalents: 78000000000
    },
    warnings: []
  };
}
