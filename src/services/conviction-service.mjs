import { agentIds } from "../domain/agents.mjs";
import { clamp, round } from "../utils/math.mjs";

export function createConvictionState(initialScores) {
  const conviction = {};
  for (const agentId of agentIds) {
    conviction[agentId] = clamp(round(Number(initialScores?.[agentId] ?? 0), 0), -100, 100);
  }

  return {
    conviction,
    convictionHistory: Object.fromEntries(agentIds.map((agentId) => [agentId, [conviction[agentId]]])),
    lastReasonTag: null
  };
}

export function applyConvictionDelta(convictionState, deltaByAgent = {}, rationaleTag = "") {
  for (const agentId of agentIds) {
    const delta = Number(deltaByAgent[agentId] || 0);
    convictionState.conviction[agentId] = clamp(round(convictionState.conviction[agentId] + delta, 0), -100, 100);
  }

  for (const agentId of agentIds) {
    convictionState.convictionHistory[agentId].push(convictionState.conviction[agentId]);
  }

  convictionState.lastReasonTag = rationaleTag || null;
  return {
    conviction: convictionState.conviction,
    convictionHistory: convictionState.convictionHistory,
    rationaleTag: convictionState.lastReasonTag
  };
}

