import { describe, expect, it, vi } from "vitest";

vi.mock("../env.js", () => ({ env: { NSFW_NUDE_THRESHOLD: 0.6, NSFW_NIPPLES_THRESHOLD: 0.4, NSFWJS_SPOILER_THRESHOLD: 0.58 } }));

import { frameFilters, highestHardNsfwPrediction, shouldSpoiler } from "./nsfw.js";

describe("NSFW score", () => {
  it("does not add square padding to video frames", () => {
    expect(frameFilters(8, 24, true)).toEqual(["fps=0.3333333333333333", "scale=224:224:force_original_aspect_ratio=decrease"]);
    expect(frameFilters(1, 0, true)).toEqual(["scale=224:224:force_original_aspect_ratio=decrease", "pad=224:224:(ow-iw)/2:(oh-ih)/2"]);
  });

  it("spoilers at either nudity threshold, not below them", () => {
    expect(shouldSpoiler({ nude: 0.6, nipples: 0 }, 0)).toBe(true);
    expect(shouldSpoiler({ nude: 0, nipples: 0.4 }, 0)).toBe(true);
    expect(shouldSpoiler({ nude: 0.008, nipples: 0.007 }, 0.58)).toBe(true);
    expect(shouldSpoiler({ nude: 0.13, nipples: 0.001 }, 0.575)).toBe(false);
    expect(shouldSpoiler({ nude: 0.599, nipples: 0.399 }, 0.579)).toBe(false);
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
