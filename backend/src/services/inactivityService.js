import pool from '../config/db.js';
import { handleManagerInactivityRelease } from './managerCareerService.js';

let inactivityIntervalRef = null;

export async function releaseInactiveFranchises(dbClient = pool) {
  const inactiveOwners = await dbClient.query(
    `SELECT u.id AS user_id, u.email, f.id AS franchise_id
     FROM users u
     JOIN franchises f ON f.owner_user_id = u.id
     WHERE u.last_active_at < NOW() - INTERVAL '6 months'`
  );

  const released = [];

  for (const owner of inactiveOwners.rows) {
    await dbClient.query(
      `UPDATE players
       SET franchise_id = NULL,
           squad_status = 'AUCTION',
           on_loan_to_franchise_id = NULL,
           morale = 45
       WHERE franchise_id = $1`,
      [owner.franchise_id]
    );

    await dbClient.query(
      `UPDATE franchises
       SET owner_user_id = NULL,
           status = 'AVAILABLE',
           listed_for_sale_at = NULL,
           fan_rating = GREATEST(20, fan_rating - 8)
       WHERE id = $1`,
      [owner.franchise_id]
    );

    await handleManagerInactivityRelease({
      userId: Number(owner.user_id),
      franchiseId: Number(owner.franchise_id),
      dbClient
    });

    await dbClient.query(
      `INSERT INTO transactions (franchise_id, transaction_type, amount, description)
       VALUES ($1, 'SALE', 0, 'Franchise auto-released due to owner inactivity > 6 months')`,
      [owner.franchise_id]
    );

    released.push({
      userId: owner.user_id,
      email: owner.email,
      franchiseId: owner.franchise_id
    });
  }

  return released;
}

export function startInactivityScheduler({ intervalMinutes, onRelease }) {
  if (inactivityIntervalRef) {
    clearInterval(inactivityIntervalRef);
  }

  inactivityIntervalRef = setInterval(async () => {
    try {
      const released = await releaseInactiveFranchises();
      if (released.length && typeof onRelease === 'function') {
        onRelease(released);
      }
    } catch (error) {
      console.error('Inactivity scheduler failed', error);
    }
  }, intervalMinutes * 60 * 1000);

  return inactivityIntervalRef;
}

export function stopInactivityScheduler() {
  if (inactivityIntervalRef) {
    clearInterval(inactivityIntervalRef);
  }
}
