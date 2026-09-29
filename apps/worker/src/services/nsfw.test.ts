import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";

vi.mock("../env.js", () => ({ env: { NSFW_ENSEMBLE_CLASSIFIER_URL: "http://localhost/classify", NSFW_ENSEMBLE_THRESHOLD: 0.8, NSFW_MAX_FRAMES: 8, NSFW_CLASSIFIER_URL: "http://localhost/classify", NSFW_NUDE_THRESHOLD: 0.9, NSFW_NIPPLES_THRESHOLD: 0.9, NSFWJS_SPOILER_THRESHOLD: 0.9 } }));

import { classifyNsfw, frameFilters, framesToCheck, highestHardNsfwPrediction, shouldSpoiler, shouldSpoilerEnsemble } from "./nsfw.js";

describe("NSFW score", () => {
  it("uses OR at 0.8 on still images and samples videos and GIFs", () => {
    expect(framesToCheck("image", false)).toBe(1);
    expect(framesToCheck("image", true)).toBe(8);
    expect(framesToCheck("video", false)).toBe(8);
    expect(shouldSpoilerEnsemble(0.799, 0.799)).toBe(false);
    expect(shouldSpoilerEnsemble(0.8, 0.1)).toBe(true);
    expect(shouldSpoilerEnsemble(0.1, 0.8)).toBe(true);
  });

  it("classifies an extracted frame with both model scores", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "archive-nsfw-test-"));
    const image = path.join(directory, "tiny.png");
    await fs.writeFile(image, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAKklEQVR4nO3NQQ0AAAjEMEjwL5lggvt1AtbeyjbhPwAAAAAAAAAAAHjrAA+jAXywnK1EAAAAAElFTkSuQmCC", "base64"));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ owen: 0.81, siglip: 0.2 }) });
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(await classifyNsfw(image, "image", false)).toEqual({ publicSpoiler: true, owenScore: 0.81, siglipScore: 0.2, status: "ok" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      for (const [extension, mediaType, animated] of [["gif", "image", true], ["mp4", "video", false]] as const) {
        const media = path.join(directory, `tiny.${extension}`);
        await promisify(execFile)("ffmpeg", ["-v", "error", "-loop", "1", "-i", image, "-t", "1", "-vf", "fps=8", ...(extension === "mp4" ? ["-c:v", "mpeg4"] : []), media]);
        fetchMock.mockClear();
        expect(await classifyNsfw(media, mediaType, animated)).toEqual({ publicSpoiler: true, owenScore: 0.81, siglipScore: 0.2, status: "ok" });
        expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
      }
    } finally {
      vi.unstubAllGlobals();
      await fs.rm(directory, { recursive: true, force: true });
    }
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
