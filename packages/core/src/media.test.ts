import { describe, expect, it } from "vitest";
import { extractUrls, isSupportedMediaUrl, mediaTypeFromUrl, normalizeUrl } from "./media.js";
import { shouldStartNewSession } from "./stream-sessions.js";

describe("media helpers", () => {
  it("extracts common chat URLs", () => {
    expect(extractUrls("look https://cdn.discordapp.com/a/b/c.png, and www.example.com/x")).toEqual([
      "https://cdn.discordapp.com/a/b/c.png",
      "www.example.com/x",
    ]);
  });

  it("detects supported media URLs", () => {
    expect(isSupportedMediaUrl("https://media.discordapp.net/attachments/a/b/file")).toBe(true);
    expect(mediaTypeFromUrl("https://example.com/video.mp4")).toBe("video");
    expect(isSupportedMediaUrl("https://example.com/page")).toBe(false);
  });

  it("detects signed Discord CDN image URLs", () => {
    const url =
      "https://cdn.discordapp.com/attachments/1506760976450584768/1507052247148658852/image.png?ex=6a107f47&is=6a0f2dc7&hm=d010d91051a0ae08e179d86a13eca6e3aa35bd56b97db01cfe7a3c81f24dcd86&";

    expect(extractUrls(url)).toEqual([url]);
    expect(isSupportedMediaUrl(url)).toBe(true);
    expect(mediaTypeFromUrl(url)).toBe("image");
  });

  it("normalizes discord cache-busting query params", () => {
    expect(normalizeUrl("https://cdn.discordapp.com/a.png?ex=1&hm=2&width=800&height=600")).toBe(
      "https://cdn.discordapp.com/a.png?width=800&height=600",
    );
  });

  it("splits sessions after two minutes", () => {
    expect(shouldStartNewSession(new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:02:01Z"))).toBe(true);
  });
});
