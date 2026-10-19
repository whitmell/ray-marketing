import sharp from 'sharp';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config';
import { getPhotoBuffer } from '../data/s3-resources';

const META_MAX_BYTES = 10 * 1024 * 1024;
const QUALITY_START = 95;
const QUALITY_MIN = 85;
const SCALE_STEP = 0.9;

const IG_LANDSCAPE_RATIO = 1.91;
const IG_PORTRAIT_RATIO = 4 / 5;

const PREFIXES: Record<string, string> = {
  facebook: 'meta/',
  instagram: 'meta-ig/',
};

let s3Client: S3Client | null = null;

function getClient(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ region: config.awsRegion });
  }
  return s3Client;
}

async function letterboxForInstagram(source: Buffer): Promise<Buffer> {
  const meta = await sharp(source).metadata();
  const width = meta.width!;
  const height = meta.height!;
  const aspectRatio = width / height;

  const targetRatio = aspectRatio >= 1 ? IG_LANDSCAPE_RATIO : IG_PORTRAIT_RATIO;
  const currentRatio = aspectRatio;

  if (currentRatio >= 1 && currentRatio <= IG_LANDSCAPE_RATIO) {
    // Landscape but within Instagram's range — no letterboxing needed
    return source;
  }
  if (currentRatio < 1 && currentRatio >= IG_PORTRAIT_RATIO) {
    // Portrait but within Instagram's range — no letterboxing needed
    return source;
  }

  let newWidth: number;
  let newHeight: number;

  if (currentRatio > IG_LANDSCAPE_RATIO) {
    // Too wide — add black bars top and bottom
    newWidth = width;
    newHeight = Math.round(width / targetRatio);
  } else {
    // Too tall — add black bars left and right
    newHeight = height;
    newWidth = Math.round(height * targetRatio);
  }

  const top = Math.round((newHeight - height) / 2);
  const left = Math.round((newWidth - width) / 2);

  console.log(`[S3] Letterboxing ${width}x${height} → ${newWidth}x${newHeight} for Instagram`);

  return sharp(source)
    .extend({
      top,
      bottom: newHeight - height - top,
      left,
      right: newWidth - width - left,
      background: { r: 0, g: 0, b: 0 },
    })
    .toBuffer();
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

export async function getMetaImageUrl(
  photoFilename: string,
  platform: 'facebook' | 'instagram'
): Promise<string> {
  const prefix = PREFIXES[platform];
  const s3Key = `${prefix}${photoFilename}`;

  const exists = await objectExists(config.photosBucket, s3Key);
  if (!exists) {
    let buffer = await getPhotoBuffer(photoFilename);

    if (platform === 'instagram') {
      buffer = await letterboxForInstagram(buffer);
    }

    const compressed = await compressForMeta(buffer);

    await getClient().send(new PutObjectCommand({
      Bucket: config.photosBucket,
      Key: s3Key,
      Body: compressed,
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=31536000',
    }));

    console.log(`[S3] Uploaded ${photoFilename} for ${platform} (${(compressed.length / 1024 / 1024).toFixed(1)} MB) → ${s3Key}`);
  }

  return `https://${config.domainName}/photos/${prefix}${encodeURIComponent(photoFilename)}`;
}

async function objectExists(bucket: string, key: string): Promise<boolean> {
  try {
    await getClient().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}
