import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("ru-1"),
  S3_BUCKET: z.string().optional(),
  S3_PUBLIC_BASE_URL: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  ADMIN_USERNAME: z.string().default("admin"),
  ADMIN_PASSWORD_HASH: z.string().optional(),
  SESSION_SECRET: z.string().min(16).default("change-me-change-me"),
});

export const env = envSchema.parse(process.env);
