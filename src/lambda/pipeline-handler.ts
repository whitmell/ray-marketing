import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { runPipeline, createPostFromPhoto, postToMeta, UserInputError } from '../services/pipeline.service';

type JsonResult = Exclude<APIGatewayProxyResultV2, string>;

const PLATFORMS = ['facebook', 'instagram'] as const;
type Platform = (typeof PLATFORMS)[number];

function isPlatformList(value: unknown): value is Platform[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((p) => (PLATFORMS as ReadonlyArray<unknown>).includes(p))
  );
}

let verifier: ReturnType<typeof createVerifier> | null = null;

function createVerifier() {
  return CognitoJwtVerifier.create({
    userPoolId: process.env.COGNITO_USER_POOL_ID!,
    tokenUse: 'id',
    clientId: process.env.COGNITO_CLIENT_ID!,
  });
}

function getVerifier() {
  if (!verifier) verifier = createVerifier();
  return verifier;
}

function respond(statusCode: number, body: unknown): JsonResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function parseBody(raw: string | undefined, isBase64: boolean): Record<string, unknown> {
  if (!raw) return {};
  const text = isBase64 ? Buffer.from(raw, 'base64').toString('utf-8') : raw;
  const parsed: unknown = JSON.parse(text);
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return respond(401, { error: 'Unauthorized' });
  }
  try {
    await getVerifier().verify(authHeader.slice(7));
  } catch {
    return respond(401, { error: 'Invalid token' });
  }

  try {
    const path = event.rawPath.length > 1 ? event.rawPath.replace(/\/+$/, '') : event.rawPath;
    const body = parseBody(event.body, event.isBase64Encoded);

    if (path === '/api/pipeline/run') {
      const searchTerms = typeof body.searchTerms === 'string' ? body.searchTerms : undefined;
      const view = await runPipeline(searchTerms);
      return view ? respond(200, view) : respond(404, { error: 'No unused photos available' });
    }

    if (path === '/api/pipeline/pick') {
      if (typeof body.filename !== 'string' || !body.filename) {
        return respond(400, { error: 'filename is required' });
      }
      const view = await createPostFromPhoto(body.filename);
      return view ? respond(200, view) : respond(404, { error: 'Photo not found' });
    }

    const postMatch = path.match(/^\/api\/pipeline\/post\/([^/]+)$/);
    if (postMatch) {
      const postId = decodeURIComponent(postMatch[1]);
      if (!isPlatformList(body.platforms)) {
        return respond(400, { error: 'platforms must be a non-empty array of facebook/instagram' });
      }
      const post = await postToMeta(postId, body.platforms);
      return post ? respond(200, post) : respond(404, { error: 'Not found' });
    }

    return respond(404, { error: 'Not found' });
  } catch (err) {
    if (err instanceof SyntaxError) return respond(400, { error: 'Invalid JSON body' });
    if (err instanceof UserInputError) return respond(422, { error: err.message });
    console.error('[Pipeline] Handler error:', err);
    return respond(500, { error: err instanceof Error ? err.message : 'Internal server error' });
  }
}
