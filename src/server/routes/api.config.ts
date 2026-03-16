import { Router } from 'express';
import { readAppConfig, writeAppConfig } from '../../data/store';
import { restartScheduler } from '../../scheduler/cron';
import cron from 'node-cron';

export function apiConfigRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(readAppConfig());
  });

  router.put('/schedule', (req, res) => {
    const { pipelineCron } = req.body;
    if (!pipelineCron || !cron.validate(pipelineCron)) {
      return res.status(400).json({ error: 'Invalid cron expression' });
    }

    const appConfig = readAppConfig();
    appConfig.pipelineCron = pipelineCron;
    writeAppConfig(appConfig);
    restartScheduler(pipelineCron);

    res.json({ success: true, config: appConfig });
  });

  return router;
}
