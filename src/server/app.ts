import express from 'express';
import path from 'path';
import { postsRouter } from './routes/posts';
import { apiPostsRouter } from './routes/api.posts';
import { apiPipelineRouter } from './routes/api.pipeline';
import { apiConfigRouter } from './routes/api.config';

export function createApp(): express.Application {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use('/', postsRouter());
  app.use('/api/posts', apiPostsRouter());
  app.use('/api/pipeline', apiPipelineRouter());
  app.use('/api/config', apiConfigRouter());

  return app;
}
