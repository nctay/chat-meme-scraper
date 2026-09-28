import { describe, expect, it, vi } from "vitest";

vi.mock("../env.js", () => ({ env: { NSFW_CLASSIFIER_URL: "http://localhost/classify", NSFW_NUDE_THRESHOLD: 0.9, NSFW_NIPPLES_THRESHOLD: 0.9, NSFWJS_SPOILER_THRESHOLD: 0.9 } }));

import { classifyNsfw, frameFilters, highestHardNsfwPrediction, shouldSpoiler } from "./nsfw.js";

describe("NSFW score", () => {
  it("skips classification for videos entirely", async () => {
    expect(await classifyNsfw("/nonexistent/video.mp4", "video", true)).toEqual({ publicSpoiler: false, status: "disabled" });
  });

  it("does not add square padding to video frames", () => {
    expect(frameFilters(8, 24, true)).toEqual(["fps=0.3333333333333333", "scale=224:224:force_original_aspect_ratio=decrease"]);
    expect(frameFilters(1, 0, true)).toEqual(["scale=224:224:force_original_aspect_ratio=decrease", "pad=224:224:(ow-iw)/2:(oh-ih)/2"]);
  });

  it("spoilers images only at 0.9 or above on any detector", () => {
    expect(shouldSpoiler({ nude: 0.9, nipples: 0 }, 0)).toBe(true);
    expect(shouldSpoiler({ nude: 0, nipples: 0.9 }, 0)).toBe(true);
    expect(shouldSpoiler({ nude: 0, nipples: 0 }, 0.9)).toBe(true);
    expect(shouldSpoiler({ nude: 0.899, nipples: 0.899 }, 0.899)).toBe(false);
  });

  it("uses only the highest valid Porn or Hentai prediction", () => {
    expect(highestHardNsfwPrediction([
      { className: "Sexy", probability: 0.99 },
      { className: "Porn", probability: 0.4 },
      { className: "Hentai", probability: 0.713 },
      { className: "Hentai", probability: NaN },
    ])).toEqual({ className: "Hentai", probability: 0.713 });
  });
});
