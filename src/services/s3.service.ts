import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config';
import { getPhotoBuffer } from '../data/s3-resources';

let s3Client: S3Client | null = null;

function getClient(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ region: config.awsRegion });
  }
  return s3Client;
}

export async function uploadPhotoToS3(photoFilename: string): Promise<string> {
  const fileBuffer = await getPhotoBuffer(photoFilename);
  const s3Key = `published/${photoFilename}`;

  const command = new PutObjectCommand({
    Bucket: config.photosBucket,
    Key: s3Key,
    Body: fileBuffer,
    ContentType: 'image/jpeg',
    CacheControl: 'public, max-age=31536000',
  });

  await getClient().send(command);

  const imageUrl = config.domainName
    ? `https://${config.domainName}/photos/${encodeURIComponent(photoFilename)}`
    : `https://${config.photosBucket}.s3.${config.awsRegion}.amazonaws.com/${s3Key}`;
  console.log(`[S3] Uploaded ${photoFilename} → ${imageUrl}`);
  return imageUrl;
}
