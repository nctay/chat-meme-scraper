ALTER TABLE "assets"
ADD COLUMN "publicHasSpoiler" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "telegramIsAnimation" BOOLEAN NOT NULL DEFAULT false;
