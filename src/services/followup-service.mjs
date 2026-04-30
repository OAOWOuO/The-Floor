import crypto from "node:crypto";
import { agents, getAgent } from "../domain/agents.mjs";
import { FollowUpPlanSchema } from "../domain/schemas.mjs";
import { timestamp } from "../utils/time.mjs";
import { sanitizeText } from "../utils/sanitize.mjs";
import { createJsonResponse, requireOpenAIClient } from "./openai-service.mjs";

export async function buildFollowUp({ session, message }) {
  const body = sanitizeText(message, 900);
  const selectedAnalysts = selectAnalysts(body, session.transcript || []);

  if (process.env.OPENAI_MOCK === "1") {
    return mockFollowUp(session, body, selectedAnalysts);
  }

  requireOpenAIClient();
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const json = await createJsonResponse({
    model,
    reasoningEffort: "low",
    maxOutputTokens: 1800,
    schema: FollowUpPlanSchema,
    schemaName: "followup_plan",
    instructions: [
      "You are The Floor follow-up orchestrator.",
      "Answer the user's follow-up by selecting 1 to 3 analyst personas.",
      "Responses must reuse the same research packet, synthesis, and transcript. Do not answer generically.",
      "Use distinct voices. Do not repeat earlier wording. Cite evidence IDs when possible.",
      "Never provide buy/sell/hold recommendations, target prices, or personalized financial advice.",
      "Return strict JSON only."
    ].join("\n"),
    input: [
      `Ticker: ${session.researchPacket.resolvedTicker}`,
      `User follow-up: ${body}`,
      `Preselected analysts: ${JSON.stringify(selectedAnalysts)}`,
      `Research packet: ${JSON.stringify(session.researchPacket)}`,
      `Synthesis: ${JSON.stringify(session.synthesis)}`,
      `Recent transcript: ${JSON.stringify((session.transcript || []).slice(-18).map((item) => ({ speaker: item.name, body: item.body, citedEvidenceIds: item.citedEvidenceIds })))}`,
      "Return JSON: {\"selectedAnalysts\":[\"kenji\"],\"responses\":[{\"speakerId\":\"kenji\",\"message\":\"...\",\"citedEvidenceIds\":[\"E01\"],\"convictionDeltaByAgent\":{\"kenji\":1},\"rationaleTag\":\"evidence clarified\"}]}"
    ].join("\n\n")
  });

  return FollowUpPlanSchema.parse(repairFollowUp(json, selectedAnalysts, session));
}

export function userFollowUpMessage(body) {
  return {
    id: crypto.randomUUID(),
    agentId: "user",
    name: "You",
    title: "Joined the floor",
    short: "YOU",
    color: "#50e3a4",
    timestamp: timestamp(),
    body,
    citations: [],
    citedEvidenceIds: []
  };
}

export function followUpResponseToMessage(response, researchPacket) {
  const agent = getAgent(response.speakerId);
  return {
    id: crypto.randomUUID(),
    agentId: agent.id,
    name: agent.name,
    title: agent.title,
    short: agent.short,
    color: agent.color,
    timestamp: timestamp(),
    body: response.message,
    citations: evidenceLabels(researchPacket, response.citedEvidenceIds),
    citedEvidenceIds: response.citedEvidenceIds,
    bid: {
      score: 8,
      reason: response.rationaleTag
    },
    speakingIntent: "follow_up",
    rationaleTag: response.rationaleTag,
    effects: response.convictionDeltaByAgent
  };
}

export function selectAnalysts(body, transcript = []) {
  const lower = body.toLowerCase();
  const direct = findMentionedAgent(lower);
  const lastAgent = transcript.filter((item) => agents[item.agentId]).at(-1)?.agentId;
  const asksOthers = /any\s?one else|anyone else|anybody else|someone else|who else|others?|jump in|talk more|chime|其他|還有|誰要|有人要/i.test(body);
  const scores = {
    marcus: 3.4,
    yara: 3.4,
    kenji: 3.4,
    sofia: 3,
    priya: 3.2,
    lucas: 3,
    mei: 3,
    omar: 3.1,
    skeptic: 3
  };

  if (direct && scores[direct] != null) scores[direct] += 8;
  if (/data|number|proof|evidence|specific|table|數據|證據|哪一年|對標/i.test(body)) scores.kenji += 4;
  if (/cash|account|fraud|short|bear|quality|accrual|revenue recognition|現金流|會計|空頭|收入認列/i.test(body)) {
    scores.yara += 3;
    scores.priya += 4;
  }
  if (/rate|macro|policy|fx|currency|cycle|總經|匯率|利率|政策/i.test(body)) scores.sofia += 4;
  if (/regulat|legal|lawsuit|antitrust|export|policy|litigation|法規|監管|訴訟|反壟斷|出口/i.test(body)) scores.lucas += 4;
  if (/supply|supplier|inventory|capacity|lead time|unit|供應鏈|庫存|產能|供應商/i.test(body)) scores.mei += 4;
  if (/credit|debt|liquidity|refinanc|balance sheet|spread|leverage|債務|流動性|槓桿|資產負債/i.test(body)) scores.omar += 4;
  if (/bull|growth|revision|upside|moat|成長|上修|樂觀/i.test(body)) scores.marcus += 4;
  if (/assumption|bias|logic|why|demand|consensus|skeptic|假設|邏輯|需求|共識/i.test(body)) scores.skeptic += 4;
  if (/same|repeat|not good|bad|generic|一樣|重複|不好|無聊|即時|沒辦法/i.test(body)) {
    scores.yara += 2.5;
    scores.kenji += 2.5;
    scores.priya += 2;
    scores.mei += 1.5;
    scores.skeptic -= 1.5;
  }
  if (asksOthers) {
    for (const agentId of Object.keys(scores)) scores[agentId] += 2;
    if (lastAgent) scores[lastAgent] -= 5;
  }

  const targetCount = direct && !asksOthers ? 1 : asksOthers ? 3 : /why|evidence|data|more|怎麼|為什麼|更多/i.test(body) ? 2 : 1;
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, targetCount)
    .map(([agentId]) => agentId);
}

function repairFollowUp(json, selectedAnalysts, session) {
  const evidenceId = session.researchPacket.evidenceItems[0]?.evidenceId || "E01";
  const responses = Array.isArray(json?.responses) ? json.responses.slice(0, 3) : [];
  const selectedSource = Array.isArray(json?.selectedAnalysts) && json.selectedAnalysts.length
    ? json.selectedAnalysts
    : selectedAnalysts;
  const selected = selectedSource.filter((agentId) => agents[agentId]).slice(0, 3);
  const fallbackSelected = selected.length ? selected : selectedAnalysts.filter((agentId) => agents[agentId]).slice(0, 3);

  return {
    selectedAnalysts: fallbackSelected,
    responses: responses.length
      ? responses.map((response, index) => ({
          ...response,
          speakerId: fallbackSelected[index] || (agents[response.speakerId] ? response.speakerId : null) || "kenji",
          citedEvidenceIds: response.citedEvidenceIds?.length ? response.citedEvidenceIds : [evidenceId],
          convictionDeltaByAgent: response.convictionDeltaByAgent || {},
          rationaleTag: response.rationaleTag || "follow-up evidence update"
        }))
      : mockFollowUp(session, "", selectedAnalysts).responses
  };
}

function mockFollowUp(session, body, selectedAnalysts) {
  const packet = session.researchPacket;
  const e = (index) => packet.evidenceItems[index]?.evidenceId || packet.evidenceItems[0]?.evidenceId || "E01";
  const responses = selectedAnalysts.map((agentId) => {
    const evidenceId = evidenceForAgent(agentId, e);
    const responseByAgent = {
      marcus: `@You the stronger bull version has to stay tied to ${packet.resolvedTicker}'s actual evidence: growth, margin, and profile data. If those stop improving, my conviction should come down.`,
      yara: `@You I agree the room has to get sharper. My follow-up would be cash conversion and disclosure quality first, because narrative without cash is just borrowed confidence.`,
      kenji: `@You yes, more analysts can join, but only if each adds a measurement. I would anchor this on the sourced metrics and ask what number would force an update.`,
      sofia: `@You I would add the cycle channel. Even if company evidence is decent, the market can reprice patience through rates, FX, liquidity, or customer budgets.`,
      priya: `@You I will take the accounting lane. For ${packet.resolvedTicker}, I would compare margin, operating cash flow, free cash flow, and disclosure support before trusting any clean narrative.`,
      lucas: `@You regulatory risk needs evidence too. I would separate filed or disclosed constraints from generic policy fear, then ask whether any constraint changes the thesis.`,
      mei: `@You from the supply-chain side, I want capacity, inventory, supplier, and lead-time evidence. If the packet lacks those, that limitation should stay visible.`,
      omar: `@You my lens is liquidity. If leverage, refinancing conditions, or cash generation look fragile, the equity story has less room for error.`,
      skeptic: `@You the question I want answered is falsifiability. Which specific evidence item would make each desk, including the specialists, admit their prior is wrong?`
    };
    return {
      speakerId: agentId,
      message: responseByAgent[agentId],
      citedEvidenceIds: [evidenceId],
      convictionDeltaByAgent: agentId === "yara" ? { yara: -2 } : agentId === "marcus" ? { marcus: 2 } : { [agentId]: 1 },
      rationaleTag: body ? "follow-up grounded in research packet" : "follow-up evidence update"
    };
  });

  return FollowUpPlanSchema.parse({ selectedAnalysts, responses });
}

function findMentionedAgent(lowerBody) {
  if (/@marcus|@bull/.test(lowerBody)) return "marcus";
  if (/@yara|@bear/.test(lowerBody)) return "yara";
  if (/@kenji|@quant/.test(lowerBody)) return "kenji";
  if (/@sofia|@macro/.test(lowerBody)) return "sofia";
  if (/@priya|@acct|accounting|forensic/.test(lowerBody)) return "priya";
  if (/@lucas|@reg|regulatory|legal/.test(lowerBody)) return "lucas";
  if (/@mei|@chain|supply/.test(lowerBody)) return "mei";
  if (/@omar|@crdt|credit/.test(lowerBody)) return "omar";
  if (/@skeptic|the skeptic/.test(lowerBody)) return "skeptic";
  return null;
}

function evidenceForAgent(agentId, e) {
  if (agentId === "kenji") return e(3);
  if (agentId === "yara" || agentId === "priya" || agentId === "omar") return e(2);
  if (agentId === "sofia" || agentId === "mei") return e(4);
  if (agentId === "lucas" || agentId === "skeptic") return e(5);
  return e(1);
}

function evidenceLabels(packet, evidenceIds = []) {
  const byId = new Map(packet.evidenceItems.map((item) => [item.evidenceId, item]));
  return evidenceIds.map((id) => {
    const item = byId.get(id);
    return item ? `${id} · ${item.sourceLabel}` : id;
  });
}
