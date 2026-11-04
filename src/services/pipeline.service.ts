import { v4 as uuidv4 } from 'uuid';
import type { Post, PostView, PublishRecord, PhotoCandidate, ScoringCandidate } from '../data/types';
import { loadPhotoCandidates } from '../data/s3-resources';
import { readPosts, readPost, getCurrentPost, writePost, updatePost } from '../data/dynamodb';
import { classifyTheme } from './theme.service';
import { selectCandidatePhotos } from './photo-selector.service';
import { generateCaption } from './caption.service';
import { scorePhotos } from './scoring.service';
import { getMetaImageUrl } from './s3.service';
import { publishToFacebook, publishToInstagram } from './publish.service';

export class UserInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserInputError';
  }
}

function toPostView(post: Post, photo: PhotoCandidate | undefined): PostView {
  return {
    ...post,
    photoTitle: photo?.title ?? 'Unknown',
    photoDescription: photo?.description ?? '',
    photoTags: photo?.tags ?? [],
    faaUrl: photo?.faaUrl ?? '',
  };
}

async function findPhoto(filename: string): Promise<PhotoCandidate | undefined> {
  const all = await loadPhotoCandidates(classifyTheme);
  return all.find(c => c.filename === filename);
}

function newDraft(photo: PhotoCandidate, candidates: ScoringCandidate[]): Post {
  return {
    id: uuidv4(),
    photoFilename: photo.filename,
    caption: null,
    status: 'draft',
    primaryTheme: photo.primaryTheme,
    createdAt: new Date().toISOString(),
    postedAt: null,
    imageUrl: null,
    publishedTo: [],
    candidates,
  };
}

export async function runPipeline(searchTerms?: string): Promise<PostView | null> {
  const candidatePhotos = await selectCandidatePhotos(3, searchTerms);
  if (candidatePhotos.length === 0) {
    if (searchTerms?.trim()) {
      const msg = `No photos matched "${searchTerms}". Try different terms separated by commas.`;
      console.log(`[Pipeline] ${msg}`);
      throw new UserInputError(msg);
    }
    console.log('[Pipeline] No unused photos available');
    return null;
  }

  const initialCandidates: ScoringCandidate[] = candidatePhotos.map(photo => ({
    filename: photo.filename,
    title: photo.title,
    primaryTheme: photo.primaryTheme,
    criticScores: { composition: null, colorTonal: null, artisticImpact: null },
    curatorRanking: null,
    selected: false,
  }));
  const post = newDraft(candidatePhotos[0], initialCandidates);
  await writePost(post);
  console.log(`[Pipeline] Created draft ${post.id} with ${candidatePhotos.length} candidates`);

  console.log(`[Pipeline] Scoring ${candidatePhotos.length} candidates: ${candidatePhotos.map(p => p.filename).join(', ')}`);

  const candidates = await scorePhotos(candidatePhotos);
  const selectedCandidate = candidates.find(c => c.selected);
  const latestPost = await readPost(post.id);
  if (!latestPost) {
    console.log(`[Pipeline] Draft ${post.id} was discarded before scoring completed`);
    return null;
  }
  const userSelectedCandidate = latestPost.candidates.find(c => c.selected);
  const selectedFilename = userSelectedCandidate?.filename ?? selectedCandidate?.filename;
  const photo = candidatePhotos.find(p => p.filename === selectedFilename) ?? candidatePhotos[0];
  const scoredCandidates = candidates.map(candidate => ({
    ...candidate,
    selected: candidate.filename === selectedFilename,
  }));

  await updatePost(post.id, {
    candidates: scoredCandidates,
    photoFilename: photo.filename,
    primaryTheme: photo.primaryTheme,
  });
  if (!selectedFilename) {
    console.log(`[Pipeline] No candidate selected for draft ${post.id}`);
  } else {
    console.log(`[Pipeline] Selected "${photo.title}" for draft ${post.id}`);
  }
  return toPostView({
    ...latestPost,
    candidates: scoredCandidates,
    photoFilename: photo.filename,
    primaryTheme: photo.primaryTheme,
  }, photo);
}

export async function createPostFromPhoto(filename: string): Promise<PostView | null> {
  const photo = await findPhoto(filename);
  if (!photo) return null;

  const candidate: ScoringCandidate = {
    filename: photo.filename,
    title: photo.title,
    primaryTheme: photo.primaryTheme,
    criticScores: { composition: null, colorTonal: null, artisticImpact: null },
    curatorRanking: null,
    selected: true,
  };

  const post = newDraft(photo, [candidate]);
  await writePost(post);
  console.log(`[Pipeline] Created draft ${post.id} from photo "${photo.title}"`);
  return toPostView(post, photo);
}

export async function generateCaptionForPost(postId: string): Promise<Post | null> {
  const post = await readPost(postId);
  if (!post || (post.status !== 'draft' && post.status !== 'working')) return null;

  const selected = post.candidates.find(c => c.selected);
  if (!selected) return null;
  const filename = selected.filename;
  const photo = await findPhoto(filename);
  if (!photo) return null;

  const caption = await generateCaption(photo.title, photo.description, photo.faaUrl);
  const workingPosts = await readPosts('working');
  for (const workingPost of workingPosts) {
    if (workingPost.id !== postId) {
      await updatePost(workingPost.id, { status: 'draft', caption: null });
      console.log(`[Pipeline] Returned working post ${workingPost.id} to drafts`);
    }
  }
  await updatePost(postId, { caption, status: 'working' });
  console.log(`[Pipeline] Moved post ${postId} to working`);
  return { ...post, caption, status: 'working' };
}

export async function selectCandidate(postId: string, filename: string): Promise<PostView | null> {
  const post = await readPost(postId);
  if (!post || post.status !== 'draft') return null;
  if (!post.candidates.some(c => c.filename === filename)) return null;

  const photo = await findPhoto(filename);
  if (!photo) return null;

  const candidates = post.candidates.map(c => ({ ...c, selected: c.filename === filename }));
  const updates: Partial<Post> = {
    candidates,
    photoFilename: filename,
    primaryTheme: photo.primaryTheme,
    caption: null,
  };
  await updatePost(postId, updates);
  console.log(`[Pipeline] Switched post ${postId} to candidate "${photo.title}"`);
  return toPostView({ ...post, ...updates }, photo);
}

export async function postToMeta(
  postId: string,
  platforms: Array<'facebook' | 'instagram'>
): Promise<Post | null> {
  const post = await readPost(postId);
  if (!post || (post.status !== 'working' && post.status !== 'posted') || post.caption === null) return null;

  const photo = await findPhoto(post.photoFilename);
  if (!photo) return null;

  const publishedTo: PublishRecord[] = [...post.publishedTo];
  for (const platform of platforms) {
    if (publishedTo.some(r => r.platform === platform)) {
      console.log(`[Pipeline] Post ${postId} already published to ${platform}, skipping`);
      continue;
    }
    const imageUrl = await getMetaImageUrl(post.photoFilename, platform);
    let record: PublishRecord;
    if (platform === 'facebook') {
      record = await publishToFacebook(post.caption, imageUrl);
    } else {
      record = await publishToInstagram(post.caption, imageUrl);
    }
    publishedTo.push(record);
    await updatePost(postId, { publishedTo });
  }

  const updates: Partial<Post> = {
    status: 'posted',
    postedAt: new Date().toISOString(),
    publishedTo,
  };
  await updatePost(postId, updates);
  return { ...post, ...updates };
}

export async function updatePostCaption(postId: string, caption: string): Promise<Post | null> {
  const post = await readPost(postId);
  if (!post || post.status !== 'working') return null;
  await updatePost(postId, { caption });
  return { ...post, caption };
}

export async function getPostView(postId: string): Promise<PostView | null> {
  const post = await readPost(postId);
  if (!post) return null;
  const photo = await findPhoto(post.photoFilename);
  return toPostView(post, photo);
}

export async function getPostViews(status?: Post['status']): Promise<PostView[]> {
  const posts = await readPosts(status);
  const candidates = await loadPhotoCandidates(classifyTheme);
  const photoMap = new Map(candidates.map(c => [c.filename, c]));
  return [...posts]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map(post => toPostView(post, photoMap.get(post.photoFilename)));
}
