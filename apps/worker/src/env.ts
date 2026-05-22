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
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default("ru-1"),
    S3_BUCKET: z.string().optional(),
    S3_PUBLIC_BASE_URL: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    MAX_IMAGE_BYTES: z.coerce.number().default(30 * 1024 * 1024),
    MAX_VIDEO_BYTES: z.coerce.number().default(150 * 1024 * 1024),
    MAX_DAILY_DOWNLOAD_BYTES: z.coerce.number().default(10 * 1024 * 1024 * 1024),
    MAX_PARALLEL_DOWNLOADS: z.coerce.number().default(2),
    ALLOW_PRIVATE_MEDIA_HOSTS: z.coerce.boolean().default(false),
  })
  .parse(process.env);

export const twitchChannels = env.TWITCH_CHANNELS.split(",")
  .map((channel) => channel.trim().toLowerCase().replace(/^#/, ""))
  .filter(Boolean);
