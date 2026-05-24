import type { Asset, MediaType } from "@prisma/client";
import { storeTelegramMedia, deleteTelegramMedia } from "./telegram-storage.js";

export type StoredMedia = {
  storageProvider: "telegram" | "s3";
  telegramChatId?: string;
  telegramMessageId?: number;
  telegramFileId?: string;
  telegramFileUniqueId?: string;
  s3Key?: string;
  publicUrl?: string;
};

export type StoreMediaMetadata = {
  originalUrl: string;
  normalizedUrl: string;
  sha256: string;
  streamerLogin: string;
  streamerDisplayName: string;
  streamStartedAt: Date;
  streamSessionId: string;
  assetId: string;
  authorName: string;
  messageText: string;
};

export async function storeMedia(filePath: string, mimeType: string, mediaType: Extract<MediaType, "image" | "video">, metadata: StoreMediaMetadata): Promise<StoredMedia> {
  return storeTelegramMedia(filePath, mimeType, mediaType, metadata);
}

export async function deleteMedia(asset: Pick<Asset, "storageProvider" | "telegramChatId" | "telegramMessageId">): Promise<void> {
  if (asset.storageProvider === "telegram") {
    await deleteTelegramMedia(asset);
  }
}
