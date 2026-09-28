import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { env } from "../env.js";

const execFileAsync = promisify(execFile);
type NudityScores = { nude: number; nipples: number };
type Prediction = { className: string; probability: number };

export type NsfwResult = {
  publicSpoiler: boolean;
  falconsaiScore?: number;
  nudeScore?: number;
  nipplesScore?: number;
  nsfwjsClassName?: string;
  nsfwjsScore?: number;
  status: "disabled" | "ok" | "error";
};

export async function classifyNsfw(filePath: string, mediaType: "image" | "video", animated: boolean): Promise<NsfwResult> {
  if (!env.FALCONSAI_CLASSIFIER_URL) return { publicSpoiler: false, status: "disabled" };

  const frameDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "archive-nsfw-"));
  try {
    const maxFrames = framesToCheck(mediaType, animated);
    const frames = await extractFrames(filePath, path.join(frameDir, "falconsai"), maxFrames, false);
    let highest = 0;
    for (const frame of frames) {
      const response = await fetch(env.FALCONSAI_CLASSIFIER_URL, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: await fs.promises.readFile(frame),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Falconsai classifier returned ${response.status}`);
      const body = (await response.json()) as { nsfw?: unknown };
      if (typeof body.nsfw !== "number" || !Number.isFinite(body.nsfw) || body.nsfw < 0 || body.nsfw > 1) {
        throw new Error("Falconsai classifier returned an invalid score");
      }
      highest = Math.max(highest, body.nsfw);
    }
    return { publicSpoiler: shouldSpoilerFalconsai(highest), falconsaiScore: highest, status: "ok" };
  } catch (error) {
    console.error(`[nsfw] Falconsai classification failed; enabling public spoiler error=${error instanceof Error ? error.message : String(error)}`);
    return { publicSpoiler: true, status: "error" };
  } finally {
    await fs.promises.rm(frameDir, { force: true, recursive: true }).catch(() => undefined);
  }
}

export function framesToCheck(mediaType: "image" | "video", animated: boolean): number {
  return mediaType === "video" || animated ? env.NSFW_MAX_FRAMES : 1;
}

export function shouldSpoilerFalconsai(score: number): boolean {
  return score >= env.FALCONSAI_SPOILER_THRESHOLD;
}

// Retained for comparison; production calls classifyNsfw only.
export async function classifyLegacyNsfw(filePath: string, mediaType: "image" | "video", animated: boolean): Promise<NsfwResult> {
  if (mediaType === "video" || !env.NSFW_CLASSIFIER_URL) return { publicSpoiler: false, status: "disabled" };

  const frameDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "archive-nsfw-"));
  try {
    const maxFrames = animated ? env.NSFW_MAX_FRAMES : 1;
    const frames = await extractFrames(filePath, path.join(frameDir, "wd"), maxFrames, false);
    let highest: NudityScores = { nude: 0, nipples: 0 };

    for (const frame of frames) {
      const response = await fetch(env.NSFW_CLASSIFIER_URL, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: await fs.promises.readFile(frame),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`classifier returned ${response.status}`);

      const body = (await response.json()) as unknown;
      if (!validNudityScores(body)) throw new Error("classifier returned invalid nudity scores");
      highest = { nude: Math.max(highest.nude, body.nude), nipples: Math.max(highest.nipples, body.nipples) };
    }

    const nsfwjsFrames = await extractFrames(filePath, path.join(frameDir, "nsfwjs"), maxFrames, true);
    let highestHard: Prediction | undefined;
    for (const frame of nsfwjsFrames) {
      const response = await fetch(env.NSFWJS_CLASSIFIER_URL, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: await fs.promises.readFile(frame),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`NSFWJS classifier returned ${response.status}`);

      const body = (await response.json()) as { prediction?: unknown };
      if (!Array.isArray(body.prediction)) throw new Error("NSFWJS classifier returned invalid predictions");
      const candidate = highestHardNsfwPrediction(body.prediction);
      if (!candidate) throw new Error("NSFWJS classifier returned no Porn or Hentai score");
      if (!highestHard || candidate.probability > highestHard.probability) highestHard = candidate;
    }

    return {
      publicSpoiler: shouldSpoiler(highest, highestHard?.probability ?? 0),
      nudeScore: highest.nude,
      nipplesScore: highest.nipples,
      nsfwjsClassName: highestHard?.className,
      nsfwjsScore: highestHard?.probability,
      status: "ok",
    };
  } catch (error) {
    console.error(`[nsfw] classification failed; enabling public spoiler error=${error instanceof Error ? error.message : String(error)}`);
    return { publicSpoiler: true, status: "error" };
  } finally {
    await fs.promises.rm(frameDir, { force: true, recursive: true }).catch(() => undefined);
  }
}

export function shouldSpoiler(scores: NudityScores, nsfwjsScore: number): boolean {
  return scores.nude >= env.NSFW_NUDE_THRESHOLD || scores.nipples >= env.NSFW_NIPPLES_THRESHOLD || nsfwjsScore >= env.NSFWJS_SPOILER_THRESHOLD;
}

export function highestHardNsfwPrediction(predictions: unknown[]): Prediction | undefined {
  return predictions
    .filter(validPrediction)
    .filter((prediction) => prediction.className === "Porn" || prediction.className === "Hentai")
    .reduce<Prediction | undefined>((highest, prediction) => (!highest || prediction.probability > highest.probability ? prediction : highest), undefined);
}

async function extractFrames(filePath: string, outputDir: string, maxFrames: number, nsfwjs: boolean): Promise<string[]> {
  await fs.promises.mkdir(outputDir);
  const duration = maxFrames > 1 ? await readDuration(filePath) : 0;
  const filters = frameFilters(maxFrames, duration, nsfwjs);
  const output = path.join(outputDir, "frame-%02d.jpg");
  await execFileAsync("ffmpeg", ["-v", "error", "-i", filePath, "-vf", filters.join(",") || "null", "-frames:v", String(maxFrames), "-q:v", nsfwjs ? "4" : "1", output], { timeout: 30_000 });
  const frames = (await fs.promises.readdir(outputDir)).filter((name) => name.endsWith(".jpg")).sort().map((name) => path.join(outputDir, name));
  if (frames.length === 0) throw new Error("ffmpeg extracted no frames");
  return frames;
}

export function frameFilters(maxFrames: number, duration: number, nsfwjs: boolean): string[] {
  return [
    ...(maxFrames > 1 ? [`fps=${duration > 0 ? maxFrames / duration : 1}`] : []),
    ...(nsfwjs ? ["scale=224:224:force_original_aspect_ratio=decrease", ...(maxFrames === 1 ? ["pad=224:224:(ow-iw)/2:(oh-ih)/2"] : [])] : []),
  ];
}

async function readDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath], { timeout: 10_000 });
    const duration = Number(stdout.trim());
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch {
    return 0;
  }
}

function validNudityScores(value: unknown): value is NudityScores {
  if (!value || typeof value !== "object") return false;
  const scores = value as Partial<NudityScores>;
  return (
    typeof scores.nude === "number" && Number.isFinite(scores.nude) && scores.nude >= 0 && scores.nude <= 1 &&
    typeof scores.nipples === "number" && Number.isFinite(scores.nipples) && scores.nipples >= 0 && scores.nipples <= 1
  );
}

function validPrediction(value: unknown): value is Prediction {
  if (!value || typeof value !== "object") return false;
  const prediction = value as Partial<Prediction>;
  return (
    typeof prediction.className === "string" &&
    typeof prediction.probability === "number" &&
    Number.isFinite(prediction.probability) &&
    prediction.probability >= 0 &&
    prediction.probability <= 1
  );
}
