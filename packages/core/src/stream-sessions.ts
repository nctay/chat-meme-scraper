export const STREAM_SESSION_GAP_MS = 2 * 60 * 1000;

export function shouldStartNewSession(lastSeenAt: Date | null, nextSeenAt: Date, gapMs = STREAM_SESSION_GAP_MS): boolean {
  if (!lastSeenAt) return true;
  return nextSeenAt.getTime() - lastSeenAt.getTime() > gapMs;
}
