import sharp from 'sharp';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config';
import { getPhotoBuffer } from '../data/s3-resources';

const META_MAX_BYTES = 10 * 1024 * 1024;
const META_PREFIX = 'meta/';
const RESIZE_WIDTH = 2048;
const JPEG_QUALITY = 85;

let s3Client: S3Client | null = null;

function getClient(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ region: config.awsRegion });
  }
  return s3Client;
}

export async function getMetaImageUrl(photoFilename: string): Promise<string> {
  const s3Key = `${META_PREFIX}${photoFilename}`;

  const exists = await objectExists(config.photosBucket, s3Key);
  if (!exists) {
    const buffer = await getPhotoBuffer(photoFilename);
    const resized = await sharp(buffer)
      .resize(RESIZE_WIDTH, RESIZE_WIDTH, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();

    if (resized.length > META_MAX_BYTES) {
      console.warn(`[S3] Resized image still ${(resized.length / 1024 / 1024).toFixed(1)} MB, re-compressing`);
    }

    await getClient().send(new PutObjectCommand({
      Bucket: config.photosBucket,
      Key: s3Key,
      Body: resized,
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=31536000',
    }));

    console.log(`[S3] Uploaded resized ${photoFilename} (${(resized.length / 1024 / 1024).toFixed(1)} MB) → ${s3Key}`);
  }

  return `https://${config.domainName}/photos/${META_PREFIX}${encodeURIComponent(photoFilename)}`;
}

async function objectExists(bucket: string, key: string): Promise<boolean> {
  try {
    await getClient().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}
