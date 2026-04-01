import { Router } from 'express';
import { updatePostStatus, updatePostCaption, regeneratePost, selectCandidate, publishPost, getPostView } from '../../services/pipeline.service';

export function apiPostsRouter(): Router {
  const router = Router();

  router.post('/:id/approve', async (req, res) => {
    try {
      const post = await updatePostStatus(req.params.id, 'approved', req.body.notes);
      if (!post) {
        return res.status(404).json({ error: 'Post not found or not pending' });
      }
      res.json({ success: true, post });
    } catch (error) {
      console.error('[API] Approve failed:', error);
      res.status(500).json({ error: 'Approval failed' });
    }
  });

  router.post('/:id/reject', async (req, res) => {
    try {
      const post = await updatePostStatus(req.params.id, 'rejected', req.body.notes);
      if (!post) {
        return res.status(404).json({ error: 'Post not found or not pending' });
      }
      res.json({ success: true, post });
    } catch (error) {
      console.error('[API] Reject failed:', error);
      res.status(500).json({ error: 'Rejection failed' });
    }
  });

  router.put('/:id/caption', (req, res) => {
    const { caption } = req.body;
    if (!caption || typeof caption !== 'string' || !caption.trim()) {
      return res.status(400).json({ error: 'Caption is required' });
    }
    const post = updatePostCaption(req.params.id, caption.trim());
    if (!post) {
      return res.status(404).json({ error: 'Post not found or not pending' });
    }
    res.json({ success: true, post });
  });

  router.post('/:id/publish', async (req, res) => {
    try {
      const { platforms } = req.body;
      if (!Array.isArray(platforms) || platforms.length === 0) {
        return res.status(400).json({ error: 'platforms array is required' });
      }

      const validPlatforms = platforms.filter(
        (p: string): p is 'facebook' | 'instagram' =>
          p === 'facebook' || p === 'instagram'
      );
      if (validPlatforms.length === 0) {
        return res.status(400).json({ error: 'No valid platforms specified' });
      }

      const post = await publishPost(req.params.id, validPlatforms);
      if (!post) {
        return res.status(404).json({ error: 'Post not found or not approved' });
      }
      res.json({ success: true, post });
    } catch (error) {
      console.error('[API] Publish failed:', error);
      res.status(500).json({ error: 'Publishing failed' });
    }
  });

  router.post('/:id/select-candidate', async (req, res) => {
    try {
      const { filename } = req.body;
      if (!filename || typeof filename !== 'string') {
        return res.status(400).json({ error: 'filename is required' });
      }
      const post = await selectCandidate(req.params.id, filename);
      if (!post) {
        return res.status(404).json({ error: 'Post not found, not pending, or candidate not found' });
      }
      res.json({ success: true, post });
    } catch (error) {
      console.error('[API] Select candidate failed:', error);
      res.status(500).json({ error: 'Caption generation failed' });
    }
  });

  router.post('/:id/regenerate', async (req, res) => {
    try {
      const newPost = await regeneratePost(req.params.id);
      if (!newPost) {
        return res.status(404).json({ error: 'Post not found' });
      }
      res.json({ success: true, post: newPost });
    } catch (error) {
      console.error('[API] Regenerate failed:', error);
      res.status(500).json({ error: 'Caption generation failed' });
    }
  });

  return router;
}
