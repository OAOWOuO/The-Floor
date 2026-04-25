export function timestamp(date = new Date()) {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export function isoTimestamp(date = new Date()) {
  return date.toISOString();
}

