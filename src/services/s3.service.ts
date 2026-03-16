import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

let s3Client: S3Client | null = null;

function getClient(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ region: config.awsRegion });
  }
  return s3Client;
}

export async function uploadPhotoToS3(photoFilename: string): Promise<string> {
  const localPath = path.join(config.photosPath, photoFilename);

  if (!fs.existsSync(localPath)) {
    throw new Error(`Photo file not found: ${localPath}`);
  }

  const fileBuffer = fs.readFileSync(localPath);
  const s3Key = `photos/${photoFilename}`;

  const command = new PutObjectCommand({
    Bucket: config.s3Bucket,
    Key: s3Key,
    Body: fileBuffer,
    ContentType: 'image/jpeg',
    CacheControl: 'public, max-age=31536000',
  });

  await getClient().send(command);

  const imageUrl = `https://${config.s3Bucket}.s3.${config.awsRegion}.amazonaws.com/${s3Key}`;
  console.log(`[S3] Uploaded ${photoFilename} → ${imageUrl}`);
  return imageUrl;
}
