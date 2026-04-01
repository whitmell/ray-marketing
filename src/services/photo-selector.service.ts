import fs from 'fs';
import path from 'path';
import type { PhotoCandidate, ThemeCategory } from '../data/types';
import { readPosts, loadPhotoCandidates } from '../data/store';
import { classifyTheme } from './theme.service';
import { config } from '../config';

function photoFileExists(filename: string): boolean {
  return fs.existsSync(path.join(config.photosPath, filename));
}

export function selectNextPhoto(): PhotoCandidate | null {
  const candidates = loadPhotoCandidates(classifyTheme);
  const posts = readPosts();

  // Photos used in pending or approved posts are unavailable
  const usedFilenames = new Set(
    posts
      .filter(p => p.status === 'pending' || p.status === 'approved')
      .map(p => p.photoFilename)
  );

  const unused = candidates.filter(c => !usedFilenames.has(c.filename));
  if (unused.length === 0) return null;

  // Get recent themes to exclude (from most recent posts, any status)
  const sortedPosts = [...posts].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const recentThemes = sortedPosts
    .slice(0, config.themeLookback)
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

export function selectCandidatePhotos(count: number): PhotoCandidate[] {
  const candidates = loadPhotoCandidates(classifyTheme);
  const posts = readPosts();

  const usedFilenames = new Set(
    posts
      .filter(p => p.status === 'pending' || p.status === 'approved')
      .map(p => p.photoFilename)
  );

  const unused = candidates.filter(c => !usedFilenames.has(c.filename));
  if (unused.length === 0) return [];

  const sortedPosts = [...posts].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const recentThemes = sortedPosts
    .slice(0, config.themeLookback)
    .map(p => p.primaryTheme);
  const excludedThemes = new Set<ThemeCategory>(recentThemes);

  let pool = unused.filter(c => !excludedThemes.has(c.primaryTheme));

  if (pool.length === 0 && recentThemes.length > 0) {
    pool = unused.filter(c => c.primaryTheme !== recentThemes[0]);
  }

  if (pool.length === 0) {
    pool = unused;
  }

  // Shuffle and pick candidates that have image files on disk
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const selected: PhotoCandidate[] = [];
  for (const candidate of shuffled) {
    if (selected.length >= count) break;
    if (photoFileExists(candidate.filename)) {
      selected.push(candidate);
    } else {
      console.warn(`[PhotoSelector] Image file missing for "${candidate.filename}", skipping`);
    }
  }
  return selected;
}
