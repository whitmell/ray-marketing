import { config } from '../config';

const META_BASE = () => `https://graph.facebook.com/${config.metaApiVersion}`;

export interface InsightRow {
  platform: 'facebook' | 'instagram';
  id: string;
  createdAt: string;
  text: string;
  thumbnailUrl: string | null;
  permalink: string | null;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}

export interface InsightsResult {
  rows: InsightRow[];
  errors: string[];
}

interface GraphError {
  message?: string;
}

interface GraphInsightMetric {
  name: string;
  values?: Array<{ value: number | Record<string, number> }>;
}

interface GraphResponse {
  error?: GraphError;
  data?: unknown;
  access_token?: string;
  [key: string]: unknown;
}

async function graphGet(endpoint: string, params: Record<string, string>, token: string): Promise<GraphResponse> {
  const url = new URL(`${META_BASE()}${endpoint}`);
  Object.entries({ ...params, access_token: token }).forEach(([k, v]) => url.searchParams.set(k, v));
  const response = await fetch(url);
  const data = await response.json() as GraphResponse;
  if (!response.ok || data.error) {
    throw new Error(data.error?.message ?? `HTTP ${response.status}`);
  }
  return data;
}

// Metrics are requested one at a time so a metric Meta has retired or doesn't support
// for a given post doesn't discard the rest.
async function readMetric(objectId: string, candidates: string[], token: string): Promise<number | null> {
  for (const metric of candidates) {
    try {
      const data = await graphGet(`/${objectId}/insights`, { metric }, token);
      const entry = (data.data as GraphInsightMetric[] | undefined)?.[0];
      const value = entry?.values?.[0]?.value;
      if (typeof value === 'number') return value;
      // Breakdown metrics (e.g. reactions by type) return an object; sum it.
      if (value && typeof value === 'object') {
        return Object.values(value).reduce((sum, n) => sum + n, 0);
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

let cachedPageToken: string | null = null;

async function getPageToken(): Promise<string> {
  if (cachedPageToken) return cachedPageToken;
  const data = await graphGet(`/${config.facebookPageId}`, { fields: 'access_token' }, config.metaSystemUserToken);
  if (!data.access_token) throw new Error('Page token exchange returned no access_token');
  cachedPageToken = data.access_token;
  return cachedPageToken;
}

async function fetchFacebookRows(limit: number): Promise<InsightRow[]> {
  const token = await getPageToken();
  const list = await graphGet(`/${config.facebookPageId}/published_posts`, {
    fields: 'id,message,created_time,full_picture,permalink_url,shares',
    limit: String(limit),
  }, token);

  const posts = (list.data as Array<Record<string, unknown>> | undefined) ?? [];
  return Promise.all(posts.map(async (post): Promise<InsightRow> => {
    const id = String(post.id);
    const [views, reach, likes] = await Promise.all([
      readMetric(id, ['post_media_view', 'post_impressions'], token),
      readMetric(id, ['post_total_media_view_unique', 'post_impressions_unique'], token),
      readMetric(id, ['post_reactions_by_type_total'], token),
    ]);
    return {
      platform: 'facebook',
      id,
      createdAt: String(post.created_time ?? ''),
      text: typeof post.message === 'string' ? post.message : '',
      thumbnailUrl: typeof post.full_picture === 'string' ? post.full_picture : null,
      permalink: typeof post.permalink_url === 'string' ? post.permalink_url : null,
      views,
      reach,
      likes,
      comments: null,
      shares: (post.shares as { count?: number } | undefined)?.count ?? 0,
      saves: null,
    };
  }));
}

async function fetchInstagramRows(limit: number): Promise<InsightRow[]> {
  const token = config.metaSystemUserToken;
  const list = await graphGet(`/${config.instagramUserId}/media`, {
    fields: 'id,caption,media_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count',
    limit: String(limit),
  }, token);

  const media = (list.data as Array<Record<string, unknown>> | undefined) ?? [];
  return Promise.all(media.map(async (item): Promise<InsightRow> => {
    const id = String(item.id);
    const [views, reach, shares, saves] = await Promise.all([
      readMetric(id, ['views', 'impressions'], token),
      readMetric(id, ['reach'], token),
      readMetric(id, ['shares'], token),
      readMetric(id, ['saved'], token),
    ]);
    const thumb = item.media_type === 'VIDEO' ? item.thumbnail_url : item.media_url;
    return {
      platform: 'instagram',
      id,
      createdAt: String(item.timestamp ?? ''),
      text: typeof item.caption === 'string' ? item.caption : '',
      thumbnailUrl: typeof thumb === 'string' ? thumb : null,
      permalink: typeof item.permalink === 'string' ? item.permalink : null,
      views,
      reach,
      likes: typeof item.like_count === 'number' ? item.like_count : null,
      comments: typeof item.comments_count === 'number' ? item.comments_count : null,
      shares,
      saves,
    };
  }));
}

export async function getInsights(limit = 25): Promise<InsightsResult> {
  const [fb, ig] = await Promise.allSettled([fetchFacebookRows(limit), fetchInstagramRows(limit)]);
  const rows: InsightRow[] = [];
  const errors: string[] = [];

  if (fb.status === 'fulfilled') rows.push(...fb.value);
  else errors.push(`Facebook: ${fb.reason instanceof Error ? fb.reason.message : String(fb.reason)}`);
  if (ig.status === 'fulfilled') rows.push(...ig.value);
  else errors.push(`Instagram: ${ig.reason instanceof Error ? ig.reason.message : String(ig.reason)}`);

  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { rows, errors };
}
