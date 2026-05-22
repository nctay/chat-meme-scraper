import fs from "node:fs";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../env.js";

export const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  credentials:
    env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
      ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
      : undefined,
  forcePathStyle: true,
});

export async function uploadFile(key: string, filePath: string, contentType: string): Promise<string> {
  if (!env.S3_BUCKET) throw new Error("S3_BUCKET is not configured");
  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: fs.createReadStream(filePath),
      ContentType: contentType,
      ACL: "public-read",
    }),
  );

  const base = env.S3_PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (base) return `${base}/${key}`;
  return `${env.S3_ENDPOINT?.replace(/\/$/, "")}/${env.S3_BUCKET}/${key}`;
}
