import { AppError } from "./errors.mjs";

const defaultSecurityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'"
  ].join("; ")
};

export function securityHeaders(extra = {}) {
  return { ...defaultSecurityHeaders, ...extra };
}

export function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, securityHeaders({ "Content-Type": "application/json; charset=utf-8" }));
  response.end(JSON.stringify(payload));
}

export async function readJson(request, options = {}) {
  const maxBytes = Number(options.maxBytes || process.env.MAX_JSON_BODY_BYTES || 16_384);
  const contentType = request.headers["content-type"] || "";
  if (contentType && !contentType.includes("application/json")) {
    throw new AppError("unsupported_media_type", "Send JSON with Content-Type: application/json.", 415);
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      throw new AppError("payload_too_large", `Request body is limited to ${maxBytes} bytes.`, 413);
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError("invalid_json", "Request body must be valid JSON.", 400);
  }
}
