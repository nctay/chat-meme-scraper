export type PlatformMetadata = {
  duration?: number;
  filesize?: number;
  filesize_approx?: number;
  formats?: Array<{
    ext?: string;
    vcodec?: string;
    acodec?: string;
    filesize?: number;
    filesize_approx?: number;
    protocol?: string;
  }>;
};

export function assertPlatformMetadataFits(metadata: PlatformMetadata, limitBytes: number, maxDurationSeconds: number): void {
  if (typeof metadata.duration === "number" && metadata.duration > maxDurationSeconds) {
    throw new Error(`Platform video is too long: ${metadata.duration}s > ${maxDurationSeconds}s`);
  }

  const knownSize = bestKnownPlatformSize(metadata);
  if (knownSize && knownSize > limitBytes) {
    throw new Error(`Platform video is too large before download: ${knownSize} > ${limitBytes}`);
  }
}

export function bestKnownPlatformSize(metadata: PlatformMetadata): number | null {
  const topLevel = [metadata.filesize, metadata.filesize_approx].filter(isPositiveNumber);
  if (topLevel.length > 0) return Math.max(...topLevel);

  const downloadableFormats =
    metadata.formats?.filter((format) => {
      const ext = format.ext?.toLowerCase();
      const protocol = format.protocol?.toLowerCase();
      const hasVideo = format.vcodec && format.vcodec !== "none";
      const maybeHttp = !protocol || protocol.startsWith("http") || protocol === "https";
      return hasVideo && maybeHttp && (!ext || ext === "mp4" || ext === "webm" || ext === "mov");
    }) ?? [];
  const sizes = downloadableFormats.flatMap((format) => [format.filesize, format.filesize_approx]).filter(isPositiveNumber);
  if (sizes.length === 0) return null;

  return Math.min(...sizes);
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
