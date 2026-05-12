import { Router } from 'express';
import { runPipeline, createPostFromPhoto } from '../../services/pipeline.service';

export function apiPipelineRouter(): Router {
  const router = Router();

  router.post('/run', async (req, res) => {
    try {
      const searchTerms = req.body?.searchTerms as string | undefined;
      const post = await runPipeline(searchTerms);
      if (!post) {
        return res.status(404).json({ error: 'No unused photos available' });
      }
      res.json({ success: true, post });
    } catch (error) {
      console.error('[API] Pipeline run failed:', error);
      res.status(500).json({ error: 'Pipeline execution failed' });
    }
  });

  router.post('/pick', async (req, res) => {
    try {
      const filename = req.body?.filename;
      if (typeof filename !== 'string' || filename.trim().length === 0) {
        return res.status(400).json({ error: 'filename required' });
      }
      const post = await createPostFromPhoto(filename);
      if (!post) {
        return res.status(400).json({ error: 'Photo not found' });
      }
      res.json({ success: true, post });
    } catch (error) {
      console.error('[API] Pipeline pick failed:', error);
      res.status(500).json({ error: 'Pipeline execution failed' });
    }
  });

  return router;
}
