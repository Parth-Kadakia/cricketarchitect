import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pool from '../config/db.js';
import { seedWorldCities } from './seedWorldCities.js';
import { bootstrapGameWorld } from '../services/bootstrapService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const seedPath = path.join(__dirname, 'seed.sql');

  const schemaSql = await fs.readFile(schemaPath, 'utf-8');
  const seedSql = await fs.readFile(seedPath, 'utf-8');

  console.log('Applying schema...');
  await pool.query(schemaSql);
  console.log('Applying seed data...');
  await pool.query(seedSql);
  console.log('Seeding global city catalog...');
  const cityCount = await seedWorldCities(pool);
  console.log(`Inserted ${cityCount} world cities.`);
  console.log('Bootstrapping game world...');
  await bootstrapGameWorld(pool);

  console.log('Database initialization complete.');
}

run()
  .catch((error) => {
    console.error('Database initialization failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
