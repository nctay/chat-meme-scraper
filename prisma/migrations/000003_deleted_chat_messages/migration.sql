ALTER TABLE "chat_posts" ADD COLUMN "rawTwitchMessageId" TEXT;

CREATE TABLE "twitch_chat_messages" (
  "id" TEXT NOT NULL,
  "streamerId" TEXT NOT NULL,
  "streamSessionId" TEXT NOT NULL,
  "twitchMessageId" TEXT NOT NULL,
  "authorTwitchId" TEXT,
  "authorLogin" TEXT,
  "authorName" TEXT NOT NULL,
  "messageText" TEXT NOT NULL,
  "postedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "twitch_chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "deleted_chat_messages" (
  "id" TEXT NOT NULL,
  "streamerId" TEXT NOT NULL,
  "streamSessionId" TEXT NOT NULL,
  "twitchMessageId" TEXT NOT NULL,
  "authorTwitchId" TEXT,
  "authorLogin" TEXT,
  "authorName" TEXT NOT NULL,
  "moderatorTwitchId" TEXT,
  "moderatorLogin" TEXT,
  "moderatorName" TEXT,
  "messageText" TEXT NOT NULL,
  "deletedAt" TIMESTAMP(3) NOT NULL,
  "telegramChatId" TEXT,
  "telegramMessageId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "deleted_chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "chat_posts_rawTwitchMessageId_idx" ON "chat_posts"("rawTwitchMessageId");
CREATE UNIQUE INDEX "twitch_chat_messages_streamerId_twitchMessageId_key" ON "twitch_chat_messages"("streamerId", "twitchMessageId");
CREATE INDEX "twitch_chat_messages_streamSessionId_postedAt_idx" ON "twitch_chat_messages"("streamSessionId", "postedAt");
CREATE INDEX "twitch_chat_messages_postedAt_idx" ON "twitch_chat_messages"("postedAt");
CREATE UNIQUE INDEX "deleted_chat_messages_streamerId_twitchMessageId_key" ON "deleted_chat_messages"("streamerId", "twitchMessageId");
CREATE INDEX "deleted_chat_messages_streamSessionId_deletedAt_idx" ON "deleted_chat_messages"("streamSessionId", "deletedAt");
CREATE INDEX "deleted_chat_messages_deletedAt_idx" ON "deleted_chat_messages"("deletedAt");

ALTER TABLE "twitch_chat_messages" ADD CONSTRAINT "twitch_chat_messages_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "streamers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "twitch_chat_messages" ADD CONSTRAINT "twitch_chat_messages_streamSessionId_fkey" FOREIGN KEY ("streamSessionId") REFERENCES "stream_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deleted_chat_messages" ADD CONSTRAINT "deleted_chat_messages_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "streamers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deleted_chat_messages" ADD CONSTRAINT "deleted_chat_messages_streamSessionId_fkey" FOREIGN KEY ("streamSessionId") REFERENCES "stream_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
