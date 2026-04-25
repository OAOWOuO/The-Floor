export function sanitizeTicker(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.:-]/g, "")
    .slice(0, 24);
}

export function sanitizeText(value, maxLength = 500) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function isStaticRequest(url) {
  return url.searchParams.get("static") === "1";
}

