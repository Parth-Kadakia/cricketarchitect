import { createServer } from 'node:http';
import app from './app.js';
import env from './config/env.js';
import { ensureSchemaCompatibility } from './db/ensureSchemaCompatibility.js';
import { releaseInactiveFranchises, startInactivityScheduler } from './services/inactivityService.js';
import { bootstrapGameWorld } from './services/bootstrapService.js';
import { createRealtimeServer, broadcast } from './ws/realtime.js';

const server = createServer(app);
createRealtimeServer(server);

server.listen(env.port, async () => {
  console.log(`Global T20 API listening on http://localhost:${env.port}`);

  try {
    await ensureSchemaCompatibility();
    await bootstrapGameWorld();

    const released = await releaseInactiveFranchises();
    if (released.length) {
      broadcast('market:update', { released }, 'marketplace');
    }
  } catch (error) {
    console.error('Initial inactivity release check failed', error);
  }

  startInactivityScheduler({
    intervalMinutes: env.inactivityCheckIntervalMinutes,
    onRelease: (released) => broadcast('market:update', { released }, 'marketplace')
  });
});
