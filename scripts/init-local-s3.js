#!/usr/bin/env node

const { CreateBucketCommand, HeadBucketCommand, PutBucketPolicyCommand, S3Client } = require("@aws-sdk/client-s3");

const bucket = process.env.S3_BUCKET || "archive-local";
const endpoint = process.env.LOCAL_S3_ENDPOINT || "http://127.0.0.1:9000";

const s3 = new S3Client({
  endpoint,
  region: process.env.S3_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "minioadmin",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "minioadmin",
  },
  forcePathStyle: true,
});

async function main() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }

  await s3.send(
    new PutBucketPolicyCommand({
      Bucket: bucket,
      Policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: "*",
            Action: ["s3:GetObject"],
            Resource: [`arn:aws:s3:::${bucket}/*`],
          },
        ],
      }),
    }),
  );

  console.log(`Ready local S3 bucket: ${bucket}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
