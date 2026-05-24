import crypto from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { assertSafeResolvedAddress, assertSafeUrl, getExtension, isPlatformMediaUrl, maxBytesForMediaType, mediaTypeFromContentType, mediaTypeFromUrl, normalizeUrl, toUrl } from "@archive/core";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { storeMedia } from "./storage.js";
import { assertPlatformMetadataFits, type PlatformMetadata } from "./platform-download.js";

type DownloadResult = {
  filePath: string;
  sha256: string;
  byteSize: number;
  mimeType: string;
  mediaType: "image" | "video";
  finalUrl: string;
};

const shaLocks = new Map<string, Promise<void>>();

export async function processDownloadQueue(): Promise<void> {
  const slots = Math.max(1, env.MAX_PARALLEL_DOWNLOADS);
  await Promise.all(Array.from({ length: slots }, () => processOneJob()));
}

async function processOneJob(): Promise<void> {
  const job = await claimDownloadJob();
  if (!job) return;

  try {
    const normalizedUrl = normalizeUrl(job.url);
    if (!normalizedUrl) throw new Error("Invalid URL");

    const blockedByUrl = await prisma.blockedMedia.findUnique({ where: { normalizedUrl } });
    if (blockedByUrl) {
      await markBlocked(job.id, job.chatPostId, "URL is blocked");
      return;
    }

    const existingByUrl = await prisma.asset.findUnique({ where: { normalizedUrl } });
    const existingStoredAsset = existingByUrl?.status === "stored" ? existingByUrl : await findStoredAssetForNormalizedUrl(normalizedUrl);
    if (existingStoredAsset) {
      await markStoredReferences(existingStoredAsset.id, normalizedUrl, job.id, job.chatPostId, existingByUrl?.id ?? job.assetId);
      return;
    }

    await assertDailyLimitAvailable();
    const downloaded = await downloadMedia(job.url);

    try {
      await withShaLock(downloaded.sha256, async () => {
        const blockedByHash = await prisma.blockedMedia.findUnique({ where: { sha256: downloaded.sha256 } });
        if (blockedByHash) {
          await markBlocked(job.id, job.chatPostId, "SHA-256 is blocked");
          return;
        }

        const existingByHash = await prisma.asset.findUnique({ where: { sha256: downloaded.sha256 } });
        if (existingByHash?.status === "stored") {
          await markStoredReferences(existingByHash.id, normalizedUrl, job.id, job.chatPostId, existingByUrl?.id ?? job.assetId);
          return;
        }

        const assetId = existingByUrl?.id ?? crypto.randomUUID();
        const stored = await storeMedia(downloaded.filePath, downloaded.mimeType, downloaded.mediaType, {
          originalUrl: job.url,
          normalizedUrl,
          sha256: downloaded.sha256,
          streamerLogin: job.chatPost.streamSession.streamer.login,
          streamerDisplayName: job.chatPost.streamSession.streamer.displayName,
          streamStartedAt: job.chatPost.streamSession.startedAt,
          streamSessionId: job.chatPost.streamSession.id,
          assetId,
          authorName: job.chatPost.authorName,
          messageText: job.chatPost.messageText,
        });

        const asset = await prisma.asset.upsert({
          where: { normalizedUrl },
          create: {
            id: assetId,
            originalUrl: job.url,
            normalizedUrl,
            sha256: downloaded.sha256,
            storageProvider: stored.storageProvider,
            telegramChatId: stored.telegramChatId,
            telegramMessageId: stored.telegramMessageId,
            telegramFileId: stored.telegramFileId,
            telegramFileUniqueId: stored.telegramFileUniqueId,
            s3Key: stored.s3Key,
            publicUrl: stored.publicUrl,
            mimeType: downloaded.mimeType,
            byteSize: downloaded.byteSize,
            mediaType: downloaded.mediaType,
            status: "stored",
            visibility: "public",
          },
          update: {
            sha256: downloaded.sha256,
            storageProvider: stored.storageProvider,
            telegramChatId: stored.telegramChatId,
            telegramMessageId: stored.telegramMessageId,
            telegramFileId: stored.telegramFileId,
            telegramFileUniqueId: stored.telegramFileUniqueId,
            s3Key: stored.s3Key,
            publicUrl: stored.publicUrl,
            mimeType: downloaded.mimeType,
            byteSize: downloaded.byteSize,
            mediaType: downloaded.mediaType,
            status: "stored",
            visibility: "public",
          },
        });

        await markStoredReferences(asset.id, normalizedUrl, job.id, job.chatPostId);
      });
    } finally {
      fs.promises.rm(downloaded.filePath, { force: true }).catch(() => undefined);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const currentAttempts = job.attempts;
    const retry = currentAttempts < 3;
    await prisma.downloadJob.update({
      where: { id: job.id },
      data: {
        status: retry ? "pending" : "failed",
        lastError: message,
        nextRetryAt: retry ? new Date(Date.now() + 60_000 * currentAttempts) : null,
      },
    });
    if (!retry) {
      await prisma.chatPost.update({ where: { id: job.chatPostId }, data: { status: "failed" } });
    }
  }
}

async function claimDownloadJob() {
  const claimed = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "download_jobs"
    SET "status" = 'running',
        "attempts" = "attempts" + 1,
        "updatedAt" = NOW()
    WHERE "id" = (
      SELECT "id"
      FROM "download_jobs"
      WHERE "status" = 'pending'
        AND ("nextRetryAt" IS NULL OR "nextRetryAt" <= NOW())
        AND NOT EXISTS (
          SELECT 1
          FROM "download_jobs" AS running
          WHERE running."assetId" IS NOT DISTINCT FROM "download_jobs"."assetId"
            AND running."status" = 'running'
        )
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING "id"
  `;
  const id = claimed[0]?.id;
  if (!id) return null;
  return prisma.downloadJob.findUnique({
    where: { id },
    include: { chatPost: { include: { streamSession: { include: { streamer: true } } } } },
  });
}

async function markStoredReferences(assetId: string, normalizedUrl: string, jobId: string, chatPostId: string, staleAssetId?: string | null): Promise<void> {
  const duplicateAssetIds = [assetId, staleAssetId].filter((id): id is string => Boolean(id));

  await prisma.$transaction([
    prisma.chatPost.updateMany({
      where: {
        status: { in: ["pending", "failed"] },
        OR: [{ id: chatPostId }, { assetId: { in: duplicateAssetIds } }, { normalizedUrl }],
      },
      data: {
        assetId,
        status: "stored",
      },
    }),
    prisma.downloadJob.updateMany({
      where: {
        id: { not: jobId },
        assetId: { in: duplicateAssetIds },
        status: { in: ["pending", "failed"] },
      },
      data: {
        assetId,
        status: "done",
        nextRetryAt: null,
        lastError: null,
      },
    }),
    prisma.downloadJob.update({
      where: { id: jobId },
      data: {
        assetId,
        status: "done",
        nextRetryAt: null,
        lastError: null,
      },
    }),
  ]);
}

async function findStoredAssetForNormalizedUrl(normalizedUrl: string) {
  const post = await prisma.chatPost.findFirst({
    where: {
      normalizedUrl,
      status: "stored",
      asset: { status: "stored" },
    },
    orderBy: { postedAt: "asc" },
    include: { asset: true },
  });
  return post?.asset ?? null;
}

async function withShaLock<T>(sha256: string, task: () => Promise<T>): Promise<T> {
  const previous = shaLocks.get(sha256) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = previous.catch(() => undefined).then(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  shaLocks.set(sha256, current);
  await previous.catch(() => undefined);

  try {
    return await task();
  } finally {
    release();
    if (shaLocks.get(sha256) === current) shaLocks.delete(sha256);
  }
}

async function downloadMedia(rawUrl: string): Promise<DownloadResult> {
  if (isPlatformMediaUrl(rawUrl)) {
    return downloadPlatformVideo(rawUrl);
  }
  return downloadDirectMedia(rawUrl);
}

async function downloadDirectMedia(rawUrl: string): Promise<DownloadResult> {
  let url = toUrl(rawUrl);
  if (!url) throw new Error("Invalid media URL");

  for (let redirects = 0; redirects <= 4; redirects += 1) {
    await assertSafeNetworkTarget(url);
    const head = await fetch(url, { method: "HEAD", redirect: "manual" });
    if (isRedirect(head.status)) {
      url = redirectUrl(url, head);
      continue;
    }

    const urlMediaType = mediaTypeFromUrl(url.toString());
    const contentMediaType = mediaTypeFromContentType(head.headers.get("content-type"));
    const mediaType = contentMediaType !== "other" ? contentMediaType : urlMediaType;
    if (mediaType === "other") throw new Error("URL does not point to supported media");

    const limit = maxBytesForMediaType(mediaType, env.MAX_IMAGE_BYTES, env.MAX_VIDEO_BYTES);
    const contentLength = Number(head.headers.get("content-length") ?? "0");
    if (contentLength > limit) throw new Error(`Media is too large: ${contentLength} > ${limit}`);

    const get = await fetch(url, { redirect: "manual" });
    if (isRedirect(get.status)) {
      url = redirectUrl(url, get);
      continue;
    }
    if (!get.ok || !get.body) throw new Error(`GET failed with ${get.status}`);

    const mimeType = get.headers.get("content-type")?.split(";")[0]?.trim() || head.headers.get("content-type") || "application/octet-stream";
    const actualMediaType = mediaTypeFromContentType(mimeType);
    const finalMediaType = actualMediaType !== "other" ? actualMediaType : mediaType;
    if (finalMediaType !== "image" && finalMediaType !== "video") throw new Error(`Unsupported content type: ${mimeType}`);

    const tempPath = path.join(os.tmpdir(), `archive-media-${crypto.randomUUID()}`);
    const hash = crypto.createHash("sha256");
    let byteSize = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        byteSize += chunk.length;
        if (byteSize > limit) callback(new Error(`Media exceeded byte limit ${limit}`));
        else {
          hash.update(chunk);
          callback(null, chunk);
        }
      },
    });

    try {
      await pipeline(Readable.fromWeb(get.body as Parameters<typeof Readable.fromWeb>[0]), limiter, fs.createWriteStream(tempPath));
    } catch (error) {
      await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
    return {
      filePath: tempPath,
      sha256: hash.digest("hex"),
      byteSize,
      mimeType,
      mediaType: finalMediaType,
      finalUrl: url.toString(),
    };
  }

  throw new Error("Too many redirects");
}

async function downloadPlatformVideo(rawUrl: string): Promise<DownloadResult> {
  if (!env.ENABLE_PLATFORM_DOWNLOADS) throw new Error("Platform downloads are disabled");

  const url = toUrl(rawUrl);
  if (!url) throw new Error("Invalid platform URL");
  assertSafeUrl(url);

  const limit = env.MAX_VIDEO_BYTES;
  await assertPlatformVideoFits(url.toString(), limit);

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "archive-platform-"));
  const outputTemplate = path.join(tempDir, "%(id)s.%(ext)s");

  try {
    await runYtDlp([
      "--no-playlist",
      "--no-progress",
      "--restrict-filenames",
      "--max-filesize",
      String(limit),
      "--match-filter",
      `duration <= ${env.MAX_PLATFORM_VIDEO_SECONDS}`,
      "--format",
      "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best[ext=mp4]/best",
      "--merge-output-format",
      "mp4",
      "--output",
      outputTemplate,
      url.toString(),
    ]);

    const downloadedPath = await findDownloadedPlatformFile(tempDir);
    const ext = getExtension(downloadedPath) ?? "mp4";
    const finalPath = path.join(os.tmpdir(), `archive-platform-${crypto.randomUUID()}.${ext}`);
    await fs.promises.rename(downloadedPath, finalPath);

    const result = await inspectDownloadedFile(finalPath, "video");
    if (result.byteSize > limit) {
      await fs.promises.rm(finalPath, { force: true }).catch(() => undefined);
      throw new Error(`Platform video exceeded byte limit ${limit}`);
    }

    return {
      ...result,
      filePath: finalPath,
      mediaType: "video",
      finalUrl: url.toString(),
    };
  } finally {
    await fs.promises.rm(tempDir, { force: true, recursive: true }).catch(() => undefined);
  }
}

async function assertPlatformVideoFits(url: string, limit: number): Promise<void> {
  const metadata = JSON.parse(
    await runYtDlp([
      "--dump-json",
      "--skip-download",
      "--no-playlist",
      "--no-warnings",
      "--no-progress",
      url,
    ]),
  ) as PlatformMetadata;

  assertPlatformMetadataFits(metadata, limit, env.MAX_PLATFORM_VIDEO_SECONDS);
}

async function runYtDlp(args: string[]): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.PLATFORM_DOWNLOAD_TIMEOUT_MS);

  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn("yt-dlp", args, {
        stdio: ["ignore", "pipe", "pipe"],
        signal: controller.signal,
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      child.stdout.on("data", (chunk: Buffer) => {
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr.push(chunk);
      });
      child.on("error", reject);
      child.on("close", (code, signal) => {
        const message = Buffer.concat(stderr).toString("utf8").trim();
        if (code === 0) {
          resolve(Buffer.concat(stdout).toString("utf8"));
          return;
        }
        reject(new Error(`yt-dlp failed${signal ? ` (${signal})` : ""}: ${message || `exit code ${code}`}`));
      });
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`yt-dlp timed out after ${env.PLATFORM_DOWNLOAD_TIMEOUT_MS}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function findDownloadedPlatformFile(tempDir: string): Promise<string> {
  const entries = await fs.promises.readdir(tempDir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && !entry.name.endsWith(".part") && !entry.name.endsWith(".ytdl"))
      .map(async (entry) => {
        const filePath = path.join(tempDir, entry.name);
        const stat = await fs.promises.stat(filePath);
        return { filePath, size: stat.size };
      }),
  );
  const largest = files.sort((a, b) => b.size - a.size)[0];
  if (!largest) throw new Error("yt-dlp did not produce a media file");
  return largest.filePath;
}

async function inspectDownloadedFile(filePath: string, expectedMediaType: "image" | "video"): Promise<Omit<DownloadResult, "filePath" | "mediaType" | "finalUrl">> {
  const stat = await fs.promises.stat(filePath);
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk);
  }

  return {
    sha256: hash.digest("hex"),
    byteSize: stat.size,
    mimeType: mimeTypeFromPath(filePath, expectedMediaType),
  };
}

function mimeTypeFromPath(filePath: string, expectedMediaType: "image" | "video"): string {
  const ext = getExtension(filePath);
  if (ext === "webm") return "video/webm";
  if (ext === "mov") return "video/quicktime";
  if (ext === "mp4" || expectedMediaType === "video") return "video/mp4";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

async function assertSafeNetworkTarget(url: URL): Promise<void> {
  assertSafeUrl(url);
  if (env.ALLOW_PRIVATE_MEDIA_HOSTS) return;
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  for (const address of addresses) assertSafeResolvedAddress(address.address);
}

function isRedirect(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

function redirectUrl(base: URL, response: Response): URL {
  const location = response.headers.get("location");
  if (!location) throw new Error("Redirect without location");
  return new URL(location, base);
}

async function assertDailyLimitAvailable(): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const aggregate = await prisma.asset.aggregate({
    where: { status: "stored", createdAt: { gte: today } },
    _sum: { byteSize: true },
  });
  const bytes = Number(aggregate._sum.byteSize ?? 0n);
  if (bytes >= env.MAX_DAILY_DOWNLOAD_BYTES) throw new Error("Daily download limit reached");
}

async function markBlocked(jobId: string, chatPostId: string, reason: string): Promise<void> {
  await prisma.$transaction([
    prisma.chatPost.update({ where: { id: chatPostId }, data: { status: "blocked" } }),
    prisma.downloadJob.update({ where: { id: jobId }, data: { status: "blocked", lastError: reason } }),
  ]);
}
