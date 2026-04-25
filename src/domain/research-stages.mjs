export const researchStageDefinitions = [
  ["resolving_ticker", "Resolving ticker"],
  ["fetching_market_data", "Fetching market data"],
  ["fetching_company_profile", "Fetching company profile and key statistics"],
  ["fetching_disclosures", "Fetching filings / recent disclosures"],
  ["building_research_packet", "Reading and extracting evidence"],
  ["assigning_analyst_priors", "Assigning analyst priors"],
  ["ready_to_debate", "Starting debate"]
];

export function buildStageState(status = "pending") {
  const timestamp = new Date().toISOString();
  return researchStageDefinitions.map(([stage, label]) => ({
    stage,
    label,
    status,
    timestamp
  }));
}

export function makeStage(stage, status, extra = {}) {
  const found = researchStageDefinitions.find(([key]) => key === stage);
  return {
    stage,
    label: found?.[1] || stage,
    status,
    timestamp: new Date().toISOString(),
    ...extra
  };
}
