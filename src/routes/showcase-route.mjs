import { AppError, toPublicError } from "../utils/errors.mjs";
import { sendJson } from "../utils/http.mjs";
import { createRateLimiter, getRateLimitSettings } from "../utils/rate-limit.mjs";
import { sanitizeTicker } from "../utils/sanitize.mjs";
import { buildShowcaseSnapshot } from "../services/showcase-snapshot-service.mjs";

const rateLimitSettings = getRateLimitSettings();
const showcaseRateLimiter = createRateLimiter({
  name: "showcase-snapshot",
  windowMs: rateLimitSettings.debateWindowMs,
  max: rateLimitSettings.debateMax
});

export async function handleShowcaseSnapshot(request, response, url) {
  try {
    showcaseRateLimiter.consume(request);
    const ticker = sanitizeTicker(url.searchParams.get("ticker"));
    if (!ticker) {
      throw new AppError("invalid_ticker", "Enter a ticker before starting showcase.", 400);
    }

    const payload = await buildShowcaseSnapshot({ ticker });
    sendJson(response, 200, payload);
  } catch (error) {
    const statusCode = error instanceof AppError ? error.statusCode : 500;
    sendJson(response, statusCode, { error: toPublicError(error) });
  }
}
