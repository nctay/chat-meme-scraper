import { describe, expect, it } from "vitest";
import { assertPlatformMetadataFits, bestKnownPlatformSize } from "./platform-download.js";

describe("platform download metadata checks", () => {
  it("uses top-level filesize when yt-dlp provides it", () => {
    expect(bestKnownPlatformSize({ filesize: 12_000_000, formats: [{ filesize: 8_000_000, ext: "mp4", vcodec: "h264" }] })).toBe(12_000_000);
  });

  it("uses top-level approximate filesize when exact filesize is missing", () => {
    expect(bestKnownPlatformSize({ filesize_approx: 11_000_000 })).toBe(11_000_000);
  });

  it("uses the smallest known downloadable video format size", () => {
    expect(
      bestKnownPlatformSize({
        formats: [
          { ext: "mp4", vcodec: "h264", acodec: "none", filesize: 60_000_000, protocol: "https" },
          { ext: "mp4", vcodec: "h264", acodec: "aac", filesize_approx: 42_000_000, protocol: "https" },
          { ext: "m4a", vcodec: "none", acodec: "aac", filesize: 4_000_000, protocol: "https" },
        ],
      }),
    ).toBe(42_000_000);
  });

  it("ignores non-http and audio-only formats for pre-download size decisions", () => {
    expect(
      bestKnownPlatformSize({
        formats: [
          { ext: "mp4", vcodec: "h264", filesize: 70_000_000, protocol: "m3u8_native" },
          { ext: "m4a", vcodec: "none", acodec: "aac", filesize: 5_000_000, protocol: "https" },
        ],
      }),
    ).toBeNull();
  });

  it("rejects videos with known size above the configured limit", () => {
    expect(() => assertPlatformMetadataFits({ filesize: 55_000_000 }, 52_428_800, 120)).toThrow("too large");
  });

  it("rejects videos longer than the configured duration", () => {
    expect(() => assertPlatformMetadataFits({ duration: 180, filesize: 10_000_000 }, 52_428_800, 120)).toThrow("too long");
  });

  it("allows metadata with unknown size so runtime guards can decide after download", () => {
    expect(() => assertPlatformMetadataFits({ duration: 30 }, 52_428_800, 120)).not.toThrow();
  });
});
