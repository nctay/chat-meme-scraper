import { describe, expect, it, vi } from "vitest";

vi.mock("../env.js", () => ({ env: {} }));

import { highestHardNsfwPrediction } from "./nsfw.js";

describe("NSFW score", () => {
  it("uses the highest Porn or Hentai score and ignores Sexy", () => {
    expect(
      highestHardNsfwPrediction([
        { className: "Sexy", probability: 0.99 },
        { className: "Porn", probability: 0.42 },
        { className: "Hentai", probability: 0.73 },
      ]),
    ).toEqual({ className: "Hentai", probability: 0.73 });
  });
});
