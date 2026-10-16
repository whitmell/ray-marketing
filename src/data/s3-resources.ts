import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config';
import type {
  DescriptionEntry,
  PhotoCandidate,
  ThemeCategory,
  UploadEntry,
} from './types';

let s3Client: S3Client | null = null;
let candidatesCache: PhotoCandidate[] | null = null;

function getClient(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ region: config.awsRegion });
  }
  return s3Client;
}

async function getObjectBody(bucket: string, key: string) {
  const response = await getClient().send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );
  if (!response.Body) {
    throw new Error(`Empty S3 object body: s3://${bucket}/${key}`);
  }
  return response.Body;
}

export async function getResourceText(key: string): Promise<string> {
  const body = await getObjectBody(config.resourcesBucket, key);
  return body.transformToString();
}

export async function getResourceJson<T>(key: string): Promise<T> {
  const text = await getResourceText(key);
  return JSON.parse(text) as T;
}

export async function getPhotoBuffer(filename: string): Promise<Buffer> {
  const body = await getObjectBody(config.photosBucket, filename);
  return Buffer.from(await body.transformToByteArray());
}

export async function loadPhotoCandidates(
  classifyFn: (tags: string[]) => ThemeCategory
): Promise<PhotoCandidate[]> {
  if (candidatesCache) return candidatesCache;

  const [descriptions, uploads] = await Promise.all([
    getResourceJson<Record<string, DescriptionEntry>>('descriptions.json'),
    getResourceJson<Record<string, UploadEntry>>('upload-progress.json'),
  ]);

  const candidates: PhotoCandidate[] = [];
  for (const [filename, desc] of Object.entries(descriptions)) {
    const upload = uploads[filename];
    if (!upload?.faaUrl) continue;
    candidates.push({
      filename,
      title: desc.title,
      description: desc.description,
      tags: desc.tags,
      faaUrl: upload.faaUrl,
      primaryTheme: classifyFn(desc.tags),
      uploadedAt: upload.uploadedAt,
    });
  }

  candidatesCache = candidates;
  console.log(`[Init] Loaded ${candidates.length} photo candidates from S3`);
  return candidates;
}

export function clearCandidatesCache(): void {
  candidatesCache = null;
}
