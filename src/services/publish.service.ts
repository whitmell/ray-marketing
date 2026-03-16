import { config } from '../config';
import type { PublishRecord } from '../data/types';

const META_BASE = () => `https://graph.facebook.com/${config.metaApiVersion}`;

interface MetaApiResponse {
  id?: string;
  error?: { message: string; code: number };
}

async function metaPost(
  endpoint: string,
  params: Record<string, string>
): Promise<MetaApiResponse> {
  const url = `${META_BASE()}${endpoint}`;
  const body = new URLSearchParams({
    ...params,
    access_token: config.metaPageAccessToken,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await response.json() as MetaApiResponse;

  if (!response.ok || data.error) {
    const msg = data.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`Meta API error: ${msg}`);
  }

  return data;
}

export async function publishToFacebook(
  caption: string,
  faaUrl: string
): Promise<PublishRecord> {
  console.log(`[Publish] Publishing to Facebook page ${config.facebookPageId}`);

  const result = await metaPost(`/${config.facebookPageId}/feed`, {
    message: caption,
    link: faaUrl,
  });

  if (!result.id) {
    throw new Error('Facebook publish returned no post ID');
  }

  console.log(`[Publish] Facebook post created: ${result.id}`);

  return {
    platform: 'facebook',
    publishedAt: new Date().toISOString(),
    platformPostId: result.id,
  };
}

export async function publishToInstagram(
  caption: string,
  imageUrl: string
): Promise<PublishRecord> {
  console.log(`[Publish] Publishing to Instagram user ${config.instagramUserId}`);

  // Step 1: Create media container
  const container = await metaPost(`/${config.instagramUserId}/media`, {
    image_url: imageUrl,
    caption: caption,
  });

  if (!container.id) {
    throw new Error('Instagram container creation returned no ID');
  }

  console.log(`[Publish] Instagram container created: ${container.id}`);

  // Step 2: Publish the container
  const published = await metaPost(`/${config.instagramUserId}/media_publish`, {
    creation_id: container.id,
  });

  if (!published.id) {
    throw new Error('Instagram publish returned no media ID');
  }

  console.log(`[Publish] Instagram post published: ${published.id}`);

  return {
    platform: 'instagram',
    publishedAt: new Date().toISOString(),
    platformPostId: published.id,
  };
}
