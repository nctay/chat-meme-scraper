CREATE TYPE "StorageProvider" AS ENUM ('telegram', 's3');

ALTER TABLE "assets"
ADD COLUMN "storageProvider" "StorageProvider" NOT NULL DEFAULT 'telegram',
ADD COLUMN "telegramChatId" TEXT,
ADD COLUMN "telegramMessageId" INTEGER,
ADD COLUMN "telegramFileId" TEXT,
ADD COLUMN "telegramFileUniqueId" TEXT;

CREATE INDEX "assets_storageProvider_idx" ON "assets"("storageProvider");
