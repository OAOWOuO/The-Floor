import { AppError, toPublicError } from "../utils/errors.mjs";
import { readJson, sendJson } from "../utils/http.mjs";
import { sanitizeText } from "../utils/sanitize.mjs";
import { getSession } from "../services/session-store.mjs";
import {
  buildFollowUp,
  followUpResponseToMessage,
  userFollowUpMessage
} from "../services/followup-service.mjs";
import { applyConvictionDelta } from "../services/conviction-service.mjs";

export async function handleFollowUp(request, response) {
  try {
    const payload = await readJson(request, { maxBytes: Number(process.env.MAX_FOLLOWUP_BODY_BYTES || 8_192) });
    const session = getSession(payload.sessionId);
    const body = sanitizeText(payload.message, 900);
    const maxFollowUps = Number(process.env.MAX_FOLLOWUPS_PER_SESSION || 8);

    if (!session) throw new AppError("session_not_found", "This debate session is no longer available.", 404);
    if (!session.complete) throw new AppError("debate_not_complete", "Follow-up opens after the Moderator wrap.", 409);
    if (!session.researchPacket || !session.synthesis) {
      throw new AppError("missing_research_context", "Follow-up requires the original research packet.", 409);
    }
    if (!body) throw new AppError("empty_followup", "Enter a follow-up question.", 400);
    if (session.followUpCount >= maxFollowUps) {
      throw new AppError("followup_limit_reached", `This session is limited to ${maxFollowUps} follow-ups.`, 429);
    }

    const userMessage = userFollowUpMessage(body);
    session.transcript.push(userMessage);

    const plan = await buildFollowUp({ session, message: body });
    const messages = plan.responses.map((item) => followUpResponseToMessage(item, session.researchPacket));
    for (const message of messages) {
      session.transcript.push(message);
      applyConvictionDelta(session.convictionState, message.effects, message.rationaleTag);
    }
    session.followUpCount += 1;

    sendJson(response, 200, {
      userMessage,
      messages,
      conviction: session.convictionState.conviction,
      convictionHistory: session.convictionState.convictionHistory,
      followUpRemaining: Math.max(0, maxFollowUps - session.followUpCount)
    });
  } catch (error) {
    const statusCode = error instanceof AppError ? error.statusCode : 500;
    sendJson(response, statusCode, { error: toPublicError(error) });
  }
}
