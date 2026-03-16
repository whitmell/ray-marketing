import { config } from './config';
import { loadPhotoCandidates } from './data/store';
import { classifyTheme } from './services/theme.service';
import { createApp } from './server/app';
import { startScheduler } from './scheduler/cron';

function main(): void {
  // Load and classify photo candidates from resource files
  const candidates = loadPhotoCandidates(classifyTheme);
  console.log(`[Init] Loaded ${candidates.length} candidate photos`);

  // Log theme distribution
  const themeCounts: Record<string, number> = {};
  for (const c of candidates) {
    themeCounts[c.primaryTheme] = (themeCounts[c.primaryTheme] || 0) + 1;
  }
  console.log('[Init] Theme distribution:', themeCounts);

  // Start web server
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`[Server] Running on http://localhost:${config.port}`);
  });

  // Start scheduler
  startScheduler();
}

main();
