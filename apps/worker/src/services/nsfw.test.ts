import { describe, expect, it, vi } from "vitest";

vi.mock("../env.js", () => ({ env: { NSFW_NUDE_THRESHOLD: 0.6, NSFW_NIPPLES_THRESHOLD: 0.7 } }));

import { shouldSpoiler } from "./nsfw.js";

describe("NSFW score", () => {
  it("spoilers at either nudity threshold, not below them", () => {
    expect(shouldSpoiler({ nude: 0.6, nipples: 0 })).toBe(true);
    expect(shouldSpoiler({ nude: 0, nipples: 0.7 })).toBe(true);
    expect(shouldSpoiler({ nude: 0.599, nipples: 0.699 })).toBe(false);
  });
});
