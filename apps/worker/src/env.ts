import { z } from "zod";

export const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    TWITCH_CLIENT_ID: z.string().optional(),
    TWITCH_CLIENT_SECRET: z.string().optional(),
    TWITCH_EVENTSUB_USER_TOKEN: z.string().optional(),
    TWITCH_BOT_USERNAME: z.string().optional(),
    TWITCH_BOT_OAUTH: z.string().optional(),
    TWITCH_CHANNELS: z.string().default(""),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_STORAGE_CHAT_ID: z.string().optional(),
    TELEGRAM_PUBLIC_CHANNEL_ID: z.string().optional(),
    TELEGRAM_PRIVATE_STREAMER_LOGINS: z.string().default(""),
    MAX_IMAGE_BYTES: z.coerce.number().default(30 * 1024 * 1024),
    MAX_VIDEO_BYTES: z.coerce.number().default(150 * 1024 * 1024),
    MAX_DAILY_DOWNLOAD_BYTES: z.coerce.number().default(10 * 1024 * 1024 * 1024),
    MAX_PARALLEL_DOWNLOADS: z.coerce.number().default(2),
    ALLOW_PRIVATE_MEDIA_HOSTS: z.coerce.boolean().default(false),
    ENABLE_PLATFORM_DOWNLOADS: z.coerce.boolean().default(false),
    MAX_PLATFORM_VIDEO_SECONDS: z.coerce.number().default(300),
    PLATFORM_DOWNLOAD_TIMEOUT_MS: z.coerce.number().default(600_000),
  })
  .parse(process.env);

export const twitchChannels = env.TWITCH_CHANNELS.split(",")
  .map((channel) => channel.trim().toLowerCase().replace(/^#/, ""))
  .filter(Boolean);

export const privateStreamerLogins = new Set(
  env.TELEGRAM_PRIVATE_STREAMER_LOGINS.split(",")
    .map((login) => login.trim().toLowerCase())
    .filter(Boolean),
);
