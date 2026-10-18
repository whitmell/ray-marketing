import { config } from '../config';
import type { PublishRecord } from '../data/types';

const META_BASE = () => `https://graph.facebook.com/${config.metaApiVersion}`;

interface MetaErrorDetail {
  message: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

interface MetaApiResponse {
  id?: string;
  error?: MetaErrorDetail;
}

function redactToken(value: string): string {
  if (value.length <= 12) return '***';
  return value.slice(0, 6) + '...' + value.slice(-6);
}

async function metaPost(
  endpoint: string,
  params: Record<string, string>
): Promise<MetaApiResponse> {
  const url = `${META_BASE()}${endpoint}`;
  const allParams = { ...params, access_token: config.metaPageAccessToken };

  const safeParams = { ...allParams, access_token: redactToken(allParams.access_token) };
  console.log(`[Meta] POST url=${url}`);
  console.log(`[Meta] params=${JSON.stringify(safeParams)}`);

  const body = new URLSearchParams(allParams);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const text = await response.text();
  let data: MetaApiResponse;
  try {
    data = JSON.parse(text) as MetaApiResponse;
  } catch {
    console.error(`[Meta] Non-JSON response (${response.status}):`, text.slice(0, 500));
    throw new Error(`Meta API returned non-JSON response (${response.status})`);
  }

  if (!response.ok || data.error) {
    console.error(`[Meta] Error response status=${response.status}`);
    console.error(`[Meta] Error body=${JSON.stringify(data)}`);
    const err = data.error;
    const parts = [
      `Meta API error: ${err?.message ?? `HTTP ${response.status}`}`,
      err?.type ? `type=${err.type}` : null,
      err?.code !== undefined ? `code=${err.code}` : null,
      err?.error_subcode ? `subcode=${err.error_subcode}` : null,
      err?.fbtrace_id ? `trace=${err.fbtrace_id}` : null,
    ].filter(Boolean);
    throw new Error(parts.join(' | '));
  }

  console.log(`[Meta] Success body=${JSON.stringify(data)}`);
  return data;
}

export async function publishToFacebook(
  caption: string,
  faaUrl: string
): Promise<PublishRecord> {
  console.log(`[Publish] Publishing to Facebook page=${config.facebookPageId} apiVersion=${config.metaApiVersion}`);

  const result = await metaPost(`/${config.facebookPageId}/feed`, {
    message: caption,
    link: faaUrl,
  });

  if (!result.id) {
    throw new Error('Facebook publish returned no post ID');
  }

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
  console.log(`[Publish] Publishing to Instagram user=${config.instagramUserId} apiVersion=${config.metaApiVersion}`);

  const container = await metaPost(`/${config.instagramUserId}/media`, {
    image_url: imageUrl,
    caption: caption,
  });

  if (!container.id) {
    throw new Error('Instagram container creation returned no ID');
  }

  const published = await metaPost(`/${config.instagramUserId}/media_publish`, {
    creation_id: container.id,
  });

  if (!published.id) {
    throw new Error('Instagram publish returned no media ID');
  }

  return {
    platform: 'instagram',
    publishedAt: new Date().toISOString(),
    platformPostId: published.id,
  };
}
