import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import app from './app.js';
import env from './config/env.js';
import pool from './config/db.js';
import { ensureSchemaCompatibility } from './db/ensureSchemaCompatibility.js';
import { seedWorldCities } from './db/seedWorldCities.js';
import { releaseInactiveFranchises, startInactivityScheduler } from './services/inactivityService.js';
import { bootstrapGameWorld } from './services/bootstrapService.js';
import { createRealtimeServer, broadcast } from './ws/realtime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const server = createServer(app);
createRealtimeServer(server);

server.listen(env.port, async () => {
  console.log(`Global T20 API listening on http://localhost:${env.port}`);

  try {
    // Auto-init DB on first boot: if the users table doesn't exist, run full schema + seed
    const tableCheck = await pool.query(
      `SELECT to_regclass('public.users') AS users_table`
    );
    if (!tableCheck.rows[0]?.users_table) {
      console.log('First boot detected — initializing database...');
      const schemaPath = path.join(__dirname, 'db', 'schema.sql');
      const seedPath = path.join(__dirname, 'db', 'seed.sql');
      const schemaSql = await fs.readFile(schemaPath, 'utf-8');
      const seedSql = await fs.readFile(seedPath, 'utf-8');
      await pool.query(schemaSql);
      console.log('Schema applied.');
      await pool.query(seedSql);
      console.log('Seed data applied.');
      const cityCount = await seedWorldCities(pool);
      console.log(`Seeded ${cityCount} world cities.`);
    }

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
