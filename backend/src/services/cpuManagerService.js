import pool from '../config/db.js';
import { randomInt } from '../utils/gameMath.js';
import { applyPlayerGrowth, generateProspectsForFranchise, upgradeAcademyWithPoints } from './youthService.js';

function maybe(probability) {
  return Math.random() < probability;
}

async function cpuSellPlayer(franchiseId, franchiseName, seasonId, dbClient = pool) {
  const candidates = await dbClient.query(
    `SELECT id, first_name, last_name
     FROM players
     WHERE franchise_id = $1
       AND squad_status IN ('MAIN_SQUAD', 'YOUTH')
     ORDER BY form ASC, morale ASC, market_value DESC
     LIMIT 5`,
    [franchiseId]
  );

  if (!candidates.rows.length) {
    return null;
  }

  const player = candidates.rows[randomInt(0, candidates.rows.length - 1)];

  await dbClient.query(
    `UPDATE players
     SET franchise_id = NULL,
         squad_status = 'AUCTION',
         on_loan_to_franchise_id = NULL,
         starting_xi = FALSE,
         lineup_slot = NULL
     WHERE id = $1`,
    [player.id]
  );

  const sourceName = franchiseName || `CPU club ${franchiseId}`;
  const message = `${player.first_name} ${player.last_name} was placed in the auction by ${sourceName}.`;

  await dbClient.query(
    `INSERT INTO transfer_feed (season_id, action_type, source_franchise_id, player_id, message)
     VALUES ($1, 'CPU_SELL', $2, $3, $4)`,
    [seasonId, franchiseId, player.id, message]
  );

  return message;
}

async function cpuBuyAuctionPlayer(franchiseId, franchiseName, seasonId, dbClient = pool) {
  const auctionPlayers = await dbClient.query(
    `SELECT id, first_name, last_name, market_value
     FROM players
     WHERE squad_status = 'AUCTION'
     ORDER BY market_value DESC
     LIMIT 12`
  );

  if (!auctionPlayers.rows.length) {
    return null;
  }

  const candidate = auctionPlayers.rows[randomInt(0, auctionPlayers.rows.length - 1)];

  const mainCount = await dbClient.query(
    `SELECT COUNT(*)::int AS count
     FROM players
     WHERE franchise_id = $1
       AND squad_status = 'MAIN_SQUAD'`,
    [franchiseId]
  );

  const targetStatus = Number(mainCount.rows[0].count) < 15 ? 'MAIN_SQUAD' : 'YOUTH';

  await dbClient.query(
    `UPDATE players
     SET franchise_id = $2,
         squad_status = $3,
         is_youth = CASE WHEN $3 = 'YOUTH' THEN TRUE ELSE FALSE END,
         starting_xi = FALSE,
         lineup_slot = NULL,
         morale = LEAST(100, morale + 4),
         form = LEAST(100, form + 3)
     WHERE id = $1`,
    [candidate.id, franchiseId, targetStatus]
  );

  const sourceName = franchiseName || `CPU club ${franchiseId}`;
  const message = `${candidate.first_name} ${candidate.last_name} was signed from auction by ${sourceName}.`;

  await dbClient.query(
    `INSERT INTO transfer_feed (season_id, action_type, source_franchise_id, player_id, message)
     VALUES ($1, 'CPU_BUY', $2, $3, $4)`,
    [seasonId, franchiseId, candidate.id, message]
  );

  return message;
}

async function cpuLoanRequest(franchiseId, franchiseName, seasonId, dbClient = pool) {
  const sourceFranchiseName = franchiseName || `CPU club ${franchiseId}`;
  const targetFranchise = await dbClient.query(
    `SELECT id, franchise_name
     FROM franchises
     WHERE id <> $1
       AND status = 'AI_CONTROLLED'
     ORDER BY random()
     LIMIT 1`,
    [franchiseId]
  );

  if (!targetFranchise.rows.length) {
    return null;
  }

  const targetId = targetFranchise.rows[0].id;
  const targetFranchiseName = targetFranchise.rows[0].franchise_name || `club ${targetId}`;

  const targetPlayers = await dbClient.query(
    `SELECT id, first_name, last_name
     FROM players
     WHERE franchise_id = $1
       AND squad_status = 'YOUTH'
     ORDER BY potential DESC
     LIMIT 6`,
    [targetId]
  );

  if (!targetPlayers.rows.length) {
    return null;
  }

  const player = targetPlayers.rows[randomInt(0, targetPlayers.rows.length - 1)];

  await dbClient.query(
    `UPDATE players
     SET squad_status = 'LOANED',
         on_loan_to_franchise_id = $2,
         starting_xi = FALSE,
         lineup_slot = NULL
     WHERE id = $1`,
    [player.id, franchiseId]
  );

  const message = `${sourceFranchiseName} secured a loan for ${player.first_name} ${player.last_name} from ${targetFranchiseName}.`;

  await dbClient.query(
    `INSERT INTO transfer_feed (season_id, action_type, source_franchise_id, target_franchise_id, player_id, message)
     VALUES ($1, 'LOAN_REQUEST', $2, $3, $4, $5)`,
    [seasonId, franchiseId, targetId, player.id, message]
  );

  return message;
}

async function logSeasonNote(seasonId, franchiseId, message, dbClient = pool) {
  await dbClient.query(
    `INSERT INTO transfer_feed (season_id, action_type, source_franchise_id, message)
     VALUES ($1, 'SEASON_NOTE', $2, $3)`,
    [seasonId, franchiseId, message]
  );
}

async function cpuDevelopmentCycle(franchiseId, seasonId, dbClient = pool) {
  const franchiseResult = await dbClient.query(
    `SELECT franchise_name, academy_level, youth_development_rating, prospect_points, growth_points
     FROM franchises
     WHERE id = $1`,
    [franchiseId]
  );

  if (!franchiseResult.rows.length) {
    return [];
  }

  const franchise = franchiseResult.rows[0];
  const franchiseName = franchise.franchise_name || `CPU club ${franchiseId}`;
  const actions = [];

  // CPU should actively spend stored points each cycle, with sensible caps per run.
  let state = {
    prospect: Number(franchise.prospect_points || 0),
    growth: Number(franchise.growth_points || 0),
    academy: Number(franchise.academy_level || 1),
    youth: Number(franchise.youth_development_rating || 20)
  };

  let academyUpgrades = 0;
  while (state.academy < 10 && academyUpgrades < 2) {
    try {
      const upgraded = await upgradeAcademyWithPoints(franchiseId, 'ACADEMY_LEVEL', dbClient);
      state.prospect = Number(upgraded.prospect_points || 0);
      state.academy = Number(upgraded.academy_level || state.academy);
      academyUpgrades += 1;
    } catch {
      break;
    }
  }

  if (academyUpgrades > 0) {
    const message = `${franchiseName} upgraded academy level to ${state.academy}.`;
    await logSeasonNote(seasonId, franchiseId, message, dbClient);
    actions.push(message);
  }

  let youthUpgrades = 0;
  while (state.youth < 100 && youthUpgrades < 2) {
    try {
      const upgraded = await upgradeAcademyWithPoints(franchiseId, 'YOUTH_RATING', dbClient);
      state.growth = Number(upgraded.growth_points || 0);
      state.youth = Number(upgraded.youth_development_rating || state.youth);
      youthUpgrades += 1;
    } catch {
      break;
    }
  }

  if (youthUpgrades > 0) {
    const message = `${franchiseName} improved youth development rating to ${state.youth.toFixed(1)}.`;
    await logSeasonNote(seasonId, franchiseId, message, dbClient);
    actions.push(message);
  }

  let prospectsGenerated = 0;
  while (prospectsGenerated < 1) {
    try {
      const generated = await generateProspectsForFranchise(franchiseId, seasonId, dbClient);
      prospectsGenerated += generated.length ? 1 : 0;
    } catch {
      break;
    }
  }

  if (prospectsGenerated > 0) {
    const message = `${franchiseName} generated a fresh youth prospect batch.`;
    await logSeasonNote(seasonId, franchiseId, message, dbClient);
    actions.push(message);
  }

  let growthCycles = 0;
  while (growthCycles < 3) {
    try {
      await applyPlayerGrowth(franchiseId, seasonId, dbClient);
      growthCycles += 1;
    } catch {
      break;
    }
  }

  if (growthCycles > 0) {
    const message = `${franchiseName} applied ${growthCycles} growth cycle${growthCycles > 1 ? 's' : ''} to its squad.`;
    await logSeasonNote(seasonId, franchiseId, message, dbClient);
    actions.push(message);
  }

  return actions;
}

export async function runCpuMarketCycle(seasonId, dbClient = pool) {
  const cpuTeams = await dbClient.query(
    `SELECT st.franchise_id, f.franchise_name
     FROM season_teams st
     JOIN franchises f ON f.id = st.franchise_id
     WHERE st.season_id = $1
       AND st.is_ai = TRUE
       AND f.owner_user_id IS NULL
       AND f.status = 'AI_CONTROLLED'
     ORDER BY random()
    `,
    [seasonId]
  );

  const actions = [];
  const transferTeams = cpuTeams.rows.slice(0, 20);

  for (const team of transferTeams) {
    const franchiseId = Number(team.franchise_id);
    const franchiseName = team.franchise_name;

    if (maybe(0.26)) {
      const action = await cpuSellPlayer(franchiseId, franchiseName, seasonId, dbClient);
      if (action) {
        actions.push(action);
      }
    }

    if (maybe(0.33)) {
      const action = await cpuBuyAuctionPlayer(franchiseId, franchiseName, seasonId, dbClient);
      if (action) {
        actions.push(action);
      }
    }

    if (maybe(0.18)) {
      const action = await cpuLoanRequest(franchiseId, franchiseName, seasonId, dbClient);
      if (action) {
        actions.push(action);
      }
    }
  }

  for (const team of cpuTeams.rows) {
    const franchiseId = Number(team.franchise_id);
    try {
      const developmentActions = await cpuDevelopmentCycle(franchiseId, seasonId, dbClient);
      if (developmentActions.length) {
        actions.push(...developmentActions);
      }
    } catch {
      // CPU development failures should not block the overall transfer cycle.
    }
  }

  return actions;
}

export async function getTransferFeed(limit = 100, dbClient = pool) {
  const feed = await dbClient.query(
    `SELECT tf.*, sf.franchise_name AS source_franchise_name, tf2.franchise_name AS target_franchise_name,
            p.first_name, p.last_name
     FROM transfer_feed tf
     LEFT JOIN franchises sf ON sf.id = tf.source_franchise_id
     LEFT JOIN franchises tf2 ON tf2.id = tf.target_franchise_id
     LEFT JOIN players p ON p.id = tf.player_id
     ORDER BY tf.created_at DESC
     LIMIT $1`,
    [limit]
  );

  return feed.rows;
}
