import fs from "node:fs";
import path from "node:path";
import { Bot, InputFile } from "grammy";
import type { Message } from "grammy/types";
import { env } from "../env.js";
import type { StoreMediaMetadata, StoredMedia } from "./storage.js";
import { SerialRateLimiter, withTelegramRetry } from "./rate-limit.js";

let bot: Bot | null = null;
const storageSendLimiter = new SerialRateLimiter(1100);

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
  const message = await storageSendLimiter.schedule<Message.PhotoMessage | Message.VideoMessage>(async () => {
    if (mediaType === "image") {
      return telegramBot().api.sendPhoto(env.TELEGRAM_STORAGE_CHAT_ID!, input, { caption });
    }
    return telegramBot().api.sendVideo(env.TELEGRAM_STORAGE_CHAT_ID!, input, { caption, supports_streaming: true });
  });
  const file = "photo" in message ? message.photo.at(-1) : message.video;
  if (!file) throw new Error("Telegram did not return stored file metadata");

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
