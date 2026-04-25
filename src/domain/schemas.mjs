import { z } from "zod";
import { agentIds } from "./agents.mjs";

export const AgentIdSchema = z.enum(agentIds);

export const EvidenceItemSchema = z.object({
  evidenceId: z.string().min(1),
  sourceType: z.string().min(1),
  sourceLabel: z.string().min(1),
  sourceUrl: z.string().url().optional().nullable(),
  timestamp: z.string().optional().nullable(),
  claim: z.string().min(1),
  importance: z.number().min(0).max(10),
  analystRelevance: z.array(AgentIdSchema).default([])
});

export const ResearchPacketSchema = z.object({
  resolvedTicker: z.string().min(1),
  displayName: z.string().min(1),
  exchange: z.string().optional().nullable(),
  currency: z.string().optional().nullable(),
  marketState: z.string().optional().nullable(),
  latestPrice: z.number().optional().nullable(),
  priceChange: z.number().optional().nullable(),
  marketCap: z.number().optional().nullable(),
  sector: z.string().optional().nullable(),
  industry: z.string().optional().nullable(),
  businessSummary: z.string().optional().nullable(),
  keyStats: z.record(z.string(), z.unknown()).default({}),
  recentPriceContext: z.object({
    rangeStart: z.string().optional().nullable(),
    rangeEnd: z.string().optional().nullable(),
    periodReturnPct: z.number().optional().nullable(),
    high: z.number().optional().nullable(),
    low: z.number().optional().nullable(),
    observations: z.array(z.string()).default([])
  }).default({ observations: [] }),
  filingOrDisclosureSummary: z.object({
    available: z.boolean(),
    summary: z.string(),
    recentFilings: z.array(z.object({
      form: z.string().optional().nullable(),
      filingDate: z.string().optional().nullable(),
      reportDate: z.string().optional().nullable(),
      accessionNumber: z.string().optional().nullable(),
      url: z.string().optional().nullable()
    })).default([])
  }),
  evidenceItems: z.array(EvidenceItemSchema).default([]),
  researchWarnings: z.array(z.string()).default([]),
  likelyMatches: z.array(z.object({
    symbol: z.string(),
    name: z.string().optional().nullable(),
    exchange: z.string().optional().nullable(),
    quoteType: z.string().optional().nullable()
  })).default([]),
  dataCoverageScore: z.number().min(0).max(100),
  readyForDebate: z.boolean()
});

const EvidenceCitationArraySchema = z.array(z.string()).default([]);

export const AnalystPriorsSchema = z.object({
  marcus: z.string().min(1),
  yara: z.string().min(1),
  kenji: z.string().min(1),
  sofia: z.string().min(1),
  skeptic: z.string().min(1)
});

export const ConvictionScoresSchema = z.object({
  marcus: z.number().min(-100).max(100),
  yara: z.number().min(-100).max(100),
  kenji: z.number().min(-100).max(100),
  sofia: z.number().min(-100).max(100),
  skeptic: z.number().min(-100).max(100)
});

export const ResearchSynthesisSchema = z.object({
  company_snapshot: z.string().min(1),
  bull_thesis: z.object({
    summary: z.string().min(1),
    evidenceIds: EvidenceCitationArraySchema
  }),
  bear_thesis: z.object({
    summary: z.string().min(1),
    evidenceIds: EvidenceCitationArraySchema
  }),
  quant_flags: z.array(z.object({
    flag: z.string().min(1),
    evidenceIds: EvidenceCitationArraySchema
  })).default([]),
  macro_flags: z.array(z.object({
    flag: z.string().min(1),
    evidenceIds: EvidenceCitationArraySchema
  })).default([]),
  skeptic_questions: z.array(z.string()).default([]),
  key_uncertainties: z.array(z.string()).default([]),
  analyst_priors: AnalystPriorsSchema,
  initial_conviction_scores: ConvictionScoresSchema,
  evidence_map: z.record(z.string(), z.string()).default({}),
  open_questions_for_debate: z.array(z.string()).default([]),
  disallowed_claims: z.array(z.string()).default([])
});

export const DebateTurnSchema = z.object({
  turnNumber: z.number().int().min(1),
  speakerId: AgentIdSchema,
  targetId: AgentIdSchema.optional().nullable(),
  speakingIntent: z.enum(["attack", "defend", "reframe", "quantify", "contextualize", "challenge_assumption"]),
  message: z.string().min(1),
  citedEvidenceIds: z.array(z.string()).default([]),
  convictionDeltaByAgent: z.record(z.string(), z.number()).default({}),
  rationaleTag: z.string().min(1),
  shouldTriggerSkepticWeighting: z.boolean().default(false)
});

export const DebatePlanSchema = z.object({
  turns: z.array(DebateTurnSchema).min(10).max(14)
});

export const ModeratorSummarySchema = z.object({
  top_live_disagreement: z.string().min(1),
  strongest_bull_point: z.string().min(1),
  strongest_bear_point: z.string().min(1),
  quant_view_added: z.string().min(1),
  macro_view_changed: z.string().min(1),
  unresolved_assumptions: z.array(z.string()).default([]),
  final_conviction_snapshot: ConvictionScoresSchema,
  not_financial_advice: z.string().min(1)
});

export const FollowUpPlanSchema = z.object({
  selectedAnalysts: z.array(AgentIdSchema).min(1).max(3),
  responses: z.array(z.object({
    speakerId: AgentIdSchema,
    message: z.string().min(1),
    citedEvidenceIds: z.array(z.string()).default([]),
    convictionDeltaByAgent: z.record(z.string(), z.number()).default({}),
    rationaleTag: z.string().min(1)
  })).min(1).max(3)
});

