import { Pool } from 'pg';
import env from './env.js';

const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: env.nodeEnv === 'production' ? { rejectUnauthorized: false } : false
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL error', error);
});

export async function withTransaction(task) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await task(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export default pool;
