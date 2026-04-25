export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function toNumber(value) {
  if (value && typeof value === "object" && "raw" in value) {
    return toNumber(value.raw);
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function round(value, digits = 2) {
  const number = toNumber(value);
  if (number === null) return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}
