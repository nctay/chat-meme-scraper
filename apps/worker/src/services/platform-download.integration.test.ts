import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { assertPlatformMetadataFits, bestKnownPlatformSize, type PlatformMetadata } from "./platform-download.js";

const platformUrl = process.env.PLATFORM_DOWNLOAD_TEST_URL;
const runIntegration = platformUrl ? describe : describe.skip;

runIntegration("platform download integration", () => {
  it(
    "checks real yt-dlp metadata against production-like limits",
    async () => {
      const metadata = JSON.parse(
        await runYtDlp([
          "--dump-json",
          "--skip-download",
          "--no-playlist",
          "--no-warnings",
          "--no-progress",
          platformUrl!,
        ]),
      ) as PlatformMetadata & { title?: string; extractor?: string };

      expect(metadata).toBeTruthy();
      expect(metadata.duration ?? 0).toBeLessThanOrEqual(Number(process.env.MAX_PLATFORM_VIDEO_SECONDS ?? 120));
      assertPlatformMetadataFits(metadata, Number(process.env.MAX_VIDEO_BYTES ?? 52_428_800), Number(process.env.MAX_PLATFORM_VIDEO_SECONDS ?? 120));

      console.log({
        extractor: metadata.extractor,
        title: metadata.title,
        duration: metadata.duration,
        bestKnownSize: bestKnownPlatformSize(metadata),
      });
    },
    120_000,
  );
});

async function runYtDlp(args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8"));
        return;
      }
      reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `yt-dlp exited with ${code}`));
    });
  });
}
