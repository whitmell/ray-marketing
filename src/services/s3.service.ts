import sharp from 'sharp';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config';
import { getPhotoBuffer } from '../data/s3-resources';

const META_MAX_BYTES = 10 * 1024 * 1024;
const META_PREFIX = 'meta/';
const QUALITY_START = 95;
const QUALITY_MIN = 85;
const SCALE_STEP = 0.9;

let s3Client: S3Client | null = null;

function getClient(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ region: config.awsRegion });
  }
  return s3Client;
}

async function compressForMeta(source: Buffer): Promise<Buffer> {
  const meta = await sharp(source).metadata();
  let width = meta.width!;
  let height = meta.height!;
  let quality = QUALITY_START;

  // Phase 1: reduce JPEG quality down to minimum
  while (quality >= QUALITY_MIN) {
    const output = await sharp(source)
      .resize(width, height, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();

    if (output.length <= META_MAX_BYTES) {
      console.log(`[S3] Compressed ${width}x${height} Q${quality} → ${(output.length / 1024 / 1024).toFixed(1)} MB`);
      return output;
    }

    const ratio = META_MAX_BYTES / output.length;
    if (ratio < 0.5) {
      quality -= 5;
    } else {
      quality -= 3;
    }
  }

  // Phase 2: quality is at minimum, scale down in 10% steps
  quality = QUALITY_MIN;
  while (width > 800) {
    width = Math.round(width * SCALE_STEP);
    height = Math.round(height * SCALE_STEP);

    const output = await sharp(source)
      .resize(width, height, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();

    if (output.length <= META_MAX_BYTES) {
      console.log(`[S3] Compressed ${width}x${height} Q${quality} → ${(output.length / 1024 / 1024).toFixed(1)} MB`);
      return output;
    }
  }

  throw new Error(`Cannot compress image below ${(META_MAX_BYTES / 1024 / 1024).toFixed(0)} MB even at ${width}x${height} Q${quality}`);
}

export async function getMetaImageUrl(photoFilename: string): Promise<string> {
  const s3Key = `${META_PREFIX}${photoFilename}`;

  const exists = await objectExists(config.photosBucket, s3Key);
  if (!exists) {
    const buffer = await getPhotoBuffer(photoFilename);
    const compressed = await compressForMeta(buffer);

    await getClient().send(new PutObjectCommand({
      Bucket: config.photosBucket,
      Key: s3Key,
      Body: compressed,
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=31536000',
    }));

    console.log(`[S3] Uploaded ${photoFilename} (${(compressed.length / 1024 / 1024).toFixed(1)} MB) → ${s3Key}`);
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
