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

function countMatchingTerms(candidate: PhotoCandidate, terms: string[]): number {
  if (terms.length === 0) return 0;
  const titleLower = candidate.title.toLowerCase();
  const descLower = candidate.description.toLowerCase();
  const tagsLower = candidate.tags.map(t => t.toLowerCase());

  let matches = 0;
  for (const term of terms) {
    if (
      titleLower.includes(term) ||
      descLower.includes(term) ||
      tagsLower.some(tag => tag.includes(term))
    ) {
      matches++;
    }
  }
  return matches;
}

function weightedRandomSelect<T extends { weight: number }>(items: T[]): T {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

function buildScoredPool(
  pool: PhotoCandidate[],
  terms: string[],
  excludedThemes: Set<ThemeCategory>,
): Array<PhotoCandidate & { weight: number }> {
  return pool.map(c => {
    let weight = 1;
    if (terms.length > 0) {
      const matchCount = countMatchingTerms(c, terms);
      // Each matching term doubles the weight
      weight = Math.pow(2, matchCount);
    }
    // Bonus for theme diversity (not in excluded set)
    if (!excludedThemes.has(c.primaryTheme)) {
      weight *= 1.5;
    }
    return { ...c, weight };
  });
}

export async function selectNextPhoto(searchTerms?: string): Promise<PhotoCandidate | null> {
  const allCandidates = await loadPhotoCandidates(classifyTheme);
  const terms = parseSearchTerms(searchTerms);
  const posts = await readPosts();
  const { themeLookback } = await readAppConfig();

  const usedFilenames = new Set(
    posts
      .filter(p => p.status === 'posted')
      .map(p => p.photoFilename)
  );

  let pool = allCandidates.filter(c => !usedFilenames.has(c.filename));
  if (pool.length === 0) return null;

  if (terms.length > 0) {
    const matched = pool.filter(c => countMatchingTerms(c, terms) > 0);
    console.log(`[PhotoSelector] Search "${searchTerms}" matched ${matched.length}/${pool.length} unused candidates`);
    if (matched.length === 0) return null;
    pool = matched;
  }

  const sortedPosts = [...posts].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const recentThemes = sortedPosts
    .slice(0, themeLookback)
    .map(p => p.primaryTheme);
  const excludedThemes = new Set<ThemeCategory>(recentThemes);

  const scored = buildScoredPool(pool, terms, excludedThemes);
  return weightedRandomSelect(scored);
}

export async function selectCandidatePhotos(count: number, searchTerms?: string): Promise<PhotoCandidate[]> {
  const allCandidates = await loadPhotoCandidates(classifyTheme);
  const terms = parseSearchTerms(searchTerms);
  const posts = await readPosts();
  const { themeLookback } = await readAppConfig();

  const usedFilenames = new Set(
    posts
      .filter(p => p.status === 'posted')
      .map(p => p.photoFilename)
  );

  let pool = allCandidates.filter(c => !usedFilenames.has(c.filename));
  if (pool.length === 0) return [];

  if (terms.length > 0) {
    const matched = pool.filter(c => countMatchingTerms(c, terms) > 0);
    console.log(`[PhotoSelector] Search "${searchTerms}" matched ${matched.length}/${pool.length} unused candidates`);
    if (matched.length === 0) return [];
    pool = matched;
  }

  const sortedPosts = [...posts].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const recentThemes = sortedPosts
    .slice(0, themeLookback)
    .map(p => p.primaryTheme);
  const excludedThemes = new Set<ThemeCategory>(recentThemes);

  const scored = buildScoredPool(pool, terms, excludedThemes);
  const selected: PhotoCandidate[] = [];
  const remaining = [...scored];

  while (selected.length < count && remaining.length > 0) {
    const pick = weightedRandomSelect(remaining);
    selected.push(pick);
    const idx = remaining.indexOf(pick);
    remaining.splice(idx, 1);
  }

  return selected;
}
