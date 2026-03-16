import cron from 'node-cron';
import { runPipeline } from '../services/pipeline.service';
import { readAppConfig } from '../data/store';

let task: cron.ScheduledTask | null = null;

export function startScheduler(cronExpression?: string): void {
  const schedule = cronExpression || readAppConfig().pipelineCron;

  if (!cron.validate(schedule)) {
    throw new Error(`Invalid cron expression: ${schedule}`);
  }

  stopScheduler();

  task = cron.schedule(schedule, async () => {
    console.log(`[Scheduler] Pipeline triggered at ${new Date().toISOString()}`);
    try {
      const post = await runPipeline();
      if (post) {
        console.log(`[Scheduler] Post ${post.id} created: "${post.photoTitle}"`);
      } else {
        console.log('[Scheduler] No photos available for pipeline');
      }
    } catch (error) {
      console.error('[Scheduler] Pipeline failed:', error);
    }
  }, {
    timezone: readAppConfig().timezone,
  });

  console.log(`[Scheduler] Started with schedule: ${schedule}`);
}

export function stopScheduler(): void {
  if (task) {
    task.stop();
    task = null;
  }
}

export function restartScheduler(cronExpression: string): void {
  stopScheduler();
  startScheduler(cronExpression);
}
