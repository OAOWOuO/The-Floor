const sessions = new Map();

export function saveSession(session) {
  sessions.set(session.id, session);
  return session;
}

export function getSession(sessionId) {
  return sessions.get(String(sessionId || ""));
}

export function pruneSessions(maxAgeMs = 1000 * 60 * 60 * 4) {
  const cutoff = Date.now() - maxAgeMs;
  for (const [sessionId, session] of sessions.entries()) {
    if ((session.createdAtMs || 0) < cutoff) sessions.delete(sessionId);
  }
}

