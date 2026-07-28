ALTER TABLE "chat_posts" ADD COLUMN "skipTelegramPublic" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "assets"
ADD COLUMN "publicTelegramChatId" TEXT,
ADD COLUMN "publicTelegramMessageId" INTEGER;
