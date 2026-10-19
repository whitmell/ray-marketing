import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { Post } from '../data/types';
import { readPosts, readAppConfig, getCurrentDraft, updatePost, readPhotoCandidatesCache, writePhotoCandidatesCache } from '../data/dynamodb';
import { loadPhotoCandidates, clearCandidatesCache } from '../data/s3-resources';
import { classifyTheme } from '../services/theme.service';
import {
  getPostViews,
  getPostView,
  selectCandidate,
  generateCaptionForPost,
  updatePostCaption,
} from '../services/pipeline.service';

const POST_STATUSES: ReadonlyArray<Post['status']> = ['draft', 'posted', 'discarded'];

function respond(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function notFound(): APIGatewayProxyResult {
  return respond(404, { error: 'Not found' });
}

function badRequest(message: string): APIGatewayProxyResult {
  return respond(400, { error: message });
}

function parseBody(raw: string | null, isBase64: boolean): Record<string, unknown> {
  if (!raw) return {};
  const text = isBase64 ? Buffer.from(raw, 'base64').toString('utf-8') : raw;
  const parsed: unknown = JSON.parse(text);
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
}

function isPostStatus(value: string | undefined): value is Post['status'] {
  return value !== undefined && (POST_STATUSES as ReadonlyArray<string>).includes(value);
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const method = event.httpMethod;
    // Match on the concrete path so /api/posts/current wins over /api/posts/{id}
    const path = event.path.length > 1 ? event.path.replace(/\/+$/, '') : event.path;
    const body = parseBody(event.body, event.isBase64Encoded);

    if (method === 'GET' && path === '/api/posts') {
      const status = event.queryStringParameters?.status;
      if (status !== undefined && !isPostStatus(status)) return badRequest('Invalid status');
      return respond(200, await getPostViews(status));
    }

    if (method === 'GET' && path === '/api/posts/current') {
      const draft = await getCurrentDraft();
      if (!draft) return notFound();
      const view = await getPostView(draft.id);
      return view ? respond(200, view) : notFound();
    }

    if (method === 'POST' && path === '/api/photos/sync') {
      clearCandidatesCache();
      const candidates = await loadPhotoCandidates(classifyTheme);
      const summaries = candidates.map(({ description: _, ...rest }) => rest);
      await writePhotoCandidatesCache(summaries);
      return respond(200, { synced: summaries.length });
    }

    if (method === 'GET' && path === '/api/photos') {
      const [cached, posted] = await Promise.all([
        readPhotoCandidatesCache(),
        readPosts('posted'),
      ]);
      if (!cached) {
        return respond(200, { photos: [], needsSync: true });
      }
      const usedFilenames = new Set(posted.map((p) => p.photoFilename));
      return respond(
        200,
        cached.map((c) => ({ ...c, used: usedFilenames.has(c.filename) }))
      );
    }

    if (method === 'GET' && path === '/api/config') {
      return respond(200, await readAppConfig());
    }

    const match = path.match(/^\/api\/posts\/([^/]+)(?:\/([^/]+))?$/);
    if (!match) return notFound();
    const id = event.pathParameters?.id ?? decodeURIComponent(match[1]);
    const action = match[2];

    if (method === 'GET' && !action) {
      const view = await getPostView(id);
      return view ? respond(200, view) : notFound();
    }

    if (method === 'DELETE' && !action) {
      const existing = await getPostView(id);
      if (!existing) return notFound();
      await updatePost(id, { status: 'discarded' });
      return respond(200, { id, status: 'discarded' });
    }

    if (method === 'POST' && action === 'select-photo') {
      if (typeof body.filename !== 'string' || !body.filename) {
        return badRequest('filename is required');
      }
      const view = await selectCandidate(id, body.filename);
      return view ? respond(200, view) : notFound();
    }

    if (method === 'POST' && action === 'generate-caption') {
      const post = await generateCaptionForPost(id);
      return post ? respond(200, post) : notFound();
    }

    if (method === 'PUT' && action === 'caption') {
      if (typeof body.caption !== 'string') return badRequest('caption is required');
      const post = await updatePostCaption(id, body.caption);
      return post ? respond(200, post) : notFound();
    }

    return notFound();
  } catch (err) {
    if (err instanceof SyntaxError) return badRequest('Invalid JSON body');
    console.error('[API] Handler error:', err);
    return respond(500, { error: err instanceof Error ? err.message : 'Internal server error' });
  }
}
