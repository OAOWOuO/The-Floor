import { AppError } from "./errors.mjs";

export const rateLimitDefaults = {
  debateWindowMs: 10 * 60 * 1000,
  debateMax: 20,
  followUpWindowMs: 10 * 60 * 1000,
  followUpMax: 60
};

export function getRateLimitSettings(env = process.env) {
  return {
    debateWindowMs: numberFromEnv(env.RATE_LIMIT_DEBATE_WINDOW_MS, rateLimitDefaults.debateWindowMs),
    debateMax: numberFromEnv(env.RATE_LIMIT_DEBATE_MAX, rateLimitDefaults.debateMax),
    followUpWindowMs: numberFromEnv(env.RATE_LIMIT_FOLLOWUP_WINDOW_MS, rateLimitDefaults.followUpWindowMs),
    followUpMax: numberFromEnv(env.RATE_LIMIT_FOLLOWUP_MAX, rateLimitDefaults.followUpMax)
  };
}

export function createRateLimiter({ name, windowMs, max }) {
  const buckets = new Map();

  return {
    consume(request, options = {}) {
      if (max === 0) return { remaining: Infinity, resetAt: null };

      const now = Number(options.now ?? Date.now());
      const key = `${name}:${options.key || clientKey(request)}`;
      const current = buckets.get(key);
      const bucket = current && current.resetAt > now
        ? current
        : { count: 0, resetAt: now + windowMs };

      bucket.count += 1;
      buckets.set(key, bucket);
      pruneExpired(buckets, now);

      if (bucket.count > max) {
        const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
        throw new AppError(
          "rate_limited",
          `Too many ${name} requests. Try again in about ${retryAfterSeconds} seconds.`,
          429,
          { limit: max, windowMs, retryAfterSeconds }
        );
      }

      return { remaining: Math.max(0, max - bucket.count), resetAt: bucket.resetAt };
    },

    reset() {
      buckets.clear();
    }
  };
}

export function clientKey(request) {
  const headers = request?.headers || {};
  const forwarded = Array.isArray(headers["x-forwarded-for"])
    ? headers["x-forwarded-for"][0]
    : headers["x-forwarded-for"];
  const forwardedIp = forwarded?.split(",")[0]?.trim();
  const realIp = Array.isArray(headers["x-real-ip"]) ? headers["x-real-ip"][0] : headers["x-real-ip"];
  const cfIp = Array.isArray(headers["cf-connecting-ip"])
    ? headers["cf-connecting-ip"][0]
    : headers["cf-connecting-ip"];

  return forwardedIp || cfIp || realIp || request?.socket?.remoteAddress || "unknown";
}

function pruneExpired(buckets, now) {
  if (buckets.size < 1000) return;
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function numberFromEnv(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}
