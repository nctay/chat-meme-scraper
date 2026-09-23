import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { env } from "../env.js";

const execFileAsync = promisify(execFile);
const hardClasses = new Set(["Porn", "Hentai"]);

type Prediction = { className: string; probability: number };

export type NsfwResult = {
  publicSpoiler: boolean;
  className?: string;
  score?: number;
  status: "disabled" | "ok" | "error";
};

export async function classifyNsfw(filePath: string, animated: boolean): Promise<NsfwResult> {
  if (!env.NSFW_CLASSIFIER_URL) return { publicSpoiler: false, status: "disabled" };

  const frameDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "archive-nsfw-"));
  try {
    const frames = await extractFrames(filePath, frameDir, animated ? env.NSFW_MAX_FRAMES : 1);
    let highest: Prediction | undefined;

    for (const frame of frames) {
      const response = await fetch(env.NSFW_CLASSIFIER_URL, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: await fs.promises.readFile(frame),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`classifier returned ${response.status}`);

      const body = (await response.json()) as { prediction?: unknown };
      if (!Array.isArray(body.prediction)) throw new Error("classifier returned invalid predictions");
      const candidate = highestHardNsfwPrediction(body.prediction);
      if (!candidate) throw new Error("classifier returned no Porn or Hentai score");
      if (!highest || candidate.probability > highest.probability) highest = candidate;
    }

    const score = highest?.probability ?? 0;
    return {
      publicSpoiler: score >= env.NSFW_SPOILER_THRESHOLD,
      className: highest?.className,
      score,
      status: "ok",
    };
  } catch (error) {
    console.error(`[nsfw] classification failed; enabling public spoiler error=${error instanceof Error ? error.message : String(error)}`);
    return { publicSpoiler: true, status: "error" };
  } finally {
    await fs.promises.rm(frameDir, { force: true, recursive: true }).catch(() => undefined);
  }
}

export function highestHardNsfwPrediction(predictions: unknown[]): Prediction | undefined {
  return predictions
    .filter(validPrediction)
    .filter((prediction) => hardClasses.has(prediction.className))
    .reduce<Prediction | undefined>((highest, prediction) => (!highest || prediction.probability > highest.probability ? prediction : highest), undefined);
}

async function extractFrames(filePath: string, outputDir: string, maxFrames: number): Promise<string[]> {
  const duration = maxFrames > 1 ? await readDuration(filePath) : 0;
  const filters = [
    ...(maxFrames > 1 ? [`fps=${duration > 0 ? maxFrames / duration : 1}`] : []),
    "scale=224:224:force_original_aspect_ratio=decrease",
    "pad=224:224:(ow-iw)/2:(oh-ih)/2",
  ];
  const output = path.join(outputDir, "frame-%02d.jpg");
  await execFileAsync("ffmpeg", ["-v", "error", "-i", filePath, "-vf", filters.join(","), "-frames:v", String(maxFrames), "-q:v", "4", output], { timeout: 30_000 });
  const frames = (await fs.promises.readdir(outputDir)).filter((name) => name.endsWith(".jpg")).sort().map((name) => path.join(outputDir, name));
  if (frames.length === 0) throw new Error("ffmpeg extracted no frames");
  return frames;
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
