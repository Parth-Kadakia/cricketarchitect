import pool from '../config/db.js';
import { CAREER_MODES, normalizeCareerMode } from '../constants/gameModes.js';
import { buildNameKey, pickUniquePlayerName } from './nameService.js';

export const MANAGER_STATUSES = {
  ACTIVE: 'ACTIVE',
  UNEMPLOYED: 'UNEMPLOYED',
  RETIRED: 'RETIRED'
};

const OFFER_STATUSES = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  EXPIRED: 'EXPIRED',
  WITHDRAWN: 'WITHDRAWN'
};

const CHECKPOINT_INTERVAL_ROUNDS = 3;
const APPLY_MARKET_UNLOCK_ROUNDS = 1;
const MIN_OFFERS = 3;
const MAX_OFFERS = 6;
const XP_PER_LEVEL = 120;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (Math.max(min, max) - Math.min(min, max) + 1)) + Math.min(min, max);
}

function normalizeEndReason(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) {
    return 'RESIGNED';
  }
  return normalized;
}

function normalizeObjectiveStatus(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'].includes(normalized)) {
    return normalized;
  }
  return 'PENDING';
}

async function getUserRow(userId, dbClient = pool) {
  const userResult = await dbClient.query(
    `SELECT id,
            career_mode,
            manager_status,
            manager_points,
            manager_unemployed_since,
            manager_retired_at,
            manager_matches_managed,
            manager_wins_managed,
            manager_losses_managed
     FROM users
     WHERE id = $1`,
    [userId]
  );

  return userResult.rows[0] || null;
}

async function getActiveSeasonInfo(dbClient = pool, worldId = null) {
  const result = await dbClient.query(
    `SELECT id, competition_mode, league_count, teams_per_league, status
     FROM seasons
     WHERE status = 'ACTIVE'
       AND ($1::bigint IS NULL OR world_id = $1)
     ORDER BY id DESC
     LIMIT 1`,
    [worldId]
  );

  return result.rows[0] || null;
}

async function getCurrentRegularRound(seasonId, dbClient = pool) {
  if (!seasonId) {
    return 0;
  }

  const result = await dbClient.query(
    `SELECT COALESCE(MAX(round_no), 0)::int AS round_no
     FROM matches
     WHERE season_id = $1
       AND stage = 'REGULAR'
       AND status = 'COMPLETED'`,
    [seasonId]
  );

  return Number(result.rows[0]?.round_no || 0);
}

async function getLatestManagerStint(userId, dbClient = pool) {
  const result = await dbClient.query(
    `SELECT id,
            franchise_id,
            competition_mode,
            started_at,
            ended_at,
            end_reason,
            matches_managed,
            wins,
            losses
     FROM manager_stints
     WHERE user_id = $1
     ORDER BY started_at DESC, id DESC
     LIMIT 1`,
    [userId]
  );

  return result.rows[0] || null;
}

async function getManagedFranchise(userId, dbClient = pool, worldId = null) {
  const result = await dbClient.query(
    `SELECT id, competition_mode, current_league_tier
     FROM franchises
     WHERE owner_user_id = $1
       AND ($2::bigint IS NULL OR world_id = $2)
     LIMIT 1`,
    [userId, worldId]
  );

  return result.rows[0] || null;
}

async function getManagerEntityByUserId(userId, dbClient = pool) {
  const result = await dbClient.query(
    `SELECT id,
            user_id,
            display_name,
            nationality,
            competition_mode,
            is_cpu,
            level,
            xp,
            reputation,
            seasons_managed,
            matches_managed,
            wins_managed,
            losses_managed,
            titles_won
     FROM managers
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );

  return result.rows[0] || null;
}

async function ensureHumanManagerEntity(userId, dbClient = pool, worldId = null) {
  const userResult = await dbClient.query(
    `SELECT id, display_name, career_mode, active_world_id
     FROM users
     WHERE id = $1`,
    [userId]
  );
  if (!userResult.rows.length) {
    return null;
  }

  const user = userResult.rows[0];
  const resolvedWorldId = worldId || user.active_world_id || null;
  const normalizedMode = normalizeCareerMode(user.career_mode || CAREER_MODES.CLUB);
  const existing = await getManagerEntityByUserId(userId, dbClient);
  if (existing) {
    const needsSync =
      String(existing.display_name || '') !== String(user.display_name || '') ||
      normalizeCareerMode(existing.competition_mode || CAREER_MODES.CLUB) !== normalizedMode ||
      Boolean(existing.is_cpu);

    if (!needsSync) {
      return existing;
    }

    const synced = await dbClient.query(
      `UPDATE managers
       SET display_name = $2,
           competition_mode = $3,
           is_cpu = FALSE,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id,
                 user_id,
                 display_name,
                 nationality,
                 competition_mode,
                 is_cpu,
                 level,
                 xp,
                 reputation,
                 seasons_managed,
                 matches_managed,
                 wins_managed,
                 losses_managed,
                 titles_won`,
      [existing.id, user.display_name, normalizedMode]
    );

    return synced.rows[0] || existing;
  }

  const inserted = await dbClient.query(
    `INSERT INTO managers (user_id, display_name, competition_mode, is_cpu, world_id, level, xp, reputation)
     VALUES ($1, $2, $3, FALSE, $4, 1, 0, 10)
     RETURNING id,
               user_id,
               display_name,
               nationality,
               competition_mode,
               is_cpu,
               level,
               xp,
               reputation,
               seasons_managed,
               matches_managed,
               wins_managed,
               losses_managed,
               titles_won`,
    [user.id, user.display_name, normalizedMode, resolvedWorldId]
  );

  return inserted.rows[0];
}

async function buildUsedManagerNameKeySet(dbClient = pool, worldId = null) {
  const rows = await dbClient.query(
    `SELECT display_name
     FROM managers
     WHERE ($1::bigint IS NULL OR world_id = $1)`,
    [worldId]
  );
  const set = new Set();
  for (const row of rows.rows) {
    const value = String(row.display_name || '').trim();
    if (!value) {
      continue;
    }
    const parts = value.split(' ');
    if (parts.length >= 2) {
      set.add(buildNameKey(parts.slice(0, -1).join(' '), parts[parts.length - 1]));
    } else {
      set.add(value.toLowerCase());
    }
  }
  return set;
}

function managerLevelThreshold(level) {
  return Math.max(80, Number(level || 1) * XP_PER_LEVEL);
}

async function applyManagerXp({ managerId, xpDelta = 0, reputationDelta = 0, dbClient = pool }) {
  const managerResult = await dbClient.query(
    `SELECT id, level, xp, reputation
     FROM managers
     WHERE id = $1
     FOR UPDATE`,
    [managerId]
  );
  if (!managerResult.rows.length) {
    return null;
  }

  let level = Number(managerResult.rows[0].level || 1);
  let xp = Number(managerResult.rows[0].xp || 0) + Math.max(0, Number(xpDelta || 0));
  const reputation = clamp(Number(managerResult.rows[0].reputation || 50) + Number(reputationDelta || 0), 0, 100);

  while (level < 100 && xp >= managerLevelThreshold(level)) {
    xp -= managerLevelThreshold(level);
    level += 1;
  }

  const updated = await dbClient.query(
    `UPDATE managers
     SET level = $2,
         xp = $3,
         reputation = $4,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, level, xp, reputation`,
    [managerId, level, xp, reputation]
  );

  return updated.rows[0] || null;
}

async function closeActiveManagerTeamStint(franchiseId, endReason, dbClient = pool) {
  await dbClient.query(
    `UPDATE manager_team_stints
     SET ended_at = NOW(),
         end_reason = $2,
         updated_at = NOW()
     WHERE franchise_id = $1
       AND ended_at IS NULL`,
    [franchiseId, normalizeEndReason(endReason)]
  );
}

async function ensureActiveManagerTeamStint({ managerId, franchiseId, competitionMode, seasonId = null, dbClient = pool }) {
  // Check if this franchise already has an active stint
  const existing = await dbClient.query(
    `SELECT id, manager_id
     FROM manager_team_stints
     WHERE franchise_id = $1
       AND ended_at IS NULL
     LIMIT 1`,
    [franchiseId]
  );
  if (existing.rows.length) {
    // If the existing stint is for the same manager, reuse it
    if (Number(existing.rows[0].manager_id) === Number(managerId)) {
      return Number(existing.rows[0].id);
    }
    // Otherwise close the stale franchise stint first
    await dbClient.query(
      `UPDATE manager_team_stints
       SET ended_at = NOW(), end_reason = 'REPLACED', updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id]
    );
  }

  // Close any existing active stint this manager has at another franchise
  await dbClient.query(
    `UPDATE manager_team_stints
     SET ended_at = NOW(), end_reason = 'TRANSFERRED', updated_at = NOW()
     WHERE manager_id = $1
       AND ended_at IS NULL`,
    [managerId]
  );

  try {
    const inserted = await dbClient.query(
      `INSERT INTO manager_team_stints (
         manager_id,
         franchise_id,
         competition_mode,
         season_id,
         started_at,
         matches_managed,
         wins,
         losses
       ) VALUES ($1, $2, $3, $4, NOW(), 0, 0, 0)
       RETURNING id`,
      [managerId, franchiseId, normalizeCareerMode(competitionMode || CAREER_MODES.CLUB), seasonId]
    );
    return Number(inserted.rows[0].id);
  } catch (err) {
    // Handle race condition: another concurrent call already inserted a stint
    if (err.code === '23505') {
      const fallback = await dbClient.query(
        `SELECT id FROM manager_team_stints
         WHERE manager_id = $1 AND ended_at IS NULL
         LIMIT 1`,
        [managerId]
      );
      if (fallback.rows.length) {
        return Number(fallback.rows[0].id);
      }
    }
    throw err;
  }
}

async function createCpuManager({ country, competitionMode, usedNameKeys, worldId = null, dbClient = pool }) {
  const MAX_NAME_RETRIES = 10;
  for (let attempt = 0; attempt < MAX_NAME_RETRIES; attempt += 1) {
    const name = pickUniquePlayerName(country || 'Global', usedNameKeys, { strictCountry: true });
    const displayName = `${name.firstName} ${name.lastName}`.trim();
    try {
      const inserted = await dbClient.query(
        `INSERT INTO managers (
           user_id,
           display_name,
           nationality,
           competition_mode,
           is_cpu,
           world_id,
           level,
           xp,
           reputation
         ) VALUES (NULL, $1, $2, $3, TRUE, $4, $5, 0, $6)
         RETURNING id,
                   user_id,
                   display_name,
                   nationality,
                   competition_mode,
                   is_cpu,
                   level,
                   xp,
                   reputation,
                   seasons_managed,
                   matches_managed,
                   wins_managed,
                   losses_managed,
                   titles_won`,
        [
          displayName,
          country || null,
          normalizeCareerMode(competitionMode || CAREER_MODES.CLUB),
          worldId,
          1,
          10
        ]
      );
      return inserted.rows[0];
    } catch (err) {
      // Retry on duplicate display_name constraint violation
      if (err.code === '23505' && String(err.constraint || '').includes('managers_cpu_display_name')) {
        continue;
      }
      throw err;
    }
  }
  // Final fallback: append a random suffix to guarantee uniqueness
  const fallbackName = pickUniquePlayerName(country || 'Global', usedNameKeys, { strictCountry: true });
  const fallbackDisplay = `${fallbackName.firstName} ${fallbackName.lastName} ${randomInt(100, 999)}`.trim();
  const inserted = await dbClient.query(
    `INSERT INTO managers (
       user_id,
       display_name,
       nationality,
       competition_mode,
       is_cpu,
       world_id,
       level,
       xp,
       reputation
     ) VALUES (NULL, $1, $2, $3, TRUE, $4, $5, 0, $6)
     RETURNING id,
               user_id,
               display_name,
               nationality,
               competition_mode,
               is_cpu,
               level,
               xp,
               reputation,
               seasons_managed,
               matches_managed,
               wins_managed,
               losses_managed,
               titles_won`,
    [
      fallbackDisplay,
      country || null,
      normalizeCareerMode(competitionMode || CAREER_MODES.CLUB),
      worldId,
      1,
      10
    ]
  );
  return inserted.rows[0];
}

async function assignManagerToFranchise({ managerId, franchiseId, competitionMode, seasonId = null, endReason = 'REPLACED', dbClient = pool }) {
  const franchiseResult = await dbClient.query(
    `SELECT current_manager_id
     FROM franchises
     WHERE id = $1
     FOR UPDATE`,
    [franchiseId]
  );

  if (!franchiseResult.rows.length) {
    return null;
  }

  const currentManagerId = Number(franchiseResult.rows[0].current_manager_id || 0) || null;
  if (currentManagerId && currentManagerId !== Number(managerId)) {
    await closeActiveManagerTeamStint(franchiseId, endReason, dbClient);
  }

  // Unassign this manager from any OTHER franchise they are currently managing
  await dbClient.query(
    `UPDATE franchises
     SET current_manager_id = NULL
     WHERE current_manager_id = $1
       AND id <> $2`,
    [managerId, franchiseId]
  );

  // Close any active stint the manager has at another franchise
  await dbClient.query(
    `UPDATE manager_team_stints
     SET ended_at = NOW(), end_reason = 'TRANSFERRED', updated_at = NOW()
     WHERE manager_id = $1
       AND franchise_id <> $2
       AND ended_at IS NULL`,
    [managerId, franchiseId]
  );

  await dbClient.query(
    `UPDATE franchises
     SET current_manager_id = $2
     WHERE id = $1`,
    [franchiseId, managerId]
  );

  await ensureActiveManagerTeamStint({
    managerId,
    franchiseId,
    competitionMode,
    seasonId,
    dbClient
  });

  return managerId;
}

async function getFranchiseManagerSummary(franchiseId, dbClient = pool) {
  const result = await dbClient.query(
    `SELECT f.id AS franchise_id,
            f.competition_mode,
            c.country,
            f.current_manager_id,
            m.display_name AS manager_name,
            m.is_cpu AS manager_is_cpu,
            m.level AS manager_level,
            m.reputation AS manager_reputation
     FROM franchises f
     JOIN cities c ON c.id = f.city_id
     LEFT JOIN managers m ON m.id = f.current_manager_id
     WHERE f.id = $1`,
    [franchiseId]
  );
  return result.rows[0] || null;
}

async function ensureCpuManagerForFranchise({ franchiseId, competitionMode, country, seasonId = null, worldId = null, dbClient = pool, usedNameKeys = null }) {
  const summary = await getFranchiseManagerSummary(franchiseId, dbClient);
  if (!summary) {
    return null;
  }

  /* derive worldId from franchise when not provided */
  const resolvedWorldId = worldId || (await (async () => {
    const wRow = await dbClient.query('SELECT world_id FROM franchises WHERE id = $1', [franchiseId]);
    return wRow.rows[0]?.world_id || null;
  })());

  let needsReplacement =
    !summary.current_manager_id ||
    (summary.current_manager_id && summary.manager_is_cpu === false);

  // Also check: is the current manager already assigned to a different franchise?
  if (!needsReplacement && summary.current_manager_id) {
    const otherFranchise = await dbClient.query(
      `SELECT id FROM franchises
       WHERE current_manager_id = $1 AND id <> $2
       LIMIT 1`,
      [summary.current_manager_id, franchiseId]
    );
    if (otherFranchise.rows.length) {
      // This manager is shared — detach from this franchise and assign a new one
      await dbClient.query(
        `UPDATE franchises SET current_manager_id = NULL WHERE id = $1`,
        [franchiseId]
      );
      needsReplacement = true;
    }
  }

  if (!needsReplacement) {
    await ensureActiveManagerTeamStint({
      managerId: Number(summary.current_manager_id),
      franchiseId: Number(franchiseId),
      competitionMode: normalizeCareerMode(competitionMode || summary.competition_mode || CAREER_MODES.CLUB),
      seasonId,
      dbClient
    });
    return Number(summary.current_manager_id);
  }

  const poolKeys = usedNameKeys || (await buildUsedManagerNameKeySet(dbClient, resolvedWorldId));
  // Also exclude managers still set as current_manager_id on any franchise
  const candidate = await dbClient.query(
    `SELECT m.id
     FROM managers m
     LEFT JOIN manager_team_stints mts ON mts.manager_id = m.id AND mts.ended_at IS NULL
     LEFT JOIN franchises f ON f.current_manager_id = m.id
     WHERE m.is_cpu = TRUE
       AND m.competition_mode = $1
       AND ($2::bigint IS NULL OR m.world_id = $2)
       AND mts.id IS NULL
       AND f.id IS NULL
     ORDER BY m.reputation DESC, m.level DESC, m.id ASC
     LIMIT 1
     FOR UPDATE OF m SKIP LOCKED`,
    [normalizeCareerMode(competitionMode || summary.competition_mode || CAREER_MODES.CLUB), resolvedWorldId]
  );

  let managerId = candidate.rows[0]?.id ? Number(candidate.rows[0].id) : null;
  if (!managerId) {
    const created = await createCpuManager({
      country: country || summary.country || 'Global',
      competitionMode: normalizeCareerMode(competitionMode || summary.competition_mode || CAREER_MODES.CLUB),
      usedNameKeys: poolKeys,
      worldId: resolvedWorldId,
      dbClient
    });
    managerId = Number(created.id);
  }

  await assignManagerToFranchise({
    managerId,
    franchiseId: Number(franchiseId),
    competitionMode: normalizeCareerMode(competitionMode || summary.competition_mode || CAREER_MODES.CLUB),
    seasonId,
    endReason: 'REPLACED',
    dbClient
  });

  return managerId;
}

export async function ensureFranchiseManagers(dbClient = pool, worldId = null) {
  const season = await getActiveSeasonInfo(dbClient, worldId);
  const seasonId = season?.id ? Number(season.id) : null;
  const usedNameKeys = await buildUsedManagerNameKeySet(dbClient, worldId);

  const franchises = await dbClient.query(
    `SELECT f.id,
            f.owner_user_id,
            f.current_manager_id,
            f.competition_mode,
            c.country
     FROM franchises f
     JOIN cities c ON c.id = f.city_id
     WHERE ($1::bigint IS NULL OR f.world_id = $1)
     ORDER BY f.id ASC`,
    [worldId]
  );

  for (const franchise of franchises.rows) {
    const franchiseId = Number(franchise.id);
    const mode = normalizeCareerMode(franchise.competition_mode || CAREER_MODES.CLUB);
    if (franchise.owner_user_id) {
      const humanManager = await ensureHumanManagerEntity(Number(franchise.owner_user_id), dbClient);
      if (humanManager) {
        await assignManagerToFranchise({
          managerId: Number(humanManager.id),
          franchiseId,
          competitionMode: mode,
          seasonId,
          endReason: 'REPLACED',
          dbClient
        });
      }
    } else {
      await ensureCpuManagerForFranchise({
        franchiseId,
        competitionMode: mode,
        country: franchise.country,
        seasonId,
        dbClient,
        usedNameKeys
      });
    }
  }

  // Safety pass: verify every franchise now has a manager
  const unmanaged = await dbClient.query(
    `SELECT f.id, f.competition_mode, c.country
     FROM franchises f
     JOIN cities c ON c.id = f.city_id
     WHERE f.current_manager_id IS NULL
       AND ($1::bigint IS NULL OR f.world_id = $1)
     ORDER BY f.id ASC`,
    [worldId]
  );
  if (unmanaged.rows.length) {
    console.warn(`[ManagerCareer] ${unmanaged.rows.length} franchise(s) still without a manager after initial pass — fixing now`);
    const freshKeys = await buildUsedManagerNameKeySet(dbClient, worldId);
    for (const row of unmanaged.rows) {
      await ensureCpuManagerForFranchise({
        franchiseId: Number(row.id),
        competitionMode: normalizeCareerMode(row.competition_mode || CAREER_MODES.CLUB),
        country: row.country,
        seasonId,
        worldId,
        dbClient,
        usedNameKeys: freshKeys
      });
    }
  }
}

async function ensureManagerForFranchiseId(franchiseId, seasonId = null, dbClient = pool) {
  const franchiseResult = await dbClient.query(
    `SELECT f.id,
            f.owner_user_id,
            f.competition_mode,
            c.country
     FROM franchises f
     JOIN cities c ON c.id = f.city_id
     WHERE f.id = $1`,
    [franchiseId]
  );

  if (!franchiseResult.rows.length) {
    return null;
  }

  const franchise = franchiseResult.rows[0];
  const mode = normalizeCareerMode(franchise.competition_mode || CAREER_MODES.CLUB);
  if (franchise.owner_user_id) {
    const manager = await ensureHumanManagerEntity(Number(franchise.owner_user_id), dbClient);
    if (!manager) {
      return null;
    }
    await assignManagerToFranchise({
      managerId: Number(manager.id),
      franchiseId: Number(franchise.id),
      competitionMode: mode,
      seasonId,
      endReason: 'REPLACED',
      dbClient
    });
    return Number(manager.id);
  }

  return ensureCpuManagerForFranchise({
    franchiseId: Number(franchise.id),
    competitionMode: mode,
    country: franchise.country,
    seasonId,
    dbClient
  });
}

async function releaseFranchiseOwnership(franchiseId, dbClient = pool) {
  if (!franchiseId) {
    return;
  }

  await dbClient.query(
    `UPDATE franchises
     SET owner_user_id = NULL,
         status = 'AI_CONTROLLED',
         listed_for_sale_at = NULL,
         win_streak = 0
     WHERE id = $1`,
    [franchiseId]
  );

  await dbClient.query(
    `UPDATE season_teams
     SET is_ai = TRUE
     WHERE franchise_id = $1
       AND season_id IN (
         SELECT id FROM seasons
         WHERE world_id = (SELECT world_id FROM franchises WHERE id = $1)
       )`,
    [franchiseId]
  );
}

async function closeActiveBoardProfiles(userId, franchiseId, dbClient = pool) {
  await dbClient.query(
    `UPDATE board_profiles
     SET is_active = FALSE
     WHERE user_id = $1
       AND ($2::bigint IS NULL OR franchise_id = $2)
       AND is_active = TRUE`,
    [userId, franchiseId || null]
  );
}

async function closeActiveStint({ userId, endReason, dbClient = pool }) {
  const activeStint = await dbClient.query(
    `SELECT id, franchise_id
     FROM manager_stints
     WHERE user_id = $1
       AND ended_at IS NULL
     ORDER BY started_at DESC
     LIMIT 1
     FOR UPDATE`,
    [userId]
  );

  if (!activeStint.rows.length) {
    return null;
  }

  const stint = activeStint.rows[0];
  await dbClient.query(
    `UPDATE manager_stints
     SET ended_at = NOW(),
         end_reason = $2,
         updated_at = NOW()
     WHERE id = $1`,
    [stint.id, normalizeEndReason(endReason)]
  );

  return stint;
}

async function getFranchiseObjectiveContext({ franchiseId, seasonId, dbClient = pool }) {
  const context = await dbClient.query(
    `SELECT f.id AS franchise_id,
            f.competition_mode,
            f.prospect_points,
            f.growth_points,
            COALESCE(st.played, 0)::int AS played,
            COALESCE(st.won, 0)::int AS won,
            COALESCE(st.lost, 0)::int AS lost,
            COALESCE(st.points, 0)::int AS points,
            COALESCE(st.league_position, st.position)::int AS league_position,
            COALESCE(s.teams_per_league, 12)::int AS teams_per_league,
            ROUND(COALESCE((
              SELECT AVG((p.batting + p.bowling + p.fielding + p.fitness + p.temperament) / 5.0)
              FROM players p
              WHERE p.franchise_id = f.id
                AND p.squad_status = 'MAIN_SQUAD'
            ), 0), 1) AS squad_ovr
     FROM franchises f
     LEFT JOIN season_teams st ON st.franchise_id = f.id AND st.season_id = $2
     LEFT JOIN seasons s ON s.id = $2
     WHERE f.id = $1`,
    [franchiseId, seasonId]
  );

  const row = context.rows[0] || null;
  if (!row) {
    return null;
  }

  const played = Number(row.played || 0);
  const won = Number(row.won || 0);
  const winPct = played > 0 ? (won / played) * 100 : 0;

  return {
    franchiseId: Number(row.franchise_id),
    competitionMode: normalizeCareerMode(row.competition_mode || CAREER_MODES.CLUB),
    prospectPoints: Number(row.prospect_points || 0),
    growthPoints: Number(row.growth_points || 0),
    played,
    won,
    lost: Number(row.lost || 0),
    points: Number(row.points || 0),
    leaguePosition: Number(row.league_position || 0),
    teamsPerLeague: Number(row.teams_per_league || 12),
    squadOvr: Number(row.squad_ovr || 0),
    winPct: Number(winPct.toFixed(2))
  };
}

function buildObjectivePack(context) {
  const isInternational = context.competitionMode === CAREER_MODES.INTERNATIONAL;
  const targetWinPct = isInternational ? 50 : 45;
  const positionTarget = Math.max(2, Math.ceil(Number(context.teamsPerLeague || 12) * 0.5));
  const youthBaseline = isInternational ? Number(context.growthPoints || 0) : Number(context.prospectPoints || 0);
  const youthIncrement = isInternational ? 12 : 20;

  return [
    {
      objective_code: 'RESULTS_WIN_PCT',
      is_major: true,
      target_value: targetWinPct,
      progress_value: Number(context.winPct || 0),
      weight: 3,
      status: Number(context.played || 0) === 0 ? 'PENDING' : Number(context.winPct || 0) >= targetWinPct ? 'COMPLETED' : 'IN_PROGRESS'
    },
    {
      objective_code: 'TABLE_POSITION',
      is_major: true,
      target_value: positionTarget,
      progress_value: Number(context.leaguePosition || 0),
      weight: 3,
      status:
        Number(context.played || 0) === 0 || Number(context.leaguePosition || 0) === 0
          ? 'PENDING'
          : Number(context.leaguePosition || 0) <= positionTarget
            ? 'COMPLETED'
            : 'IN_PROGRESS'
    },
    {
      objective_code: 'YOUTH_PIPELINE',
      is_major: false,
      target_value: youthBaseline + youthIncrement,
      progress_value: youthBaseline,
      weight: 2,
      status: 'PENDING'
    },
    {
      objective_code: 'SQUAD_STRENGTH',
      is_major: false,
      target_value: Number((Number(context.squadOvr || 0) + 2.5).toFixed(1)),
      progress_value: Number(context.squadOvr || 0),
      weight: 2,
      status: 'PENDING'
    }
  ];
}

function evaluateObjectiveProgress(objective, context) {
  const code = String(objective.objective_code || '').toUpperCase();
  const target = Number(objective.target_value || 0);
  let progress = Number(objective.progress_value || 0);
  let status = 'IN_PROGRESS';

  if (code === 'RESULTS_WIN_PCT') {
    progress = Number(context.winPct || 0);
    status = Number(context.played || 0) === 0 ? 'PENDING' : progress >= target ? 'COMPLETED' : 'IN_PROGRESS';
  } else if (code === 'TABLE_POSITION') {
    progress = Number(context.leaguePosition || 0);
    status =
      Number(context.played || 0) === 0 || progress === 0
        ? 'PENDING'
        : progress <= target
          ? 'COMPLETED'
          : 'IN_PROGRESS';
  } else if (code === 'YOUTH_PIPELINE') {
    progress = context.competitionMode === CAREER_MODES.INTERNATIONAL
      ? Number(context.growthPoints || 0)
      : Number(context.prospectPoints || 0);
    status = progress >= target ? 'COMPLETED' : Number(context.played || 0) === 0 ? 'PENDING' : 'IN_PROGRESS';
  } else if (code === 'SQUAD_STRENGTH') {
    progress = Number(context.squadOvr || 0);
    status = progress >= target ? 'COMPLETED' : Number(context.played || 0) === 0 ? 'PENDING' : 'IN_PROGRESS';
  }

  return {
    progress,
    status: normalizeObjectiveStatus(status)
  };
}

function buildCompletionSummary(expectations) {
  let totalWeight = 0;
  let completedWeight = 0;
  let majorTotal = 0;
  let majorCompleted = 0;

  for (const item of expectations) {
    const weight = Number(item.weight || 0);
    totalWeight += weight;
    if (item.status === 'COMPLETED') {
      completedWeight += weight;
    }

    if (item.is_major) {
      majorTotal += 1;
      if (item.status === 'COMPLETED') {
        majorCompleted += 1;
      }
    }
  }

  const completionRatio = totalWeight > 0 ? completedWeight / totalWeight : 0;
  return {
    completionRatio,
    majorTotal,
    majorCompleted
  };
}

async function upsertBoardExpectations({ boardProfileId, context, dbClient = pool }) {
  const expectations = await dbClient.query(
    `SELECT id,
            objective_code,
            is_major,
            target_value,
            progress_value,
            weight,
            status
     FROM board_expectations
     WHERE board_profile_id = $1
     ORDER BY id ASC`,
    [boardProfileId]
  );

  if (!expectations.rows.length) {
    const objectivePack = buildObjectivePack(context);
    for (const objective of objectivePack) {
      await dbClient.query(
        `INSERT INTO board_expectations (
           board_profile_id,
           objective_code,
           is_major,
           target_value,
           progress_value,
           weight,
           status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          boardProfileId,
          objective.objective_code,
          objective.is_major,
          objective.target_value,
          objective.progress_value,
          objective.weight,
          objective.status
        ]
      );
    }

    return objectivePack.map((objective) => ({
      ...objective,
      board_profile_id: boardProfileId
    }));
  }

  const updated = [];
  for (const objective of expectations.rows) {
    const progressEval = evaluateObjectiveProgress(objective, context);

    await dbClient.query(
      `UPDATE board_expectations
       SET progress_value = $2,
           status = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [objective.id, progressEval.progress, progressEval.status]
    );

    updated.push({
      ...objective,
      progress_value: progressEval.progress,
      status: progressEval.status
    });
  }

  return updated;
}

async function getOrCreateBoardProfile({ userId, franchiseId, seasonId, dbClient = pool }) {
  if (!seasonId || !franchiseId) {
    return null;
  }

  const existing = await dbClient.query(
    `SELECT id,
            season_id,
            franchise_id,
            user_id,
            confidence,
            last_checkpoint_round,
            consecutive_failed_checkpoints,
            season_evaluated_at,
            is_active
     FROM board_profiles
     WHERE season_id = $1
       AND franchise_id = $2
       AND user_id = $3
     LIMIT 1`,
    [seasonId, franchiseId, userId]
  );

  if (existing.rows.length) {
    return existing.rows[0];
  }

  const inserted = await dbClient.query(
    `INSERT INTO board_profiles (
       season_id,
       franchise_id,
       user_id,
       confidence,
       last_checkpoint_round,
       consecutive_failed_checkpoints,
       is_active
     ) VALUES ($1, $2, $3, 62, 0, 0, TRUE)
     RETURNING id,
               season_id,
               franchise_id,
               user_id,
               confidence,
               last_checkpoint_round,
               consecutive_failed_checkpoints,
               season_evaluated_at,
               is_active`,
    [seasonId, franchiseId, userId]
  );

  const context = await getFranchiseObjectiveContext({ franchiseId, seasonId, dbClient });
  if (context) {
    await upsertBoardExpectations({ boardProfileId: inserted.rows[0].id, context, dbClient });
  }

  return inserted.rows[0];
}

async function getProfileExpectations(boardProfileId, dbClient = pool) {
  const expectations = await dbClient.query(
    `SELECT id,
            board_profile_id,
            objective_code,
            is_major,
            target_value,
            progress_value,
            weight,
            status
     FROM board_expectations
     WHERE board_profile_id = $1
     ORDER BY is_major DESC, id ASC`,
    [boardProfileId]
  );

  return expectations.rows;
}

async function applyCheckpointIfDue({ profile, context, roundNo, dbClient = pool }) {
  const lastCheckpointRound = Number(profile.last_checkpoint_round || 0);
  const currentRound = Number(roundNo || 0);
  if (!currentRound || currentRound - lastCheckpointRound < CHECKPOINT_INTERVAL_ROUNDS) {
    return {
      fired: false,
      confidence: Number(profile.confidence || 62),
      consecutiveFailed: Number(profile.consecutive_failed_checkpoints || 0)
    };
  }

  const expectations = await getProfileExpectations(profile.id, dbClient);
  const summary = buildCompletionSummary(expectations);

  const passed = summary.completionRatio >= 0.5 && summary.majorCompleted >= Math.ceil(summary.majorTotal / 2);
  const delta = passed ? 6 : -9;
  const nextConfidence = clamp(Number(profile.confidence || 62) + delta, 0, 100);
  const nextFailed = passed ? 0 : Number(profile.consecutive_failed_checkpoints || 0) + 1;

  await dbClient.query(
    `UPDATE board_profiles
     SET confidence = $2,
         last_checkpoint_round = $3,
         consecutive_failed_checkpoints = $4,
         updated_at = NOW()
     WHERE id = $1`,
    [profile.id, nextConfidence, currentRound, nextFailed]
  );

  const fired = !passed && nextConfidence <= 24 && nextFailed >= 2 && Number(context.played || 0) >= 6;
  return {
    fired,
    confidence: nextConfidence,
    consecutiveFailed: nextFailed
  };
}

async function updateManagerCounters({ userId, pointsDelta, isWin, isLoss, dbClient = pool }) {
  await dbClient.query(
    `UPDATE users
     SET manager_points = GREATEST(0, manager_points + $2),
         manager_matches_managed = manager_matches_managed + 1,
         manager_wins_managed = manager_wins_managed + $3,
         manager_losses_managed = manager_losses_managed + $4,
         updated_at = NOW()
     WHERE id = $1`,
    [userId, pointsDelta, isWin ? 1 : 0, isLoss ? 1 : 0]
  );

  await dbClient.query(
    `UPDATE manager_stints
     SET matches_managed = matches_managed + 1,
         wins = wins + $2,
         losses = losses + $3,
         updated_at = NOW()
     WHERE user_id = $1
       AND ended_at IS NULL`,
    [userId, isWin ? 1 : 0, isLoss ? 1 : 0]
  );
}

async function awardFranchiseManagerMatchProgress({
  franchiseId,
  isWin = false,
  isLoss = false,
  isTie = false,
  dbClient = pool
}) {
  const managerResult = await dbClient.query(
    `SELECT f.current_manager_id
     FROM franchises f
     WHERE f.id = $1`,
    [franchiseId]
  );

  const managerId = Number(managerResult.rows[0]?.current_manager_id || 0) || null;
  if (!managerId) {
    return null;
  }

  const xpGain = isWin ? 9 : isLoss ? 4 : isTie ? 6 : 4;
  const reputationDelta = isWin ? 2 : isLoss ? -2 : 1;

  await dbClient.query(
    `UPDATE managers
     SET matches_managed = matches_managed + 1,
         wins_managed = wins_managed + $2,
         losses_managed = losses_managed + $3,
         updated_at = NOW()
     WHERE id = $1`,
    [managerId, isWin ? 1 : 0, isLoss ? 1 : 0]
  );

  await dbClient.query(
    `UPDATE manager_team_stints
     SET matches_managed = matches_managed + 1,
         wins = wins + $2,
         losses = losses + $3,
         updated_at = NOW()
     WHERE manager_id = $1
       AND ended_at IS NULL`,
    [managerId, isWin ? 1 : 0, isLoss ? 1 : 0]
  );

  return applyManagerXp({
    managerId,
    xpDelta: xpGain,
    reputationDelta,
    dbClient
  });
}

async function updateProfileConfidence({ profileId, delta, dbClient = pool }) {
  await dbClient.query(
    `UPDATE board_profiles
     SET confidence = LEAST(100, GREATEST(0, confidence + $2)),
         updated_at = NOW()
     WHERE id = $1`,
    [profileId, Number(delta || 0)]
  );
}

async function expireOutdatedOffers({ userId, seasonId, currentRound, dbClient = pool }) {
  await dbClient.query(
    `UPDATE manager_offers
     SET status = 'EXPIRED',
         updated_at = NOW()
     WHERE user_id = $1
       AND status = 'PENDING'
       AND (
         ($2::bigint IS NOT NULL AND season_id IS NOT NULL AND season_id <> $2)
         OR ($3::int > 0 AND expires_round IS NOT NULL AND expires_round < $3)
       )`,
    [userId, seasonId || null, Number(currentRound || 0)]
  );
}

function computeOfferScore({ candidate, managerPoints, preferredTier }) {
  const played = Number(candidate.played || 0);
  const points = Number(candidate.points || 0);
  const maxPoints = Math.max(1, played * 2);
  const pointPct = played > 0 ? points / maxPoints : 0.5;
  const pressure = (1 - pointPct) * 100;

  const tier = Number(candidate.current_league_tier || candidate.league_tier || 4);
  const tierDiff = Math.abs(Number(preferredTier || tier) - tier);
  const tierFit = clamp(100 - tierDiff * 18, 10, 100);

  const reputationFit = clamp(30 + Number(managerPoints || 0) * 0.8 - Math.max(0, tier - 1) * 6, 0, 100);
  const valuationAdj = clamp(100 - Number(candidate.total_valuation || 0) * 0.12, 10, 100);

  return Number((pressure * 0.42 + tierFit * 0.24 + reputationFit * 0.24 + valuationAdj * 0.1 + Math.random() * 8).toFixed(2));
}

async function determineApplyUnlockState(user, dbClient = pool, worldId = null) {
  const status = String(user?.manager_status || MANAGER_STATUSES.UNEMPLOYED).toUpperCase();
  if (status !== MANAGER_STATUSES.UNEMPLOYED) {
    return {
      unlocked: false,
      roundsCompletedWhileUnemployed: 0,
      roundsRemaining: APPLY_MARKET_UNLOCK_ROUNDS
    };
  }

  const unemployedSince = user?.manager_unemployed_since;
  const activeSeason = await getActiveSeasonInfo(dbClient, worldId);

  if (!unemployedSince || !activeSeason) {
    return {
      unlocked: true,
      roundsCompletedWhileUnemployed: APPLY_MARKET_UNLOCK_ROUNDS,
      roundsRemaining: 0
    };
  }

  const rounds = await dbClient.query(
    `SELECT COUNT(DISTINCT round_no)::int AS rounds
     FROM matches
     WHERE season_id = $1
       AND stage = 'REGULAR'
       AND status = 'COMPLETED'
       AND updated_at >= $2`,
    [activeSeason.id, unemployedSince]
  );

  const completed = Number(rounds.rows[0]?.rounds || 0);
  const remaining = Math.max(0, APPLY_MARKET_UNLOCK_ROUNDS - completed);

  return {
    unlocked: remaining === 0,
    roundsCompletedWhileUnemployed: completed,
    roundsRemaining: remaining
  };
}

async function listApplyMarketCandidates({ userId, mode, worldId = null, limit = 14, dbClient = pool }) {
  const activeSeason = await getActiveSeasonInfo(dbClient, worldId);
  const seasonId = activeSeason?.id || null;

  const candidates = await dbClient.query(
    `SELECT f.id,
            f.franchise_name,
            f.competition_mode,
            f.current_league_tier,
            f.total_valuation,
            f.wins,
            f.losses,
            c.name AS city_name,
            c.country,
            COALESCE(st.played, 0)::int AS played,
            COALESCE(st.won, 0)::int AS won,
            COALESCE(st.lost, 0)::int AS lost,
            COALESCE(st.points, 0)::int AS points,
            COALESCE(st.league_position, st.position)::int AS league_position
     FROM franchises f
     JOIN cities c ON c.id = f.city_id
     LEFT JOIN season_teams st ON st.franchise_id = f.id AND st.season_id = $2
     WHERE f.owner_user_id IS NULL
       AND f.status IN ('AI_CONTROLLED', 'AVAILABLE', 'FOR_SALE')
       AND f.competition_mode = $1
       AND ($4::bigint IS NULL OR f.world_id = $4)
     ORDER BY f.current_league_tier ASC,
              COALESCE(st.league_position, st.position, 999) ASC,
              f.total_valuation DESC,
              f.id ASC
     LIMIT $3`,
    [mode, seasonId, limit, worldId]
  );

  return candidates.rows;
}

export async function assertManagerCanTakeJobs(userId, dbClient = pool) {
  const user = await getUserRow(userId, dbClient);
  if (!user) {
    const error = new Error('User not found.');
    error.status = 404;
    throw error;
  }

  const status = String(user.manager_status || MANAGER_STATUSES.UNEMPLOYED).toUpperCase();
  if (status === MANAGER_STATUSES.RETIRED) {
    const error = new Error('This save is permanently retired. Start a new save to manage again.');
    error.status = 403;
    throw error;
  }

  return user;
}

export async function activateManagerForFranchise({ userId, franchiseId, competitionMode, dbClient = pool }) {
  await assertManagerCanTakeJobs(userId, dbClient);
  const normalizedMode = normalizeCareerMode(competitionMode || CAREER_MODES.CLUB);

  /* derive worldId from the franchise being activated */
  const fwRow = await dbClient.query('SELECT world_id FROM franchises WHERE id = $1', [franchiseId]);
  const worldId = fwRow.rows[0]?.world_id || null;

  const humanManager = await ensureHumanManagerEntity(userId, dbClient, worldId);
  if (humanManager) {
    const managerMode = normalizeCareerMode(humanManager.competition_mode || CAREER_MODES.CLUB);
    if (managerMode !== normalizedMode || Boolean(humanManager.is_cpu)) {
      await dbClient.query(
        `UPDATE managers
         SET competition_mode = $2,
             is_cpu = FALSE,
             updated_at = NOW()
         WHERE id = $1`,
        [Number(humanManager.id), normalizedMode]
      );
    }
  }

  const activeStint = await dbClient.query(
    `SELECT id, franchise_id
     FROM manager_stints
     WHERE user_id = $1
       AND ended_at IS NULL
     ORDER BY started_at DESC
     LIMIT 1
     FOR UPDATE`,
    [userId]
  );

  if (!activeStint.rows.length || Number(activeStint.rows[0].franchise_id) !== Number(franchiseId)) {
    if (activeStint.rows.length) {
      await dbClient.query(
        `UPDATE manager_stints
         SET ended_at = NOW(),
             end_reason = 'REPLACED',
             updated_at = NOW()
         WHERE id = $1`,
        [activeStint.rows[0].id]
      );
    }

    await dbClient.query(
      `INSERT INTO manager_stints (
         user_id,
         franchise_id,
         competition_mode,
         started_at,
         end_reason,
         matches_managed,
         wins,
         losses
       ) VALUES ($1, $2, $3, NOW(), NULL, 0, 0, 0)`,
      [userId, franchiseId, normalizedMode]
    );
  }

  await dbClient.query(
    `UPDATE users
     SET manager_status = $2,
         career_mode = $3,
         manager_unemployed_since = NULL,
         manager_retired_at = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [userId, MANAGER_STATUSES.ACTIVE, normalizedMode]
  );

  await dbClient.query(
    `UPDATE manager_offers
     SET status = 'WITHDRAWN',
         updated_at = NOW()
     WHERE user_id = $1
       AND status = 'PENDING'`,
    [userId]
  );

  const activeSeason = await getActiveSeasonInfo(dbClient, worldId);
  if (humanManager) {
    await assignManagerToFranchise({
      managerId: Number(humanManager.id),
      franchiseId: Number(franchiseId),
      competitionMode: normalizedMode,
      seasonId: activeSeason?.id ? Number(activeSeason.id) : null,
      endReason: 'REPLACED',
      dbClient
    });
  }

  if (activeSeason) {
    await getOrCreateBoardProfile({
      userId,
      franchiseId,
      seasonId: activeSeason.id,
      dbClient
    });

    await dbClient.query(
      `UPDATE season_teams
       SET is_ai = FALSE
       WHERE season_id = $1
         AND franchise_id = $2`,
      [activeSeason.id, franchiseId]
    );
  }

  return getUserRow(userId, dbClient);
}

export async function transitionManagerToUnemployed({
  userId,
  franchiseId = null,
  endReason = 'RESIGNED',
  incrementFirings = false,
  generateOffers = false,
  releaseTeam = true,
  dbClient = pool
}) {
  const user = await getUserRow(userId, dbClient);
  if (!user) {
    return null;
  }

  if (String(user.manager_status || '').toUpperCase() === MANAGER_STATUSES.RETIRED) {
    return user;
  }

  const closedStint = await closeActiveStint({ userId, endReason, dbClient });
  const targetFranchiseId = Number(franchiseId || closedStint?.franchise_id || 0) || null;

  if (targetFranchiseId) {
    /* derive worldId from franchise for season lookups */
    const twRow = await dbClient.query('SELECT world_id FROM franchises WHERE id = $1', [targetFranchiseId]);
    const worldId = twRow.rows[0]?.world_id || null;

    await closeActiveBoardProfiles(userId, targetFranchiseId, dbClient);
    if (releaseTeam) {
      await closeActiveManagerTeamStint(targetFranchiseId, endReason, dbClient);
      await releaseFranchiseOwnership(targetFranchiseId, dbClient);
      await ensureCpuManagerForFranchise({
        franchiseId: targetFranchiseId,
        seasonId: (await getActiveSeasonInfo(dbClient, worldId))?.id || null,
        worldId,
        dbClient
      });
    } else {
      await closeActiveManagerTeamStint(targetFranchiseId, endReason, dbClient);
      await ensureCpuManagerForFranchise({
        franchiseId: targetFranchiseId,
        seasonId: (await getActiveSeasonInfo(dbClient, worldId))?.id || null,
        worldId,
        dbClient
      });
    }
  } else {
    await closeActiveBoardProfiles(userId, null, dbClient);
  }

  await dbClient.query(
    `UPDATE users
     SET manager_status = $2,
         manager_unemployed_since = NOW(),
         manager_firings = manager_firings + $3,
         updated_at = NOW()
     WHERE id = $1`,
    [userId, MANAGER_STATUSES.UNEMPLOYED, incrementFirings ? 1 : 0]
  );

  if (generateOffers) {
    await generateManagerOffersForUser(userId, { dbClient });
  }

  return getUserRow(userId, dbClient);
}

export async function handleManagerInactivityRelease({ userId, franchiseId, dbClient = pool }) {
  return transitionManagerToUnemployed({
    userId,
    franchiseId,
    endReason: 'INACTIVITY',
    incrementFirings: false,
    generateOffers: true,
    releaseTeam: false,
    dbClient
  });
}

export async function retireManagerCareer({ userId, worldId = null, dbClient = pool }) {
  const user = await getUserRow(userId, dbClient);
  if (!user) {
    const error = new Error('User not found.');
    error.status = 404;
    throw error;
  }

  const status = String(user.manager_status || MANAGER_STATUSES.UNEMPLOYED).toUpperCase();
  if (status === MANAGER_STATUSES.RETIRED) {
    return getManagerCareerSnapshot(userId, dbClient);
  }

  const owned = await getManagedFranchise(userId, dbClient, worldId);
  if (owned?.id) {
    await releaseFranchiseOwnership(owned.id, dbClient);
  }

  await closeActiveStint({ userId, endReason: 'RETIRED', dbClient });
  await closeActiveBoardProfiles(userId, null, dbClient);

  await dbClient.query(
    `UPDATE users
     SET manager_status = $2,
         manager_retired_at = NOW(),
         manager_unemployed_since = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [userId, MANAGER_STATUSES.RETIRED]
  );

  await dbClient.query(
    `UPDATE manager_offers
     SET status = 'WITHDRAWN',
         updated_at = NOW()
     WHERE user_id = $1
       AND status = 'PENDING'`,
    [userId]
  );

  return getManagerCareerSnapshot(userId, dbClient, worldId);
}

export async function ensureManagerBoardProfilesForSeason(seasonId, dbClient = pool) {
  if (!seasonId) {
    return;
  }

  const activeManagers = await dbClient.query(
    `SELECT DISTINCT u.id AS user_id,
            f.id AS franchise_id,
            f.competition_mode
     FROM users u
     JOIN franchises f ON f.owner_user_id = u.id
     JOIN season_teams st ON st.franchise_id = f.id AND st.season_id = $1
     WHERE COALESCE(u.manager_status, 'UNEMPLOYED') = 'ACTIVE'`,
    [seasonId]
  );

  for (const manager of activeManagers.rows) {
    await getOrCreateBoardProfile({
      userId: Number(manager.user_id),
      franchiseId: Number(manager.franchise_id),
      seasonId,
      dbClient
    });

    await dbClient.query(
      `UPDATE users
       SET career_mode = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [Number(manager.user_id), normalizeCareerMode(manager.competition_mode || CAREER_MODES.CLUB)]
    );
  }
}

export async function processManagerAfterMatch({
  seasonId,
  roundNo,
  homeFranchiseId,
  awayFranchiseId,
  winnerFranchiseId,
  dbClient = pool
}) {
  if (!seasonId) {
    return { firedUsers: [] };
  }

  await ensureManagerForFranchiseId(Number(homeFranchiseId), Number(seasonId), dbClient);
  await ensureManagerForFranchiseId(Number(awayFranchiseId), Number(seasonId), dbClient);

  const homeWon = winnerFranchiseId && Number(winnerFranchiseId) === Number(homeFranchiseId);
  const awayWon = winnerFranchiseId && Number(winnerFranchiseId) === Number(awayFranchiseId);
  const tie = !winnerFranchiseId;

  await awardFranchiseManagerMatchProgress({
    franchiseId: Number(homeFranchiseId),
    isWin: homeWon,
    isLoss: Boolean(winnerFranchiseId) && !homeWon,
    isTie: tie,
    dbClient
  });
  await awardFranchiseManagerMatchProgress({
    franchiseId: Number(awayFranchiseId),
    isWin: awayWon,
    isLoss: Boolean(winnerFranchiseId) && !awayWon,
    isTie: tie,
    dbClient
  });

  const managedSides = await dbClient.query(
    `SELECT u.id AS user_id,
            u.manager_status,
            f.id AS franchise_id,
            f.competition_mode
     FROM franchises f
     JOIN users u ON u.id = f.owner_user_id
     WHERE f.id = ANY($1::bigint[])
       AND COALESCE(u.manager_status, 'UNEMPLOYED') = 'ACTIVE'`,
    [[Number(homeFranchiseId), Number(awayFranchiseId)]]
  );

  const firedUsers = [];

  for (const side of managedSides.rows) {
    const userId = Number(side.user_id);
    const franchiseId = Number(side.franchise_id);
    const isWin = winnerFranchiseId && Number(winnerFranchiseId) === franchiseId;
    const isLoss = winnerFranchiseId && Number(winnerFranchiseId) !== franchiseId;
    const isTie = !winnerFranchiseId;

    const pointsDelta = isWin ? 3 : 1;
    await updateManagerCounters({ userId, pointsDelta, isWin, isLoss, dbClient });

    const profile = await getOrCreateBoardProfile({
      userId,
      franchiseId,
      seasonId,
      dbClient
    });

    if (!profile || !profile.is_active) {
      continue;
    }

    await updateProfileConfidence({
      profileId: Number(profile.id),
      delta: isWin ? 4 : isLoss ? -3 : isTie ? 1 : 0,
      dbClient
    });

    const refreshedProfile = (
      await dbClient.query(
        `SELECT id,
                season_id,
                franchise_id,
                user_id,
                confidence,
                last_checkpoint_round,
                consecutive_failed_checkpoints,
                season_evaluated_at,
                is_active
         FROM board_profiles
         WHERE id = $1`,
        [profile.id]
      )
    ).rows[0];

    const context = await getFranchiseObjectiveContext({ franchiseId, seasonId, dbClient });
    if (!context) {
      continue;
    }

    await upsertBoardExpectations({ boardProfileId: profile.id, context, dbClient });

    const checkpoint = await applyCheckpointIfDue({
      profile: refreshedProfile,
      context,
      roundNo,
      dbClient
    });

    if (checkpoint.fired) {
      await transitionManagerToUnemployed({
        userId,
        franchiseId,
        endReason: 'FIRED',
        incrementFirings: true,
        generateOffers: true,
        dbClient
      });
      firedUsers.push(userId);
    }
  }

  return { firedUsers };
}

export async function finalizeManagerSeasonEvaluations(seasonId, dbClient = pool) {
  if (!seasonId) {
    return;
  }

  const profiles = await dbClient.query(
    `SELECT bp.id,
            bp.user_id,
            bp.franchise_id,
            bp.confidence,
            bp.is_active,
            bp.season_evaluated_at,
            f.competition_mode,
            COALESCE(st.league_position, st.position)::int AS league_position,
            COALESCE(st.played, 0)::int AS played,
            COALESCE(st.points, 0)::int AS points,
            s.teams_per_league
     FROM board_profiles bp
     JOIN franchises f ON f.id = bp.franchise_id
     LEFT JOIN season_teams st ON st.season_id = bp.season_id AND st.franchise_id = bp.franchise_id
     LEFT JOIN seasons s ON s.id = bp.season_id
     WHERE bp.season_id = $1
       AND bp.season_evaluated_at IS NULL`,
    [seasonId]
  );

  for (const profile of profiles.rows) {
    const context = await getFranchiseObjectiveContext({
      franchiseId: Number(profile.franchise_id),
      seasonId,
      dbClient
    });
    if (!context) {
      continue;
    }

    const expectations = await upsertBoardExpectations({
      boardProfileId: Number(profile.id),
      context,
      dbClient
    });
    const summary = buildCompletionSummary(expectations);

    const trophyCountResult = await dbClient.query(
      `SELECT COUNT(*)::int AS count
       FROM trophy_cabinet
       WHERE season_id = $1
         AND franchise_id = $2`,
      [seasonId, profile.franchise_id]
    );
    const trophyCount = Number(trophyCountResult.rows[0]?.count || 0);

    const leaguePosition = Number(profile.league_position || 0);
    const finishBonus = leaguePosition > 0
      ? Math.max(0, Number(profile.teams_per_league || 12) + 1 - leaguePosition)
      : 0;

    const youthObjectiveDone = expectations.some((item) => item.objective_code === 'YOUTH_PIPELINE' && item.status === 'COMPLETED');
    const seasonBonus = Math.round(summary.completionRatio * 12) + finishBonus + trophyCount * 8 + (youthObjectiveDone ? 4 : 0);

    await dbClient.query(
      `UPDATE users
       SET manager_points = GREATEST(0, manager_points + $2),
           manager_titles = manager_titles + $3,
           updated_at = NOW()
       WHERE id = $1`,
      [profile.user_id, seasonBonus, trophyCount]
    );

    if (summary.completionRatio < 0.35 && Number(profile.confidence || 0) < 32 && profile.is_active) {
      await transitionManagerToUnemployed({
        userId: Number(profile.user_id),
        franchiseId: Number(profile.franchise_id),
        endReason: 'FIRED',
        incrementFirings: true,
        generateOffers: true,
        dbClient
      });
    }

    await dbClient.query(
      `UPDATE board_profiles
       SET season_evaluated_at = NOW(),
           is_active = FALSE,
           updated_at = NOW()
       WHERE id = $1`,
      [profile.id]
    );
  }
}

export async function generateManagerOffersForUser(userId, options = {}) {
  const {
    seasonId = null,
    worldId = null,
    dbClient = pool,
    minOffers = MIN_OFFERS,
    maxOffers = MAX_OFFERS
  } = options;

  const user = await getUserRow(userId, dbClient);
  if (!user) {
    return [];
  }

  if (String(user.manager_status || '').toUpperCase() === MANAGER_STATUSES.RETIRED) {
    return [];
  }

  const activeSeason = seasonId
    ? (
      await dbClient.query(
        `SELECT id, competition_mode, teams_per_league
         FROM seasons
         WHERE id = $1`,
        [seasonId]
      )
    ).rows[0] || null
    : await getActiveSeasonInfo(dbClient, worldId);

  const effectiveSeasonId = Number(activeSeason?.id || 0) || null;
  const currentRound = await getCurrentRegularRound(effectiveSeasonId, dbClient);

  await expireOutdatedOffers({ userId, seasonId: effectiveSeasonId, currentRound, dbClient });

  const existingPending = await dbClient.query(
    `SELECT id
     FROM manager_offers
     WHERE user_id = $1
       AND status = 'PENDING'`,
    [userId]
  );

  const pendingCount = Number(existingPending.rows.length || 0);
  const targetCount = randomInt(Math.max(1, minOffers), Math.max(minOffers, maxOffers));
  const needToGenerate = Math.max(0, targetCount - pendingCount);
  if (needToGenerate <= 0) {
    return listManagerOffers(userId, dbClient);
  }

  const preferredMode = normalizeCareerMode(user.career_mode || CAREER_MODES.CLUB);
  const latestStint = await getLatestManagerStint(userId, dbClient);
  const preferredTier = latestStint?.franchise_id
    ? Number(
      (
        await dbClient.query(
          `SELECT current_league_tier
           FROM franchises
           WHERE id = $1`,
          [latestStint.franchise_id]
        )
      ).rows[0]?.current_league_tier || 4
    )
    : 4;

  const candidates = await dbClient.query(
    `SELECT f.id,
            f.current_league_tier,
            f.total_valuation,
            f.competition_mode,
            COALESCE(st.played, 0)::int AS played,
            COALESCE(st.points, 0)::int AS points,
            COALESCE(st.league_position, st.position)::int AS league_position
     FROM franchises f
     LEFT JOIN season_teams st ON st.franchise_id = f.id AND st.season_id = $1
     WHERE f.owner_user_id IS NULL
       AND f.status IN ('AI_CONTROLLED', 'AVAILABLE', 'FOR_SALE')
       AND f.competition_mode = $2
       AND ($4::bigint IS NULL OR f.world_id = $4)
       AND NOT EXISTS (
         SELECT 1
         FROM manager_offers mo
         WHERE mo.user_id = $3
           AND mo.franchise_id = f.id
           AND mo.status = 'PENDING'
       )
     ORDER BY f.current_league_tier ASC, COALESCE(st.league_position, st.position, 999) ASC, f.total_valuation DESC`,
    [effectiveSeasonId, preferredMode, userId, worldId]
  );

  if (!candidates.rows.length) {
    return listManagerOffers(userId, dbClient);
  }

  const scored = candidates.rows
    .map((candidate) => ({
      candidate,
      score: computeOfferScore({
        candidate,
        managerPoints: Number(user.manager_points || 0),
        preferredTier
      })
    }))
    .sort((a, b) => b.score - a.score);

  const picked = scored.slice(0, needToGenerate);
  for (const option of picked) {
    await dbClient.query(
      `INSERT INTO manager_offers (
         user_id,
         franchise_id,
         season_id,
         offer_score,
         generated_round,
         expires_round,
         status
       ) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')`,
      [
        userId,
        option.candidate.id,
        effectiveSeasonId,
        option.score,
        currentRound,
        currentRound + 3
      ]
    );
  }

  return listManagerOffers(userId, dbClient);
}

export async function listManagerOffers(userId, dbClient = pool, worldId = null) {
  const user = await getUserRow(userId, dbClient);
  if (!user) {
    return [];
  }

  const activeSeason = await getActiveSeasonInfo(dbClient, worldId);
  const currentRound = await getCurrentRegularRound(activeSeason?.id || null, dbClient);
  await expireOutdatedOffers({
    userId,
    seasonId: activeSeason?.id || null,
    currentRound,
    dbClient
  });

  const offers = await dbClient.query(
    `SELECT mo.id,
            mo.user_id,
            mo.franchise_id,
            mo.season_id,
            mo.offer_score,
            mo.generated_round,
            mo.expires_round,
            mo.status,
            mo.created_at,
            f.franchise_name,
            f.competition_mode,
            f.current_league_tier,
            f.total_valuation,
            c.name AS city_name,
            c.country,
            COALESCE(st.played, 0)::int AS played,
            COALESCE(st.won, 0)::int AS won,
            COALESCE(st.lost, 0)::int AS lost,
            COALESCE(st.points, 0)::int AS points,
            COALESCE(st.league_position, st.position)::int AS league_position
     FROM manager_offers mo
     JOIN franchises f ON f.id = mo.franchise_id
     JOIN cities c ON c.id = f.city_id
     LEFT JOIN season_teams st ON st.franchise_id = mo.franchise_id AND st.season_id = mo.season_id
     WHERE mo.user_id = $1
       AND ($2::bigint IS NULL OR f.world_id = $2)
     ORDER BY
       CASE mo.status
         WHEN 'PENDING' THEN 0
         WHEN 'ACCEPTED' THEN 1
         WHEN 'DECLINED' THEN 2
         WHEN 'EXPIRED' THEN 3
         ELSE 4
       END,
       mo.offer_score DESC,
       mo.created_at DESC
     LIMIT 50`,
    [userId, worldId]
  );

  return offers.rows;
}

async function assignManagerToFranchiseFromOffer({ userId, franchiseId, dbClient = pool }) {
  const user = await assertManagerCanTakeJobs(userId, dbClient);

  const owned = await getManagedFranchise(userId, dbClient);
  if (owned?.id) {
    const error = new Error('You already manage a team in this save.');
    error.status = 400;
    throw error;
  }

  const franchiseResult = await dbClient.query(
    `SELECT id, competition_mode, owner_user_id
     FROM franchises
     WHERE id = $1
     FOR UPDATE`,
    [franchiseId]
  );

  if (!franchiseResult.rows.length) {
    const error = new Error('Franchise not found.');
    error.status = 404;
    throw error;
  }

  const franchise = franchiseResult.rows[0];
  if (franchise.owner_user_id) {
    const error = new Error('This team is no longer available.');
    error.status = 409;
    throw error;
  }

  await dbClient.query(
    `UPDATE franchises
     SET owner_user_id = $2,
         status = 'ACTIVE',
         listed_for_sale_at = NULL
     WHERE id = $1`,
    [franchiseId, userId]
  );

  await activateManagerForFranchise({
    userId,
    franchiseId,
    competitionMode: normalizeCareerMode(franchise.competition_mode || user.career_mode || CAREER_MODES.CLUB),
    dbClient
  });

  await dbClient.query(
    `INSERT INTO transfer_feed (action_type, source_franchise_id, message)
     VALUES ('SEASON_NOTE', $1, $2)`,
    [franchiseId, 'Board appointment: user manager accepted a contract offer.']
  );
}

export async function acceptManagerOffer({ userId, offerId, worldId = null, dbClient = pool }) {
  const user = await assertManagerCanTakeJobs(userId, dbClient);
  if (String(user.manager_status || '').toUpperCase() !== MANAGER_STATUSES.UNEMPLOYED) {
    const error = new Error('You can only accept offers while unemployed.');
    error.status = 409;
    throw error;
  }

  const offerResult = await dbClient.query(
    `SELECT mo.id,
            mo.user_id,
            mo.franchise_id,
            mo.season_id,
            mo.expires_round,
            mo.status
     FROM manager_offers mo
     JOIN franchises f ON f.id = mo.franchise_id
     WHERE mo.id = $1
       AND mo.user_id = $2
       AND ($3::bigint IS NULL OR f.world_id = $3)
     FOR UPDATE OF mo`,
    [offerId, userId, worldId]
  );

  if (!offerResult.rows.length) {
    const error = new Error('Offer not found.');
    error.status = 404;
    throw error;
  }

  const offer = offerResult.rows[0];
  if (offer.status !== OFFER_STATUSES.PENDING) {
    const error = new Error('Offer is no longer active.');
    error.status = 409;
    throw error;
  }

  const currentRound = await getCurrentRegularRound(offer.season_id, dbClient);
  if (Number(offer.expires_round || 0) > 0 && Number(offer.expires_round) < currentRound) {
    await dbClient.query(
      `UPDATE manager_offers
       SET status = 'EXPIRED',
           updated_at = NOW()
       WHERE id = $1`,
      [offer.id]
    );

    const error = new Error('Offer has expired.');
    error.status = 409;
    throw error;
  }

  await assignManagerToFranchiseFromOffer({
    userId,
    franchiseId: Number(offer.franchise_id),
    dbClient
  });

  await dbClient.query(
    `UPDATE manager_offers
     SET status = CASE WHEN id = $2 THEN 'ACCEPTED' ELSE 'WITHDRAWN' END,
         updated_at = NOW()
     WHERE user_id = $1
       AND status = 'PENDING'`,
    [userId, offer.id]
  );

  return getManagerCareerSnapshot(userId, dbClient, worldId);
}

export async function declineManagerOffer({ userId, offerId, worldId = null, dbClient = pool }) {
  const offerResult = await dbClient.query(
    `SELECT id, status
     FROM manager_offers
     WHERE id = $1
       AND user_id = $2
     FOR UPDATE`,
    [offerId, userId]
  );

  if (!offerResult.rows.length) {
    const error = new Error('Offer not found.');
    error.status = 404;
    throw error;
  }

  const offer = offerResult.rows[0];
  if (offer.status !== OFFER_STATUSES.PENDING) {
    const error = new Error('Only pending offers can be declined.');
    error.status = 409;
    throw error;
  }

  await dbClient.query(
    `UPDATE manager_offers
     SET status = 'DECLINED',
         updated_at = NOW()
     WHERE id = $1`,
    [offer.id]
  );

  return listManagerOffers(userId, dbClient, worldId);
}

export async function applyForManagerJob({ userId, franchiseId, worldId = null, dbClient = pool }) {
  const user = await assertManagerCanTakeJobs(userId, dbClient);
  if (String(user.manager_status || '').toUpperCase() !== MANAGER_STATUSES.UNEMPLOYED) {
    const error = new Error('You can only apply for jobs while unemployed.');
    error.status = 409;
    throw error;
  }

  const unlockState = await determineApplyUnlockState(user, dbClient);
  if (!unlockState.unlocked) {
    const error = new Error(`Apply market unlocks after ${unlockState.roundsRemaining} more completed round(s).`);
    error.status = 403;
    throw error;
  }

  const franchiseResult = await dbClient.query(
    `SELECT id,
            owner_user_id,
            competition_mode,
            current_league_tier,
            total_valuation
     FROM franchises
     WHERE id = $1
       AND ($2::bigint IS NULL OR world_id = $2)
     FOR UPDATE`,
    [franchiseId, worldId]
  );

  if (!franchiseResult.rows.length) {
    const error = new Error('Team not found.');
    error.status = 404;
    throw error;
  }

  const franchise = franchiseResult.rows[0];
  if (franchise.owner_user_id) {
    const error = new Error('This team is already managed.');
    error.status = 409;
    throw error;
  }

  const preferredMode = normalizeCareerMode(user.career_mode || CAREER_MODES.CLUB);
  const teamMode = normalizeCareerMode(franchise.competition_mode || CAREER_MODES.CLUB);
  if (teamMode !== preferredMode) {
    const error = new Error(`You can only apply for ${preferredMode.toLowerCase()} jobs in this save.`);
    error.status = 403;
    throw error;
  }

  const latestStint = await getLatestManagerStint(userId, dbClient);
  let previousTier = Number(franchise.current_league_tier || 4);
  if (latestStint?.franchise_id) {
    previousTier = Number(
      (
        await dbClient.query('SELECT current_league_tier FROM franchises WHERE id = $1', [latestStint.franchise_id])
      ).rows[0]?.current_league_tier || previousTier
    );
  }

  const tierDiff = Math.max(0, Number(franchise.current_league_tier || 4) - Number(previousTier || 4));
  const acceptanceScore = Number(user.manager_points || 0) + randomInt(10, 35);
  const requiredScore = 36 + tierDiff * 8;

  if (acceptanceScore < requiredScore) {
    await dbClient.query(
      `INSERT INTO transfer_feed (action_type, source_franchise_id, message)
       VALUES ('SEASON_NOTE', $1, $2)`,
      [franchiseId, 'Board rejected manager application due to fit and expectations.']
    );

    return {
      accepted: false,
      message: 'Application rejected this round. Improve reputation or wait for offers.'
    };
  }

  await assignManagerToFranchiseFromOffer({ userId, franchiseId: Number(franchiseId), dbClient });
  await dbClient.query(
    `UPDATE manager_offers
     SET status = 'WITHDRAWN',
         updated_at = NOW()
     WHERE user_id = $1
       AND status = 'PENDING'`,
    [userId]
  );

  return {
    accepted: true,
    snapshot: await getManagerCareerSnapshot(userId, dbClient, worldId)
  };
}

export async function processCpuManagerLifecycleForRound({ seasonId, roundNo, dbClient = pool }) {
  if (!seasonId || !roundNo) {
    return { fired: 0, hired: 0 };
  }

  const markerPrefix = `MANAGER_ROUND_REVIEW:${Number(roundNo)}`;
  const alreadyProcessed = await dbClient.query(
    `SELECT 1
     FROM transfer_feed
     WHERE season_id = $1
       AND action_type = 'SEASON_NOTE'
       AND message LIKE $2
     LIMIT 1`,
    [seasonId, `${markerPrefix}%`]
  );
  if (alreadyProcessed.rows.length) {
    return { fired: 0, hired: 0, skipped: true };
  }

  const teams = await dbClient.query(
    `SELECT f.id AS franchise_id,
            f.current_manager_id,
            f.competition_mode,
            c.country,
            COALESCE(st.played, 0)::int AS played,
            COALESCE(st.won, 0)::int AS won,
            COALESCE(st.points, 0)::int AS points,
            COALESCE(st.league_position, st.position)::int AS league_position,
            COALESCE(s.teams_per_league, 12)::int AS teams_per_league
     FROM season_teams st
     JOIN franchises f ON f.id = st.franchise_id
     JOIN cities c ON c.id = f.city_id
     JOIN seasons s ON s.id = st.season_id
     WHERE st.season_id = $1
       AND st.is_ai = TRUE`,
    [seasonId]
  );

  let fired = 0;
  let hired = 0;
  /* derive worldId from the season for proper scoping */
  const swRow = await dbClient.query('SELECT world_id FROM seasons WHERE id = $1', [seasonId]);
  const worldId = swRow.rows[0]?.world_id || null;
  const usedNameKeys = await buildUsedManagerNameKeySet(dbClient, worldId);

  for (const team of teams.rows) {
    const franchiseId = Number(team.franchise_id);
    const played = Number(team.played || 0);
    const won = Number(team.won || 0);
    const points = Number(team.points || 0);
    const leaguePosition = Number(team.league_position || 0);
    const teamsPerLeague = Number(team.teams_per_league || 12);
    const pointPct = played > 0 ? points / Math.max(1, played * 2) : 0.5;

    await ensureCpuManagerForFranchise({
      franchiseId,
      competitionMode: normalizeCareerMode(team.competition_mode || CAREER_MODES.CLUB),
      country: team.country,
      seasonId,
      dbClient,
      usedNameKeys
    });

    const emergency = played >= 6 && won === 0;
    const checkpoint = Number(roundNo) % 3 === 0;
    const deepTrouble = played >= 8 && pointPct < 0.28 && leaguePosition >= Math.max(teamsPerLeague - 1, 2);
    if (!emergency && !checkpoint && !deepTrouble) {
      continue;
    }

    let fireChance = 0;
    if (emergency) {
      fireChance = Math.max(fireChance, 0.62);
    }
    if (deepTrouble) {
      fireChance = Math.max(fireChance, 0.54);
    }
    if (checkpoint) {
      if (pointPct < 0.30) {
        fireChance = Math.max(fireChance, 0.40);
      } else if (pointPct < 0.38) {
        fireChance = Math.max(fireChance, 0.24);
      }
    }

    if (Math.random() > fireChance) {
      continue;
    }

    const oldManagerId = Number(team.current_manager_id || 0) || null;
    if (oldManagerId) {
      await closeActiveManagerTeamStint(franchiseId, 'FIRED', dbClient);
      await dbClient.query(
        `UPDATE managers
         SET reputation = GREATEST(0, reputation - 8),
             updated_at = NOW()
         WHERE id = $1`,
        [oldManagerId]
      );
      fired += 1;
    }

    await dbClient.query(
      `UPDATE franchises
       SET current_manager_id = NULL
       WHERE id = $1`,
      [franchiseId]
    );

    await ensureCpuManagerForFranchise({
      franchiseId,
      competitionMode: normalizeCareerMode(team.competition_mode || CAREER_MODES.CLUB),
      country: team.country,
      seasonId,
      dbClient,
      usedNameKeys
    });
    hired += 1;

    await dbClient.query(
      `INSERT INTO transfer_feed (season_id, action_type, source_franchise_id, message)
       VALUES ($1, 'SEASON_NOTE', $2, $3)`,
      [seasonId, franchiseId, 'Board action: CPU manager fired and replacement hired.']
    );
  }

  await dbClient.query(
    `INSERT INTO transfer_feed (season_id, action_type, message)
     VALUES ($1, 'SEASON_NOTE', $2)`,
    [seasonId, `${markerPrefix}|fired=${fired}|hired=${hired}`]
  );

  return { fired, hired };
}

export async function finalizeGlobalManagerSeasonLifecycle(seasonId, dbClient = pool) {
  if (!seasonId) {
    return { seasonBonusesApplied: 0, fired: 0, hired: 0 };
  }

  const alreadyFinalized = await dbClient.query(
    `SELECT 1
     FROM transfer_feed
     WHERE season_id = $1
       AND action_type = 'SEASON_NOTE'
       AND message = 'MANAGER_SEASON_FINALIZED'
     LIMIT 1`,
    [seasonId]
  );
  if (alreadyFinalized.rows.length) {
    return { seasonBonusesApplied: 0, fired: 0, hired: 0, skipped: true };
  }

  const standings = await dbClient.query(
    `SELECT st.franchise_id,
            st.is_ai,
            COALESCE(st.league_position, st.position)::int AS league_position,
            COALESCE(st.points, 0)::int AS points,
            COALESCE(st.won, 0)::int AS won,
            COALESCE(st.played, 0)::int AS played,
            s.teams_per_league,
            f.current_manager_id,
            f.competition_mode,
            c.country
     FROM season_teams st
     JOIN seasons s ON s.id = st.season_id
     JOIN franchises f ON f.id = st.franchise_id
     JOIN cities c ON c.id = f.city_id
     WHERE st.season_id = $1`,
    [seasonId]
  );

  const seasonWorldRow = await dbClient.query('SELECT world_id FROM seasons WHERE id = $1', [seasonId]);
  const lifecycleWorldId = seasonWorldRow.rows[0]?.world_id || null;
  const usedNameKeys = await buildUsedManagerNameKeySet(dbClient, lifecycleWorldId);
  const touchedManagers = new Set();
  let seasonBonusesApplied = 0;
  let fired = 0;
  let hired = 0;

  for (const row of standings.rows) {
    const franchiseId = Number(row.franchise_id);
    const mode = normalizeCareerMode(row.competition_mode || CAREER_MODES.CLUB);
    if (!row.current_manager_id) {
      await ensureManagerForFranchiseId(franchiseId, null, dbClient);
    }

    const managerId = Number(
      (
        await dbClient.query('SELECT current_manager_id FROM franchises WHERE id = $1', [franchiseId])
      ).rows[0]?.current_manager_id || 0
    ) || null;
    if (!managerId) {
      continue;
    }

    touchedManagers.add(managerId);
    const leaguePosition = Number(row.league_position || 0);
    const teamsPerLeague = Number(row.teams_per_league || 12);
    const played = Number(row.played || 0);
    const won = Number(row.won || 0);
    const pointPct = played > 0 ? Number(row.points || 0) / Math.max(1, played * 2) : 0.5;
    const finishBonus = leaguePosition > 0 ? Math.max(0, teamsPerLeague + 1 - leaguePosition) : 0;
    const winRateBonus = played > 0 ? Math.round((won / played) * 8) : 0;
    const xpDelta = Math.max(6, finishBonus + winRateBonus + 4);

    await applyManagerXp({
      managerId,
      xpDelta,
      reputationDelta: leaguePosition <= 2 ? 4 : leaguePosition >= Math.max(teamsPerLeague - 1, 2) ? -4 : 1,
      dbClient
    });
    seasonBonusesApplied += 1;

    const shouldFireCpu =
      Boolean(row.is_ai) &&
      (leaguePosition >= Math.max(teamsPerLeague - 1, 2) || pointPct < 0.28) &&
      Math.random() < 0.55;
    if (shouldFireCpu) {
      await closeActiveManagerTeamStint(franchiseId, 'FIRED', dbClient);
      await dbClient.query(
        `UPDATE managers
         SET reputation = GREATEST(0, reputation - 10),
             updated_at = NOW()
         WHERE id = $1`,
        [managerId]
      );
      await dbClient.query(
        `UPDATE franchises
         SET current_manager_id = NULL
         WHERE id = $1`,
        [franchiseId]
      );

      fired += 1;
      await ensureCpuManagerForFranchise({
        franchiseId,
        competitionMode: mode,
        country: row.country,
        seasonId: null,
        dbClient,
        usedNameKeys
      });
      hired += 1;
    }
  }

  if (touchedManagers.size) {
    await dbClient.query(
      `UPDATE managers
       SET seasons_managed = seasons_managed + 1,
           updated_at = NOW()
       WHERE id = ANY($1::bigint[])`,
      [[...touchedManagers]]
    );
  }

  const trophyTallies = await dbClient.query(
    `SELECT f.current_manager_id AS manager_id,
            COUNT(*)::int AS title_count
     FROM trophy_cabinet tc
     JOIN franchises f ON f.id = tc.franchise_id
     WHERE tc.season_id = $1
       AND f.current_manager_id IS NOT NULL
     GROUP BY f.current_manager_id`,
    [seasonId]
  );

  for (const row of trophyTallies.rows) {
    await dbClient.query(
      `UPDATE managers
       SET titles_won = titles_won + $2,
           reputation = LEAST(100, reputation + $3),
           updated_at = NOW()
       WHERE id = $1`,
      [row.manager_id, Number(row.title_count || 0), Number(row.title_count || 0) * 3]
    );
  }

  await dbClient.query(
    `INSERT INTO transfer_feed (season_id, action_type, message)
     VALUES ($1, 'SEASON_NOTE', 'MANAGER_SEASON_FINALIZED')`,
    [seasonId]
  );

  return { seasonBonusesApplied, fired, hired };
}

export async function getManagerDirectory({ seasonId = null, mode = null, worldId = null, limit = 200, dbClient = pool } = {}) {
  const seasonParam = seasonId ? Number(seasonId) : null;
  const normalizedMode = mode ? normalizeCareerMode(mode) : null;
  const cappedLimit = Math.max(25, Math.min(500, Number(limit || 200)));

  const rows = await dbClient.query(
    `SELECT m.id,
            m.user_id,
            m.display_name,
            m.nationality,
            m.competition_mode,
            m.is_cpu,
            m.level,
            m.xp,
            m.reputation,
            m.seasons_managed,
            m.matches_managed,
            m.wins_managed,
            m.losses_managed,
            m.titles_won,
            f.id AS franchise_id,
            f.franchise_name,
            c.name AS city_name,
            c.country,
            COALESCE(st.league_tier, f.current_league_tier)::int AS league_tier,
            COALESCE(st.played, 0)::int AS played,
            COALESCE(st.won, 0)::int AS won,
            COALESCE(st.lost, 0)::int AS lost,
            COALESCE(st.points, 0)::int AS points,
            COALESCE(st.league_position, st.position)::int AS league_position
     FROM managers m
     LEFT JOIN franchises f ON f.current_manager_id = m.id
     LEFT JOIN cities c ON c.id = f.city_id
     LEFT JOIN season_teams st ON st.franchise_id = f.id AND st.season_id = $1
     WHERE ($2::text IS NULL OR m.competition_mode = $2)
       AND ($4::bigint IS NULL OR m.world_id = $4)
     ORDER BY m.level DESC, m.reputation DESC, m.titles_won DESC, m.matches_managed DESC
     LIMIT $3`,
    [seasonParam, normalizedMode, cappedLimit, worldId]
  );

  return rows.rows;
}

export async function getManagerProfile(managerId, dbClient = pool, worldId = null) {
  const manager = await dbClient.query(
    `SELECT m.id,
            m.user_id,
            m.display_name,
            m.nationality,
            m.competition_mode,
            m.is_cpu,
            m.level,
            m.xp,
            m.reputation,
            m.seasons_managed,
            m.matches_managed,
            m.wins_managed,
            m.losses_managed,
            m.titles_won,
            f.id AS franchise_id,
            f.franchise_name,
            c.name AS city_name,
            c.country
     FROM managers m
     LEFT JOIN franchises f ON f.current_manager_id = m.id
     LEFT JOIN cities c ON c.id = f.city_id
     WHERE m.id = $1
       AND ($2::bigint IS NULL OR m.world_id = $2 OR f.world_id = $2)
     LIMIT 1`,
    [managerId, worldId]
  );

  if (!manager.rows.length) {
    return null;
  }

  const stints = await dbClient.query(
    `SELECT mts.id,
            mts.franchise_id,
            mts.competition_mode,
            mts.season_id,
            mts.started_at,
            mts.ended_at,
            mts.end_reason,
            mts.matches_managed,
            mts.wins,
            mts.losses,
            f.franchise_name,
            c.name AS city_name,
            c.country
     FROM manager_team_stints mts
     JOIN franchises f ON f.id = mts.franchise_id
     JOIN cities c ON c.id = f.city_id
     WHERE mts.manager_id = $1
       AND ($2::bigint IS NULL OR f.world_id = $2)
     ORDER BY mts.started_at DESC
     LIMIT 40`,
    [managerId, worldId]
  );

  const recentMatches = await dbClient.query(
    `SELECT m.id,
            m.season_id,
            m.stage,
            m.round_no,
            m.status,
            m.result_summary,
            m.updated_at,
            hf.franchise_name AS home_name,
            af.franchise_name AS away_name,
            m.winner_franchise_id
     FROM matches m
     JOIN franchises hf ON hf.id = m.home_franchise_id
     JOIN franchises af ON af.id = m.away_franchise_id
     WHERE ($2::bigint IS NULL OR m.season_id IN (SELECT id FROM seasons WHERE world_id = $2))
       AND EXISTS (
       SELECT 1
       FROM manager_team_stints mts
       WHERE mts.manager_id = $1
         AND mts.franchise_id IN (m.home_franchise_id, m.away_franchise_id)
         AND m.updated_at >= mts.started_at
         AND (mts.ended_at IS NULL OR m.updated_at <= mts.ended_at)
     )
     ORDER BY m.updated_at DESC
     LIMIT 20`,
    [managerId, worldId]
  );

  return {
    manager: manager.rows[0],
    stints: stints.rows,
    recentMatches: recentMatches.rows
  };
}

export async function getManagerCareerSnapshot(userId, dbClient = pool, worldId = null) {
  const user = await getUserRow(userId, dbClient);
  if (!user) {
    const error = new Error('User not found.');
    error.status = 404;
    throw error;
  }

  const worldState = await dbClient.query(
    `SELECT COUNT(*)::int AS franchise_count
     FROM franchises
     WHERE ($1::bigint IS NULL OR world_id = $1)`,
    [worldId]
  );
  const worldFranchiseCount = Number(worldState.rows[0]?.franchise_count || 0);

  const stintCheck = await dbClient.query(
    `SELECT 1 FROM manager_stints WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  const hasEverManaged = stintCheck.rows.length > 0;

  const currentTeamResult = await dbClient.query(
    `SELECT f.id,
            f.franchise_name,
            f.competition_mode,
            f.current_league_tier,
            f.total_valuation,
            c.name AS city_name,
            c.country,
            COALESCE(st.played, 0)::int AS played,
            COALESCE(st.won, 0)::int AS won,
            COALESCE(st.lost, 0)::int AS lost,
            COALESCE(st.points, 0)::int AS points,
            COALESCE(st.league_position, st.position)::int AS league_position
     FROM franchises f
     JOIN cities c ON c.id = f.city_id
     LEFT JOIN seasons s ON s.status = 'ACTIVE' AND ($2::bigint IS NULL OR s.world_id = $2)
     LEFT JOIN season_teams st ON st.season_id = s.id AND st.franchise_id = f.id
     WHERE f.owner_user_id = $1
       AND ($2::bigint IS NULL OR f.world_id = $2)
     ORDER BY s.id DESC NULLS LAST
     LIMIT 1`,
    [userId, worldId]
  );

  const currentTeam = currentTeamResult.rows[0] || null;
  const activeSeason = await getActiveSeasonInfo(dbClient, worldId);

  let boardProfile = null;
  let boardExpectations = [];
  if (currentTeam && activeSeason) {
    boardProfile = await getOrCreateBoardProfile({
      userId,
      franchiseId: Number(currentTeam.id),
      seasonId: Number(activeSeason.id),
      dbClient
    });

    const context = await getFranchiseObjectiveContext({
      franchiseId: Number(currentTeam.id),
      seasonId: Number(activeSeason.id),
      dbClient
    });

    if (context && boardProfile) {
      boardExpectations = await upsertBoardExpectations({
        boardProfileId: Number(boardProfile.id),
        context,
        dbClient
      });
    }
  }

  const activeStint = (
    await dbClient.query(
      `SELECT id,
              user_id,
              franchise_id,
              competition_mode,
              started_at,
              ended_at,
              end_reason,
              matches_managed,
              wins,
              losses
       FROM manager_stints
       WHERE user_id = $1
         AND ended_at IS NULL
       ORDER BY started_at DESC
       LIMIT 1`,
      [userId]
    )
  ).rows[0] || null;

  let offers = await listManagerOffers(userId, dbClient, worldId);
  const managerStatus = String(user.manager_status || MANAGER_STATUSES.UNEMPLOYED).toUpperCase();
  if (
    managerStatus === MANAGER_STATUSES.UNEMPLOYED &&
    worldFranchiseCount > 0 &&
    !offers.some((offer) => String(offer.status || '').toUpperCase() === OFFER_STATUSES.PENDING)
  ) {
    offers = await generateManagerOffersForUser(userId, { worldId, dbClient });
  }
  const unlockState = await determineApplyUnlockState(user, dbClient, worldId);
  const applyMarket = unlockState.unlocked
    ? await listApplyMarketCandidates({
      userId,
      mode: normalizeCareerMode(user.career_mode || currentTeam?.competition_mode || CAREER_MODES.CLUB),
      worldId,
      dbClient
    })
    : [];

  return {
    manager: {
      id: Number(user.id),
      careerMode: normalizeCareerMode(user.career_mode || CAREER_MODES.CLUB),
      status: managerStatus,
      points: Number(user.manager_points || 0),
      unemployedSince: user.manager_unemployed_since,
      retiredAt: user.manager_retired_at,
      firings: Number(user.manager_firings || 0),
      titles: Number(user.manager_titles || 0),
      matchesManaged: Number(user.manager_matches_managed || 0),
      winsManaged: Number(user.manager_wins_managed || 0),
      lossesManaged: Number(user.manager_losses_managed || 0)
    },
    worldFranchiseCount,
    hasEverManaged,
    currentTeam,
    activeSeason,
    activeStint,
    board: boardProfile
      ? {
        ...boardProfile,
        confidence: Number(boardProfile.confidence || 0),
        objectives: boardExpectations
      }
      : null,
    unemployed: {
      ...unlockState,
      offers,
      applyMarket
    }
  };
}
