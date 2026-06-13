import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Bot, InputFile } from "grammy";
import type { Message } from "grammy/types";
import { env, privateStreamerLogins } from "../env.js";
import type { StoreMediaMetadata, StoredMedia } from "./storage.js";
import { SerialRateLimiter, withTelegramRetry } from "./rate-limit.js";

let bot: Bot | null = null;
const storageSendLimiter = new SerialRateLimiter(1100);
const publicChannelSendLimiter = new SerialRateLimiter(1100);
const deletedChannelSendLimiter = new SerialRateLimiter(1100);

function telegramBot(): Bot {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  bot ??= new Bot(env.TELEGRAM_BOT_TOKEN);
  return bot;
}

export async function storeTelegramMedia(filePath: string, mimeType: string, mediaType: "image" | "video", metadata: StoreMediaMetadata): Promise<StoredMedia> {
  if (!env.TELEGRAM_STORAGE_CHAT_ID) throw new Error("TELEGRAM_STORAGE_CHAT_ID is not configured");

  const caption = [
    `streamer=${metadata.streamerLogin}`,
    `session=${metadata.streamSessionId}`,
    `asset=${metadata.assetId}`,
    `sha256=${metadata.sha256}`,
    metadata.normalizedUrl,
  ].join("\n");

  const input = new InputFile(fs.createReadStream(filePath), fileName(filePath, mimeType, mediaType));
  const videoMetadata = mediaType === "video" ? await readVideoMetadata(filePath) : {};
  const message = await storageSendLimiter.schedule<Message.PhotoMessage | Message.VideoMessage | Message.AnimationMessage>(async () => {
    if (isGif(mimeType)) {
      console.log(`[telegram] sendAnimation mime=${mimeType} file=${path.basename(filePath)}`);
      return telegramBot().api.sendAnimation(env.TELEGRAM_STORAGE_CHAT_ID!, input, { caption });
    }
    if (mediaType === "image") {
      console.log(`[telegram] sendPhoto mime=${mimeType} file=${path.basename(filePath)}`);
      return telegramBot().api.sendPhoto(env.TELEGRAM_STORAGE_CHAT_ID!, input, { caption });
    }
    console.log(`[telegram] sendVideo mime=${mimeType} file=${path.basename(filePath)} width=${videoMetadata.width ?? "unknown"} height=${videoMetadata.height ?? "unknown"}`);
    return telegramBot().api.sendVideo(env.TELEGRAM_STORAGE_CHAT_ID!, input, { caption, supports_streaming: true, ...videoMetadata });
  });
  const file = "photo" in message ? message.photo.at(-1) : "video" in message ? message.video : message.animation;
  if (!file) throw new Error("Telegram did not return stored file metadata");

  await publishTelegramMedia(message.chat.id, message.message_id, metadata);

  return {
    storageProvider: "telegram",
    telegramChatId: String(message.chat.id),
    telegramMessageId: message.message_id,
    telegramFileId: file.file_id,
    telegramFileUniqueId: file.file_unique_id,
  };
}

export async function deleteTelegramMedia(asset: { telegramChatId: string | null; telegramMessageId: number | null }): Promise<void> {
  if (!asset.telegramChatId || !asset.telegramMessageId) return;
  await withTelegramRetry(() => telegramBot().api.deleteMessage(asset.telegramChatId!, asset.telegramMessageId!));
}

function fileName(filePath: string, mimeType: string, mediaType: "image" | "video"): string {
  const ext = mimeType.split("/")[1]?.split("+")[0] || (mediaType === "image" ? "jpg" : "mp4");
  return `${path.basename(filePath)}.${ext}`;
}

function isGif(mimeType: string): boolean {
  return mimeType.split(";")[0]?.trim().toLowerCase() === "image/gif";
}

async function readVideoMetadata(filePath: string): Promise<{ width?: number; height?: number; duration?: number }> {
  try {
    const output = await runFfprobe([
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height:format=duration",
      "-of",
      "json",
      filePath,
    ]);
    const parsed = JSON.parse(output) as { streams?: Array<{ width?: number; height?: number }>; format?: { duration?: string } };
    const stream = parsed.streams?.[0];
    const duration = Number(parsed.format?.duration);
    return {
      width: positiveInteger(stream?.width),
      height: positiveInteger(stream?.height),
      duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : undefined,
    };
  } catch (error) {
    console.warn("[telegram] ffprobe video metadata failed", error);
    return {};
  }
}

async function runFfprobe(args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });
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
      reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `ffprobe exit code ${code}`));
    });
  });
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

async function publishTelegramMedia(storageChatId: number | string, storageMessageId: number, metadata: StoreMediaMetadata): Promise<void> {
  if (!env.TELEGRAM_PUBLIC_CHANNEL_ID) return;
  if (privateStreamerLogins.has(metadata.streamerLogin.toLowerCase())) {
    console.log(`[telegram] skip public channel private_streamer=${metadata.streamerLogin}`);
    return;
  }

  await publicChannelSendLimiter.schedule(() =>
    telegramBot().api.copyMessage(env.TELEGRAM_PUBLIC_CHANNEL_ID!, storageChatId, storageMessageId, {
      caption: publicChannelCaption(metadata),
    }),
  );
}

export type DeletedChatMessageMetadata = {
  streamerLogin: string;
  streamStartedAt: Date;
  authorName: string;
  authorLogin?: string | null;
  messageText: string;
  twitchMessageId: string;
  linkedPosts: Array<{
    normalizedUrl: string;
    assetId: string | null;
    asset: {
      status: string;
      telegramChatId: string | null;
      telegramMessageId: number | null;
    } | null;
  }>;
};

export async function publishDeletedChatMessage(metadata: DeletedChatMessageMetadata): Promise<{ telegramChatId: string; telegramMessageId: number } | null> {
  if (!env.TELEGRAM_DELETED_CHANNEL_ID) return null;

  const copyablePosts = metadata.linkedPosts.filter((post) => post.asset?.status === "stored" && post.asset.telegramChatId && post.asset.telegramMessageId);
  let firstMessageId: number | null = null;

  for (const post of copyablePosts) {
    const copied = await deletedChannelSendLimiter.schedule(() =>
      telegramBot().api.copyMessage(env.TELEGRAM_DELETED_CHANNEL_ID!, post.asset!.telegramChatId!, post.asset!.telegramMessageId!, {
        caption: deletedChannelCaption(metadata, post),
      }),
    );
    firstMessageId ??= copied.message_id;
  }

  if (firstMessageId) {
    return { telegramChatId: env.TELEGRAM_DELETED_CHANNEL_ID, telegramMessageId: firstMessageId };
  }

  const sent = await deletedChannelSendLimiter.schedule(() =>
    telegramBot().api.sendMessage(env.TELEGRAM_DELETED_CHANNEL_ID!, deletedChannelCaption(metadata)),
  );
  return { telegramChatId: String(sent.chat.id), telegramMessageId: sent.message_id };
}

function publicChannelCaption(metadata: StoreMediaMetadata): string {
  const streamerTag = hashtag(`${metadata.streamerLogin}_stream`);
  const dateTag = hashtag(`date_${formatStreamDateTag(metadata.streamStartedAt)}`);
  const senderTag = hashtag(`user_${metadata.authorName}`);
  const text = stripUrls(metadata.messageText).replace(/\s+/g, " ").trim();
  const prefix = `${streamerTag} ${dateTag} ${senderTag}`;
  return truncate(text ? `${prefix}: ${text}` : prefix, 1000);
}

function deletedChannelCaption(metadata: DeletedChatMessageMetadata, linkedPost?: DeletedChatMessageMetadata["linkedPosts"][number]): string {
  const streamerTag = hashtag(`${metadata.streamerLogin}_stream`);
  const dateTag = hashtag(`date_${formatStreamDateTag(metadata.streamStartedAt)}`);
  const senderTag = hashtag(`user_${metadata.authorLogin || metadata.authorName}`);
  const linked = linkedPost ? `\nasset=${linkedPost.assetId ?? "none"}\nurl=${linkedPost.normalizedUrl}` : "";
  return truncate(`${streamerTag} ${dateTag} ${senderTag}: ${metadata.messageText}${linked}`, linkedPost ? 1000 : 3900);
}

function hashtag(value: string): string {
  return `#${value.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

function formatStreamDateTag(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .split("-");
  return parts.join("_");
}

function stripUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/gi, "").trim();
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}
