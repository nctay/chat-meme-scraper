import { describe, expect, it, vi } from "vitest";

vi.mock("../env.js", () => ({ env: { NSFW_NUDE_THRESHOLD: 0.6, NSFW_NIPPLES_THRESHOLD: 0.4, NSFWJS_SPOILER_THRESHOLD: 0.4 } }));

import { highestHardNsfwPrediction, shouldSpoiler } from "./nsfw.js";

describe("NSFW score", () => {
  it("spoilers at either nudity threshold, not below them", () => {
    expect(shouldSpoiler({ nude: 0.6, nipples: 0 }, 0)).toBe(true);
    expect(shouldSpoiler({ nude: 0, nipples: 0.4 }, 0)).toBe(true);
    expect(shouldSpoiler({ nude: 0.008, nipples: 0.007 }, 0.4)).toBe(true);
    expect(shouldSpoiler({ nude: 0.599, nipples: 0.399 }, 0.399)).toBe(false);
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
