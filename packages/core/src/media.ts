export type MediaType = "image" | "video" | "other";

export const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif"]);
export const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov"]);
export const ALLOWED_MEDIA_HOSTS = new Set([
  "media.discordapp.net",
  "cdn.discordapp.com",
  "images-ext-1.discordapp.net",
  "i.ibb.co",
  "ibb.co",
]);

export const DEFAULT_MAX_IMAGE_BYTES = 30 * 1024 * 1024;
export const DEFAULT_MAX_VIDEO_BYTES = 150 * 1024 * 1024;

const URL_PATTERN =
  /\b(?:(?:https?:\/\/|www\.)[^\s<>"'`]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"'`]*)?)/gi;
const TRAILING_PUNCTUATION = /[),.;:!?]+$/;

export function extractUrls(text: string): string[] {
  return [...(text.match(URL_PATTERN) ?? [])]
    .map((url) => url.replace(TRAILING_PUNCTUATION, ""))
    .filter(Boolean);
}

export function toUrl(rawUrl: string): URL | null {
  try {
    const withScheme = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    const url = new URL(withScheme);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

export function normalizeUrl(rawUrl: string): string | null {
  const url = toUrl(rawUrl);
  if (!url) return null;

  url.hash = "";
  url.hostname = url.hostname.toLowerCase();

  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }

  if (ALLOWED_MEDIA_HOSTS.has(url.hostname)) {
    const keep = new URLSearchParams();
    for (const key of ["format", "quality", "width", "height"]) {
      const value = url.searchParams.get(key);
      if (value) keep.set(key, value);
    }
    url.search = keep.toString();
  }

  return url.toString();
}

export function getExtension(urlOrPath: string): string | null {
  const path = urlOrPath.startsWith("/") ? urlOrPath : (toUrl(urlOrPath)?.pathname ?? urlOrPath);
  const match = path.toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  return match?.[1] ?? null;
}

export function mediaTypeFromUrl(rawUrl: string): MediaType {
  const url = toUrl(rawUrl);
  if (!url) return "other";
  const ext = getExtension(url.pathname);
  if (ext && IMAGE_EXTENSIONS.has(ext)) return "image";
  if (ext && VIDEO_EXTENSIONS.has(ext)) return "video";
  if (ALLOWED_MEDIA_HOSTS.has(url.hostname.toLowerCase())) return "image";
  return "other";
}

export function isSupportedMediaUrl(rawUrl: string): boolean {
  return mediaTypeFromUrl(rawUrl) !== "other";
}

export function mediaTypeFromContentType(contentType: string | null | undefined): MediaType {
  const clean = contentType?.split(";")[0]?.trim().toLowerCase();
  if (!clean) return "other";
  if (clean.startsWith("image/")) return "image";
  if (clean.startsWith("video/")) return "video";
  return "other";
}

export function maxBytesForMediaType(type: MediaType, imageLimit = DEFAULT_MAX_IMAGE_BYTES, videoLimit = DEFAULT_MAX_VIDEO_BYTES): number {
  if (type === "image") return imageLimit;
  if (type === "video") return videoLimit;
  return 0;
}
