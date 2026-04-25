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
    skeptic: 3
  };

  if (direct) scores[direct] += 8;
  if (/data|number|proof|evidence|specific|table|數據|證據|哪一年|對標/i.test(body)) scores.kenji += 4;
  if (/cash|account|fraud|short|bear|quality|現金流|會計|空頭/i.test(body)) scores.yara += 4;
  if (/rate|macro|policy|fx|currency|cycle|總經|匯率|利率|政策/i.test(body)) scores.sofia += 4;
  if (/bull|growth|revision|upside|moat|成長|上修|樂觀/i.test(body)) scores.marcus += 4;
  if (/assumption|bias|logic|why|demand|consensus|skeptic|假設|邏輯|需求|共識/i.test(body)) scores.skeptic += 4;
  if (/same|repeat|not good|bad|generic|一樣|重複|不好|無聊|即時|沒辦法/i.test(body)) {
    scores.yara += 2.5;
    scores.kenji += 2.5;
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
  const selected = Array.isArray(json?.selectedAnalysts) && json.selectedAnalysts.length ? json.selectedAnalysts : selectedAnalysts;

  return {
    selectedAnalysts: selected.slice(0, 3),
    responses: responses.length
      ? responses.map((response, index) => ({
          ...response,
          speakerId: selected[index] || response.speakerId || selectedAnalysts[index] || "kenji",
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
    const evidenceId = agentId === "kenji" ? e(3) : agentId === "yara" ? e(2) : agentId === "sofia" ? e(4) : e(1);
    const responseByAgent = {
      marcus: `@You the stronger bull version has to stay tied to ${packet.resolvedTicker}'s actual evidence: growth, margin, and profile data. If those stop improving, my conviction should come down.`,
      yara: `@You I agree the room has to get sharper. My follow-up would be cash conversion and disclosure quality first, because narrative without cash is just borrowed confidence.`,
      kenji: `@You yes, more analysts can join, but only if each adds a measurement. I would anchor this on the sourced metrics and ask what number would force an update.`,
      sofia: `@You I would add the cycle channel. Even if company evidence is decent, the market can reprice patience through rates, FX, liquidity, or customer budgets.`,
      skeptic: `@You the question I want answered is falsifiability. Which specific evidence item would make Marcus, Yara, Kenji, or Sofia admit their prior is wrong?`
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
  if (/@skeptic|the skeptic/.test(lowerBody)) return "skeptic";
  return null;
}

function evidenceLabels(packet, evidenceIds = []) {
  const byId = new Map(packet.evidenceItems.map((item) => [item.evidenceId, item]));
  return evidenceIds.map((id) => {
    const item = byId.get(id);
    return item ? `${id} · ${item.sourceLabel}` : id;
  });
}
