import { Router } from 'express';
import { loadPhotoCandidates, readPosts } from '../../data/store';
import { classifyTheme } from '../../services/theme.service';

export function apiPhotosRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    try {
      const candidates = loadPhotoCandidates(classifyTheme);
      const posts = readPosts();
      const usedFilenames = new Set(
        posts
          .filter(p => p.status === 'pending' || p.status === 'approved')
          .map(p => p.photoFilename)
      );

      const list = candidates
        .map(c => ({
          filename: c.filename,
          title: c.title,
          tags: c.tags,
          primaryTheme: c.primaryTheme,
          faaUrl: c.faaUrl,
          used: usedFilenames.has(c.filename),
        }))
        .sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));

      res.json(list);
    } catch (error) {
      console.error('[API] Photos list failed:', error);
      res.status(500).json({ error: 'Failed to load photos' });
    }
  });

  return router;
}
