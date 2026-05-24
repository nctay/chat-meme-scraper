export const offlineGraceMs = 30 * 60 * 1000;

export function isWithinOfflineGrace(endedAt: Date | null, startedAt: Date): boolean {
  return Boolean(endedAt && startedAt.getTime() - endedAt.getTime() <= offlineGraceMs);
}
