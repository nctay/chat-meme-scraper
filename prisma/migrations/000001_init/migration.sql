CREATE TYPE "StreamerStatus" AS ENUM ('unknown', 'online', 'offline');
CREATE TYPE "StreamSessionStatus" AS ENUM ('live', 'ended');
CREATE TYPE "ChatPostStatus" AS ENUM ('stored', 'pending', 'failed', 'blocked', 'skipped');
CREATE TYPE "AssetStatus" AS ENUM ('pending', 'stored', 'failed', 'skipped', 'deleted');
CREATE TYPE "AssetVisibility" AS ENUM ('public', 'hidden');
CREATE TYPE "MediaType" AS ENUM ('image', 'video', 'other');
CREATE TYPE "DownloadJobStatus" AS ENUM ('pending', 'running', 'done', 'failed', 'ignored', 'blocked');

CREATE TABLE "streamers" (
  "id" TEXT NOT NULL,
  "twitchUserId" TEXT NOT NULL,
  "login" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "lastStatus" "StreamerStatus" NOT NULL DEFAULT 'unknown',
  "lastCheckedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "streamers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stream_sessions" (
  "id" TEXT NOT NULL,
  "streamerId" TEXT NOT NULL,
  "twitchStreamId" TEXT,
  "title" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  "status" "StreamSessionStatus" NOT NULL DEFAULT 'live',
  CONSTRAINT "stream_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chat_posts" (
  "id" TEXT NOT NULL,
  "streamSessionId" TEXT NOT NULL,
  "twitchMessageId" TEXT,
  "authorTwitchId" TEXT,
  "authorName" TEXT NOT NULL,
  "messageText" TEXT NOT NULL,
  "originalUrl" TEXT NOT NULL,
  "normalizedUrl" TEXT NOT NULL,
  "postedAt" TIMESTAMP(3) NOT NULL,
  "assetId" TEXT,
  "status" "ChatPostStatus" NOT NULL DEFAULT 'pending',
  CONSTRAINT "chat_posts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "assets" (
  "id" TEXT NOT NULL,
  "originalUrl" TEXT NOT NULL,
  "normalizedUrl" TEXT NOT NULL,
  "sha256" TEXT,
  "s3Key" TEXT,
  "publicUrl" TEXT,
  "mimeType" TEXT,
  "byteSize" BIGINT,
  "mediaType" "MediaType" NOT NULL DEFAULT 'other',
  "status" "AssetStatus" NOT NULL DEFAULT 'pending',
  "visibility" "AssetVisibility" NOT NULL DEFAULT 'public',
  "deletedAt" TIMESTAMP(3),
  "deletedBy" TEXT,
  "deleteReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "download_jobs" (
  "id" TEXT NOT NULL,
  "assetId" TEXT,
  "chatPostId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "status" "DownloadJobStatus" NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextRetryAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "download_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "blocked_media" (
  "id" TEXT NOT NULL,
  "normalizedUrl" TEXT,
  "sha256" TEXT,
  "reason" TEXT NOT NULL,
  "sourceAssetId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "blocked_media_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_audit_log" (
  "id" TEXT NOT NULL,
  "adminUsername" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "streamers_twitchUserId_key" ON "streamers"("twitchUserId");
CREATE UNIQUE INDEX "streamers_login_key" ON "streamers"("login");
CREATE INDEX "stream_sessions_streamerId_startedAt_idx" ON "stream_sessions"("streamerId", "startedAt");
CREATE INDEX "stream_sessions_status_idx" ON "stream_sessions"("status");
CREATE UNIQUE INDEX "chat_posts_twitchMessageId_key" ON "chat_posts"("twitchMessageId");
CREATE INDEX "chat_posts_streamSessionId_postedAt_idx" ON "chat_posts"("streamSessionId", "postedAt");
CREATE INDEX "chat_posts_assetId_idx" ON "chat_posts"("assetId");
CREATE INDEX "chat_posts_normalizedUrl_idx" ON "chat_posts"("normalizedUrl");
CREATE INDEX "chat_posts_status_idx" ON "chat_posts"("status");
CREATE UNIQUE INDEX "assets_normalizedUrl_key" ON "assets"("normalizedUrl");
CREATE UNIQUE INDEX "assets_sha256_key" ON "assets"("sha256");
CREATE INDEX "assets_status_idx" ON "assets"("status");
CREATE INDEX "assets_visibility_idx" ON "assets"("visibility");
CREATE INDEX "assets_mediaType_idx" ON "assets"("mediaType");
CREATE INDEX "download_jobs_status_nextRetryAt_idx" ON "download_jobs"("status", "nextRetryAt");
CREATE INDEX "download_jobs_assetId_idx" ON "download_jobs"("assetId");
CREATE INDEX "download_jobs_chatPostId_idx" ON "download_jobs"("chatPostId");
CREATE UNIQUE INDEX "blocked_media_normalizedUrl_key" ON "blocked_media"("normalizedUrl");
CREATE UNIQUE INDEX "blocked_media_sha256_key" ON "blocked_media"("sha256");
CREATE INDEX "blocked_media_normalizedUrl_idx" ON "blocked_media"("normalizedUrl");
CREATE INDEX "blocked_media_sha256_idx" ON "blocked_media"("sha256");
CREATE INDEX "admin_audit_log_entityType_entityId_idx" ON "admin_audit_log"("entityType", "entityId");
CREATE INDEX "admin_audit_log_createdAt_idx" ON "admin_audit_log"("createdAt");

ALTER TABLE "stream_sessions" ADD CONSTRAINT "stream_sessions_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "streamers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_posts" ADD CONSTRAINT "chat_posts_streamSessionId_fkey" FOREIGN KEY ("streamSessionId") REFERENCES "stream_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_posts" ADD CONSTRAINT "chat_posts_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "download_jobs" ADD CONSTRAINT "download_jobs_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "download_jobs" ADD CONSTRAINT "download_jobs_chatPostId_fkey" FOREIGN KEY ("chatPostId") REFERENCES "chat_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "blocked_media" ADD CONSTRAINT "blocked_media_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
