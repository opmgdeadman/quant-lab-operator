export const AUTONOMOUS_REVENUE_ENGINE_VERSION = "autonomous-revenue-engine-v1";

export const FINANCIAL_INTELLIGENCE_CONTRACT = Object.freeze({
  version: "signal-radar-quant-financial-intelligence-v1",
  producer: "signal-radar",
  consumer: "quant-lab",
  ownership: {
    signal_radar: "sense_normalize_timestamp_deduplicate_preserve_route",
    quant_lab: "hypothesize_validate_reject_forward_test_portfolio_allocate",
  },
  required_fields: [
    "event_id",
    "source_name",
    "source_url",
    "evidence_ref",
    "financial_domain",
    "asset_or_market_tags",
    "event_class",
    "published_at",
    "observed_at",
    "novelty_score",
    "confidence",
    "routing_targets",
  ],
  routing_targets: ["quant_lab", "vv"],
  strategy_authority: false,
});

export const MARKET_UNIVERSE = Object.freeze([
  { domain: "equities_etfs", research_enabled: true, live_enabled: false, identity: "venue:symbol:interval" },
  { domain: "crypto", research_enabled: true, live_enabled: false, identity: "venue:base-quote:interval" },
  { domain: "fx", research_enabled: true, live_enabled: false, identity: "venue_or_reference:base-quote:interval" },
  { domain: "futures_commodities", research_enabled: true, live_enabled: false, identity: "venue:root-contract:expiry:interval" },
  { domain: "rates", research_enabled: true, live_enabled: false, identity: "issuer_or_reference:tenor:series" },
  { domain: "volatility", research_enabled: true, live_enabled: false, identity: "venue_or_index:underlying:tenor:measure" },
]);

export const HISTORICAL_SOURCE_REGISTRY = Object.freeze([
  { source_class: "official_exchange_market_data", priority: 1, paid_allowed: false },
  { source_class: "official_macro_and_rates", priority: 1, paid_allowed: false },
  { source_class: "regulatory_filings_and_disclosures", priority: 1, paid_allowed: false },
  { source_class: "official_futures_options_reference", priority: 1, paid_allowed: false },
  { source_class: "issuer_and_corporate_events", priority: 2, paid_allowed: false },
  { source_class: "academic_and_research_datasets", priority: 2, paid_allowed: false },
  { source_class: "public_onchain_and_crypto_reference", priority: 2, paid_allowed: false },
  { source_class: "licensed_vendor_data", priority: 3, paid_allowed: false, owner_approval_required: true },
]);

export const RESEARCH_LANES = Object.freeze([
  "discovery",
  "dataset_scouting",
  "hypothesis_generation",
  "adversarial_validation",
  "regime_analysis",
  "execution_research",
  "portfolio_research",
  "failure_synthesis",
]);

export const ECONOMIC_PROGRESS_CONTRACT = Object.freeze({
  classifications: ["increased", "neutral", "decreased"],
  counts_as_increased: [
    "better_opportunity_discovered",
    "bad_path_killed_with_reusable_evidence",
    "evidence_quality_improved",
    "opportunity_universe_expanded",
    "portfolio_quality_improved",
    "distance_to_live_review_reduced_without_weakened_gates",
  ],
  raw_engineering_activity_is_progress: false,
  raw_experiment_count_is_progress: false,
});

export const REVENUE_DEADLINES = Object.freeze([
  { id: "build_complete", due: "2026-08-28", target: "Radar financial intelligence + Quant multi-market foundation + M autonomy loop operational" },
  { id: "scale_proof", due: "2026-09-01", target: ">=6 market domains, >=10 source classes, >=100 bounded experiments launched or queued" },
  { id: "edge_funnel", due: "2026-09-08", target: "10-20 serious survivors after hostile historical validation" },
  { id: "discovery_proof", due: "2026-09-24", target: ">=3 independent candidates with positive untouched forward expectancy after realistic costs" },
  { id: "portfolio_proof", due: "2026-10-24", target: "At least one positive net paper portfolio with controlled drawdown" },
  { id: "revenue_gate", due: "2026-11-23", target: "Evidence strong enough for owner review of a tiny live-capital trial, or Quant is downgraded" },
]);

export function buildRevenueEngineStatus({ researchPortfolio = null, liveQualification = null } = {}) {
  const hypotheses = Array.isArray(researchPortfolio?.hypotheses) ? researchPortfolio.hypotheses : [];
  const stateCounts = hypotheses.reduce((acc, row) => {
    const state = String(row?.state || "unknown");
    acc[state] = (acc[state] || 0) + 1;
    return acc;
  }, {});
  const qualification = liveQualification?.qualification || liveQualification || null;
  const failedGateCount = Number(qualification?.failed_gate_count ?? 0);
  const passedGateCount = Number(qualification?.passed_gate_count ?? 0);
  const gateCount = Number(qualification?.gate_count ?? (failedGateCount + passedGateCount));
  return {
    version: AUTONOMOUS_REVENUE_ENGINE_VERSION,
    mission: "discover_validate_and_compound_trading_edge",
    operating_model: "aggressive_discovery_hostile_validation_conservative_capital",
    stage: "multi_market_foundation",
    paper_only: true,
    live_capital_enabled: false,
    financial_intelligence_contract: FINANCIAL_INTELLIGENCE_CONTRACT,
    market_universe: MARKET_UNIVERSE,
    market_domain_count: MARKET_UNIVERSE.length,
    historical_source_registry: HISTORICAL_SOURCE_REGISTRY,
    source_class_count: HISTORICAL_SOURCE_REGISTRY.length,
    research_lanes: RESEARCH_LANES,
    economic_progress_contract: ECONOMIC_PROGRESS_CONTRACT,
    deadlines: REVENUE_DEADLINES,
    scorecard: {
      hypotheses_total: Number(researchPortfolio?.hypothesis_count ?? hypotheses.length),
      hypotheses_rejected: Number(stateCounts.rejected || 0),
      hypotheses_testing: Number(stateCounts.testing || 0),
      hypotheses_qualified: Number(stateCounts.qualified || 0),
      live_review_eligible: Boolean(qualification?.eligible_for_owner_review),
      live_qualification_state: qualification?.state || "unknown",
      qualification_gates_passed: passedGateCount,
      qualification_gates_total: gateCount,
      qualification_blockers: Array.isArray(qualification?.blocker_codes) ? qualification.blocker_codes : [],
      money_made_usd: 0,
    },
  };
}
