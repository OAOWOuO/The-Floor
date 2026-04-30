import { sendJson } from "../utils/http.mjs";
import { getBuildInfo } from "../utils/build-info.mjs";
import { getRateLimitSettings } from "../utils/rate-limit.mjs";

export function handleHealth(_request, response) {
  const rateLimits = getRateLimitSettings();

  sendJson(response, 200, {
    ok: true,
    build: getBuildInfo(),
    capabilities: {
      showcaseReplay: true,
      showcaseLiveSnapshot: true,
      liveResearch: Boolean(process.env.OPENAI_API_KEY),
      acceptsBrowserApiKeys: false,
      selfHostRecommended: !process.env.OPENAI_API_KEY,
      limits: {
        maxFollowUpsPerSession: Number(process.env.MAX_FOLLOWUPS_PER_SESSION || 8),
        maxFollowUpBodyBytes: Number(process.env.MAX_FOLLOWUP_BODY_BYTES || 8_192),
        maxJsonBodyBytes: Number(process.env.MAX_JSON_BODY_BYTES || 16_384),
        debateWindowMs: rateLimits.debateWindowMs,
        debateMax: rateLimits.debateMax,
        followUpWindowMs: rateLimits.followUpWindowMs,
        followUpMax: rateLimits.followUpMax
      }
    }
  });
}
