import { v4 as uuidv4 } from 'uuid';
import type { Post, PostView, PublishRecord } from '../data/types';
import { readPosts, writePosts, loadPhotoCandidates } from '../data/store';
import { classifyTheme } from './theme.service';
import { selectNextPhoto } from './photo-selector.service';
import { generateCaption } from './caption.service';
import { uploadPhotoToS3 } from './s3.service';
import { publishToFacebook, publishToInstagram } from './publish.service';

export async function runPipeline(): Promise<PostView | null> {
  const photo = selectNextPhoto();
  if (!photo) {
    console.log('[Pipeline] No unused photos available');
    return null;
  }

  console.log(`[Pipeline] Selected: ${photo.filename} (theme: ${photo.primaryTheme})`);

  const caption = await generateCaption(photo.title, photo.description, photo.faaUrl);

  const post: Post = {
    id: uuidv4(),
    photoFilename: photo.filename,
    caption,
    status: 'pending',
    primaryTheme: photo.primaryTheme,
    createdAt: new Date().toISOString(),
    reviewedAt: null,
    notes: null,
    imageUrl: null,
    publishedTo: [],
  };

  const posts = readPosts();
  posts.push(post);
  writePosts(posts);

  console.log(`[Pipeline] Created post ${post.id} for "${photo.title}"`);

  return {
    ...post,
    photoTitle: photo.title,
    photoDescription: photo.description,
    photoTags: photo.tags,
    faaUrl: photo.faaUrl,
  };
}

export function getPostView(postId: string): PostView | null {
  const posts = readPosts();
  const post = posts.find(p => p.id === postId);
  if (!post) return null;

  const candidates = loadPhotoCandidates(classifyTheme);
  const photo = candidates.find(c => c.filename === post.photoFilename);
  if (!photo) return null;

  return {
    ...post,
    photoTitle: photo.title,
    photoDescription: photo.description,
    photoTags: photo.tags,
    faaUrl: photo.faaUrl,
  };
}

export function getPostViews(status?: Post['status']): PostView[] {
  const posts = readPosts();
  const candidates = loadPhotoCandidates(classifyTheme);
  const photoMap = new Map(candidates.map(c => [c.filename, c]));

  const filtered = status ? posts.filter(p => p.status === status) : posts;

  return filtered
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map(post => {
      const photo = photoMap.get(post.photoFilename);
      return {
        ...post,
        photoTitle: photo?.title ?? 'Unknown',
        photoDescription: photo?.description ?? '',
        photoTags: photo?.tags ?? [],
        faaUrl: photo?.faaUrl ?? '',
      };
    });
}

export async function updatePostStatus(
  postId: string,
  status: 'approved' | 'rejected',
  notes?: string
): Promise<Post | null> {
  const posts = readPosts();
  const post = posts.find(p => p.id === postId);
  if (!post || post.status !== 'pending') return null;

  post.status = status;
  post.reviewedAt = new Date().toISOString();
  if (notes) post.notes = notes;

  if (status === 'approved') {
    try {
      const imageUrl = await uploadPhotoToS3(post.photoFilename);
      post.imageUrl = imageUrl;
    } catch (error) {
      console.error(`[Pipeline] S3 upload failed for ${post.photoFilename}:`, error);
      // Still approve even if S3 fails — imageUrl stays null, publish will require it later
    }
  }

  writePosts(posts);
  return post;
}

export function updatePostCaption(postId: string, caption: string): Post | null {
  const posts = readPosts();
  const post = posts.find(p => p.id === postId);
  if (!post || post.status !== 'pending') return null;

  post.caption = caption;
  writePosts(posts);
  return post;
}

export async function publishPost(
  postId: string,
  platforms: Array<'facebook' | 'instagram'>
): Promise<Post | null> {
  const posts = readPosts();
  const post = posts.find(p => p.id === postId);
  if (!post || post.status !== 'approved') return null;

  const candidates = loadPhotoCandidates(classifyTheme);
  const photo = candidates.find(c => c.filename === post.photoFilename);
  if (!photo) return null;

  for (const platform of platforms) {
    if (post.publishedTo.some(r => r.platform === platform)) {
      console.log(`[Pipeline] Post ${postId} already published to ${platform}, skipping`);
      continue;
    }

    let record: PublishRecord;
    if (platform === 'facebook') {
      record = await publishToFacebook(post.caption, photo.faaUrl);
    } else {
      if (!post.imageUrl) {
        throw new Error('Cannot publish to Instagram without S3 image URL');
      }
      record = await publishToInstagram(post.caption, post.imageUrl);
    }

    post.publishedTo.push(record);
    writePosts(posts);
  }

  return post;
}

export async function regeneratePost(postId: string): Promise<PostView | null> {
  const posts = readPosts();
  const oldPost = posts.find(p => p.id === postId);
  if (!oldPost) return null;

  const candidates = loadPhotoCandidates(classifyTheme);
  const photo = candidates.find(c => c.filename === oldPost.photoFilename);
  if (!photo) return null;

  // Reject the old post
  oldPost.status = 'rejected';
  oldPost.reviewedAt = new Date().toISOString();
  oldPost.notes = 'Regenerated';

  // Generate new caption
  const caption = await generateCaption(photo.title, photo.description, photo.faaUrl);

  const newPost: Post = {
    id: uuidv4(),
    photoFilename: photo.filename,
    caption,
    status: 'pending',
    primaryTheme: photo.primaryTheme,
    createdAt: new Date().toISOString(),
    reviewedAt: null,
    notes: null,
    imageUrl: null,
    publishedTo: [],
  };

  posts.push(newPost);
  writePosts(posts);

  return {
    ...newPost,
    photoTitle: photo.title,
    photoDescription: photo.description,
    photoTags: photo.tags,
    faaUrl: photo.faaUrl,
  };
}
