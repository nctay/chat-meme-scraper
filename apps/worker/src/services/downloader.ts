import crypto from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { assertSafeResolvedAddress, assertSafeUrl, maxBytesForMediaType, mediaTypeFromContentType, mediaTypeFromUrl, normalizeUrl, toUrl } from "@archive/core";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { storeMedia } from "./storage.js";

type DownloadResult = {
  filePath: string;
  sha256: string;
  byteSize: number;
  mimeType: string;
  mediaType: "image" | "video";
  finalUrl: string;
};

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
    if (existingByUrl?.status === "stored") {
      await prisma.chatPost.update({ where: { id: job.chatPostId }, data: { assetId: existingByUrl.id, status: "stored" } });
      await prisma.downloadJob.update({ where: { id: job.id }, data: { assetId: existingByUrl.id, status: "done" } });
      return;
    }

    await assertDailyLimitAvailable();
    const downloaded = await downloadMedia(job.url);

    try {
      const blockedByHash = await prisma.blockedMedia.findUnique({ where: { sha256: downloaded.sha256 } });
      if (blockedByHash) {
        await markBlocked(job.id, job.chatPostId, "SHA-256 is blocked");
        return;
      }

      const existingByHash = await prisma.asset.findUnique({ where: { sha256: downloaded.sha256 } });
      if (existingByHash?.status === "stored") {
        await prisma.chatPost.update({ where: { id: job.chatPostId }, data: { assetId: existingByHash.id, status: "stored" } });
        await prisma.downloadJob.update({ where: { id: job.id }, data: { assetId: existingByHash.id, status: "done" } });
        return;
      }

      const assetId = existingByUrl?.id ?? crypto.randomUUID();
      const stored = await storeMedia(downloaded.filePath, downloaded.mimeType, downloaded.mediaType, {
        originalUrl: job.url,
        normalizedUrl,
        sha256: downloaded.sha256,
        streamerLogin: job.chatPost.streamSession.streamer.login,
        streamSessionId: job.chatPost.streamSession.id,
        assetId,
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

      await prisma.chatPost.update({ where: { id: job.chatPostId }, data: { assetId: asset.id, status: "stored" } });
      await prisma.downloadJob.update({ where: { id: job.id }, data: { assetId: asset.id, status: "done" } });
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

async function downloadMedia(rawUrl: string): Promise<DownloadResult> {
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
