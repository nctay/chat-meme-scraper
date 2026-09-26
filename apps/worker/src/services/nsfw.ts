import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { env } from "../env.js";

const execFileAsync = promisify(execFile);
type NudityScores = { nude: number; nipples: number };

export type NsfwResult = {
  publicSpoiler: boolean;
  nudeScore?: number;
  nipplesScore?: number;
  status: "disabled" | "ok" | "error";
};

export async function classifyNsfw(filePath: string, animated: boolean): Promise<NsfwResult> {
  if (!env.NSFW_CLASSIFIER_URL) return { publicSpoiler: false, status: "disabled" };

  const frameDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "archive-nsfw-"));
  try {
    const frames = await extractFrames(filePath, frameDir, animated ? env.NSFW_MAX_FRAMES : 1);
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

    return {
      publicSpoiler: shouldSpoiler(highest),
      nudeScore: highest.nude,
      nipplesScore: highest.nipples,
      status: "ok",
    };
  } catch (error) {
    console.error(`[nsfw] classification failed; enabling public spoiler error=${error instanceof Error ? error.message : String(error)}`);
    return { publicSpoiler: true, status: "error" };
  } finally {
    await fs.promises.rm(frameDir, { force: true, recursive: true }).catch(() => undefined);
  }
}

export function shouldSpoiler(scores: NudityScores): boolean {
  return scores.nude >= env.NSFW_NUDE_THRESHOLD || scores.nipples >= env.NSFW_NIPPLES_THRESHOLD;
}

async function extractFrames(filePath: string, outputDir: string, maxFrames: number): Promise<string[]> {
  const duration = maxFrames > 1 ? await readDuration(filePath) : 0;
  const filter = maxFrames > 1 ? `fps=${duration > 0 ? maxFrames / duration : 1}` : "null";
  const output = path.join(outputDir, "frame-%02d.jpg");
  await execFileAsync("ffmpeg", ["-v", "error", "-i", filePath, "-vf", filter, "-frames:v", String(maxFrames), "-q:v", "1", output], { timeout: 30_000 });
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

function validNudityScores(value: unknown): value is NudityScores {
  if (!value || typeof value !== "object") return false;
  const scores = value as Partial<NudityScores>;
  return (
    typeof scores.nude === "number" && Number.isFinite(scores.nude) && scores.nude >= 0 && scores.nude <= 1 &&
    typeof scores.nipples === "number" && Number.isFinite(scores.nipples) && scores.nipples >= 0 && scores.nipples <= 1
  );
}
