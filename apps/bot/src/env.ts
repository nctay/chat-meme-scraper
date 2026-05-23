import { z } from "zod";

export const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    TELEGRAM_BOT_TOKEN: z.string().min(1),
    TELEGRAM_STORAGE_CHAT_ID: z.string().min(1),
    TELEGRAM_ALLOWED_USER_IDS: z.string().min(1),
    TELEGRAM_PUBLIC_BOT_TOKEN: z.string().optional(),
  })
  .parse(process.env);

export const allowedUserIds = new Set(
  env.TELEGRAM_ALLOWED_USER_IDS.split(",")
    .map((id) => Number(id.trim()))
    .filter(Number.isSafeInteger),
);
