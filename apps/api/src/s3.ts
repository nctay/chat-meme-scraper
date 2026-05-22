import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "./env.js";

export const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  credentials:
    env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
      ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
      : undefined,
  forcePathStyle: true,
});

export async function deleteObject(s3Key: string): Promise<void> {
  if (!env.S3_BUCKET) throw new Error("S3_BUCKET is not configured");
  await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: s3Key }));
}
