import type { PhotoCandidate, ThemeCategory } from '../data/types';
import { loadPhotoCandidates } from '../data/s3-resources';
import { readPosts, readAppConfig } from '../data/dynamodb';
import { classifyTheme } from './theme.service';

function parseSearchTerms(searchTerms?: string): string[] {
  if (!searchTerms || !searchTerms.trim()) return [];
  return searchTerms
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length > 0);
}

function matchesSearchTerms(candidate: PhotoCandidate, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const titleLower = candidate.title.toLowerCase();
  const descLower = candidate.description.toLowerCase();
  const tagsLower = candidate.tags.map(t => t.toLowerCase());

  return terms.every(term =>
    titleLower.includes(term) ||
    descLower.includes(term) ||
    tagsLower.some(tag => tag.includes(term))
  );
}

export async function selectNextPhoto(searchTerms?: string): Promise<PhotoCandidate | null> {
  const allCandidates = await loadPhotoCandidates(classifyTheme);
  const terms = parseSearchTerms(searchTerms);
  const candidates = allCandidates.filter(c => matchesSearchTerms(c, terms));
  const posts = await readPosts();
  const { themeLookback } = await readAppConfig();

  if (terms.length > 0) {
    console.log(`[PhotoSelector] Search filter "${searchTerms}" matched ${candidates.length}/${allCandidates.length} candidates`);
  }

  // Only posted photos are considered used
  const usedFilenames = new Set(
    posts
      .filter(p => p.status === 'posted')
      .map(p => p.photoFilename)
  );

  const unused = candidates.filter(c => !usedFilenames.has(c.filename));
  if (unused.length === 0) return null;

  // Get recent themes to exclude (from most recent posts, any status)
  const sortedPosts = [...posts].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const recentThemes = sortedPosts
    .slice(0, themeLookback)
    .map(p => p.primaryTheme);
  const excludedThemes = new Set<ThemeCategory>(recentThemes);

  // Try filtering by excluded themes
  let pool = unused.filter(c => !excludedThemes.has(c.primaryTheme));

  // Relax: exclude only the most recent theme
  if (pool.length === 0 && recentThemes.length > 0) {
    pool = unused.filter(c => c.primaryTheme !== recentThemes[0]);
  }

  // Final fallback: any unused photo
  if (pool.length === 0) {
    pool = unused;
  }

  // Random selection
  const index = Math.floor(Math.random() * pool.length);
  return pool[index];
}

export async function selectCandidatePhotos(count: number, searchTerms?: string): Promise<PhotoCandidate[]> {
  const allCandidates = await loadPhotoCandidates(classifyTheme);
  const terms = parseSearchTerms(searchTerms);
  const candidates = allCandidates.filter(c => matchesSearchTerms(c, terms));
  const posts = await readPosts();
  const { themeLookback } = await readAppConfig();

  if (terms.length > 0) {
    console.log(`[PhotoSelector] Search filter "${searchTerms}" matched ${candidates.length}/${allCandidates.length} candidates`);
  }

  const usedFilenames = new Set(
    posts
      .filter(p => p.status === 'posted')
      .map(p => p.photoFilename)
  );

  const unused = candidates.filter(c => !usedFilenames.has(c.filename));
  if (unused.length === 0) return [];

  const sortedPosts = [...posts].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const recentThemes = sortedPosts
    .slice(0, themeLookback)
    .map(p => p.primaryTheme);
  const excludedThemes = new Set<ThemeCategory>(recentThemes);

  let pool = unused.filter(c => !excludedThemes.has(c.primaryTheme));

  if (pool.length === 0 && recentThemes.length > 0) {
    pool = unused.filter(c => c.primaryTheme !== recentThemes[0]);
  }

  if (pool.length === 0) {
    pool = unused;
  }

  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}
