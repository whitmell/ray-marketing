import { Router } from 'express';
import { getPostViews, getPostView } from '../../services/pipeline.service';
import { loadPhotoCandidates, readPosts } from '../../data/store';
import { classifyTheme } from '../../services/theme.service';
import { readAppConfig } from '../../data/store';
import type { Post } from '../../data/types';

export function postsRouter(): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const status = (req.query.status as Post['status']) || 'pending';
    const posts = getPostViews(status);
    const allPosts = readPosts();
    const candidates = loadPhotoCandidates(classifyTheme);
    const usedCount = new Set(
      allPosts.filter(p => p.status === 'pending' || p.status === 'approved').map(p => p.photoFilename)
    ).size;
    const appConfig = readAppConfig();

    res.render('dashboard', {
      posts,
      activeTab: status,
      stats: {
        total: candidates.length,
        used: usedCount,
        remaining: candidates.length - usedCount,
        pending: allPosts.filter(p => p.status === 'pending').length,
        approved: allPosts.filter(p => p.status === 'approved').length,
        rejected: allPosts.filter(p => p.status === 'rejected').length,
        schedule: appConfig.pipelineCron,
      },
    });
  });

  router.get('/posts/:id', (req, res) => {
    const post = getPostView(req.params.id);
    if (!post) {
      return res.status(404).render('error', { message: 'Post not found' });
    }
    res.render('post-detail', { post });
  });

  return router;
}
