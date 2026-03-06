import pool from '../config/db.js';
import { calculateFranchiseValuation } from './valuationService.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roleBonus(role, skill) {
  const normalized = String(role || '').toUpperCase();

  if (skill === 'batting') {
    if (normalized === 'BATTER') return 10;
    if (normalized === 'WICKET_KEEPER') return 5;
    if (normalized === 'ALL_ROUNDER') return 5;
    return -16;
  }

  if (skill === 'bowling') {
    if (normalized === 'BOWLER') return 10;
    if (normalized === 'ALL_ROUNDER') return 5;
    if (normalized === 'BATTER') return -16;
    return -26;
  }

  if (skill === 'fielding') {
    if (normalized === 'WICKET_KEEPER') return 10;
    if (normalized === 'ALL_ROUNDER') return 3;
    if (normalized === 'BOWLER') return 2;
    return 1;
  }

  if (skill === 'fitness') {
    if (normalized === 'ALL_ROUNDER') return 3;
    if (normalized === 'BOWLER') return 2;
    return 1;
  }

  return 1;
}

function roleSkillCap(role, skill) {
  const normalized = String(role || '').toUpperCase();
  const caps = {
    BATTER: { batting: 96, bowling: 24, fielding: 84, fitness: 90, temperament: 90 },
    BOWLER: { batting: 36, bowling: 96, fielding: 86, fitness: 92, temperament: 90 },
    ALL_ROUNDER: { batting: 90, bowling: 90, fielding: 88, fitness: 92, temperament: 92 },
    WICKET_KEEPER: { batting: 90, bowling: 4, fielding: 97, fitness: 90, temperament: 93 }
  };
  return caps[normalized]?.[skill] || 90;
}

function roleSkillFloor(role, skill) {
  const normalized = String(role || '').toUpperCase();
  const floors = {
    BATTER: { batting: 24, bowling: 0, fielding: 20, fitness: 24, temperament: 20 },
    BOWLER: { batting: 0, bowling: 24, fielding: 20, fitness: 24, temperament: 20 },
    ALL_ROUNDER: { batting: 20, bowling: 20, fielding: 20, fitness: 24, temperament: 20 },
    WICKET_KEEPER: { batting: 20, bowling: 0, fielding: 28, fitness: 24, temperament: 22 }
  };
  return floors[normalized]?.[skill] || 18;
}

function computeMarketValue(player) {
  const weighted =
    Number(player.batting || 0) * 0.26 +
    Number(player.bowling || 0) * 0.26 +
    Number(player.fielding || 0) * 0.2 +
    Number(player.fitness || 0) * 0.14 +
    Number(player.temperament || 0) * 0.14;
  return Number((5 + weighted * 0.11 + Number(player.potential || 0) * 0.05).toFixed(2));
}

function overallOf(player) {
  const sum =
    Number(player.batting || 0) +
    Number(player.bowling || 0) +
    Number(player.fielding || 0) +
    Number(player.fitness || 0) +
    Number(player.temperament || 0);
  return Number((sum / 5).toFixed(2));
}

export async function rebalanceSeasonPlayers({ seasonId = null, dryRun = false } = {}, dbClient = pool) {
  let targetSeasonId = Number(seasonId || 0) || null;
  if (!targetSeasonId) {
    const season = await dbClient.query(
      `SELECT id
       FROM seasons
       WHERE status = 'ACTIVE'
       ORDER BY id DESC
       LIMIT 1`
    );
    if (!season.rows.length) {
      return { seasonId: null, changedPlayers: 0, changedFranchises: 0, dryRun: Boolean(dryRun) };
    }
    targetSeasonId = Number(season.rows[0].id);
  }

  const franchises = await dbClient.query(
    `SELECT st.franchise_id, st.league_tier, f.academy_level
     FROM season_teams st
     JOIN franchises f ON f.id = st.franchise_id
     WHERE st.season_id = $1`,
    [targetSeasonId]
  );

  if (!franchises.rows.length) {
    return { seasonId: targetSeasonId, changedPlayers: 0, changedFranchises: 0, dryRun: Boolean(dryRun) };
  }

  const tierByFranchiseId = new Map();
  const academyByFranchiseId = new Map();
  const franchiseIds = [];

  for (const row of franchises.rows) {
    const id = Number(row.franchise_id);
    franchiseIds.push(id);
    tierByFranchiseId.set(id, Number(row.league_tier || 4));
    academyByFranchiseId.set(id, Number(row.academy_level || 1));
  }

  const players = await dbClient.query(
    `SELECT id,
            franchise_id,
            role,
            potential,
            batting,
            bowling,
            fielding,
            fitness,
            temperament,
            market_value,
            salary,
            form,
            morale,
            squad_status
     FROM players
     WHERE franchise_id = ANY($1::bigint[])
       AND squad_status IN ('MAIN_SQUAD', 'YOUTH', 'LOANED')`,
    [franchiseIds]
  );

  let changedPlayers = 0;
  const touchedFranchises = new Set();
  const tierSummary = new Map();

  for (const player of players.rows) {
    const franchiseId = Number(player.franchise_id);
    const leagueTier = Number(tierByFranchiseId.get(franchiseId) || 4);
    const academyLevel = Number(academyByFranchiseId.get(franchiseId) || 1);
    const potential = Number(player.potential || 0);

    const leagueBoost = (5 - clamp(leagueTier, 1, 4)) * 1.25;
    const base = 30 + potential * 0.44 + academyLevel * 0.55 + leagueBoost * 0.7;

    const battingCap = clamp(
      Math.min(Math.round(base + roleBonus(player.role, 'batting')), roleSkillCap(player.role, 'batting')),
      roleSkillFloor(player.role, 'batting'),
      roleSkillCap(player.role, 'batting')
    );
    const bowlingCap = clamp(
      Math.min(Math.round(base + roleBonus(player.role, 'bowling')), roleSkillCap(player.role, 'bowling')),
      roleSkillFloor(player.role, 'bowling'),
      roleSkillCap(player.role, 'bowling')
    );
    const fieldingCap = clamp(
      Math.min(Math.round(base - 2 + roleBonus(player.role, 'fielding')), roleSkillCap(player.role, 'fielding')),
      roleSkillFloor(player.role, 'fielding'),
      roleSkillCap(player.role, 'fielding')
    );
    const fitnessCap = clamp(
      Math.min(Math.round(base - 3 + roleBonus(player.role, 'fitness')), roleSkillCap(player.role, 'fitness')),
      roleSkillFloor(player.role, 'fitness'),
      roleSkillCap(player.role, 'fitness')
    );
    const temperamentCap = clamp(
      Math.min(Math.round(base - 5 + roleBonus(player.role, 'temperament')), roleSkillCap(player.role, 'temperament')),
      roleSkillFloor(player.role, 'temperament'),
      roleSkillCap(player.role, 'temperament')
    );

    const nextBatting = Math.min(Number(player.batting || 0), battingCap);
    const nextBowling = Math.min(Number(player.bowling || 0), bowlingCap);
    const nextFielding = Math.min(Number(player.fielding || 0), fieldingCap);
    const nextFitness = Math.min(Number(player.fitness || 0), fitnessCap);
    const nextTemperament = Math.min(Number(player.temperament || 0), temperamentCap);
    const nextForm = Math.min(Number(player.form || 0), 85);
    const nextMorale = Math.min(Number(player.morale || 0), 85);

    const changed =
      nextBatting !== Number(player.batting || 0) ||
      nextBowling !== Number(player.bowling || 0) ||
      nextFielding !== Number(player.fielding || 0) ||
      nextFitness !== Number(player.fitness || 0) ||
      nextTemperament !== Number(player.temperament || 0) ||
      nextForm !== Number(player.form || 0) ||
      nextMorale !== Number(player.morale || 0);

    if (!changed) {
      continue;
    }

    const beforeOverall = overallOf(player);
    const projected = {
      ...player,
      batting: nextBatting,
      bowling: nextBowling,
      fielding: nextFielding,
      fitness: nextFitness,
      temperament: nextTemperament
    };
    const afterOverall = overallOf(projected);
    const nextMarketValue = computeMarketValue(projected);
    const nextSalary = Number((0.5 + nextMarketValue * 0.06).toFixed(2));

    if (!dryRun) {
      await dbClient.query(
        `UPDATE players
         SET batting = $2,
             bowling = $3,
             fielding = $4,
             fitness = $5,
             temperament = $6,
             market_value = $7,
             salary = $8,
             form = $9,
             morale = $10
         WHERE id = $1`,
        [player.id, nextBatting, nextBowling, nextFielding, nextFitness, nextTemperament, nextMarketValue, nextSalary, nextForm, nextMorale]
      );
    }

    changedPlayers += 1;
    touchedFranchises.add(franchiseId);
    const key = `L${leagueTier}`;
    const bucket = tierSummary.get(key) || { changedPlayers: 0, ovrDrop: 0 };
    bucket.changedPlayers += 1;
    bucket.ovrDrop += Math.max(0, beforeOverall - afterOverall);
    tierSummary.set(key, bucket);
  }

  if (!dryRun) {
    for (const franchiseId of touchedFranchises) {
      await calculateFranchiseValuation(franchiseId, targetSeasonId, dbClient);
    }
  }

  return {
    seasonId: targetSeasonId,
    changedPlayers,
    changedFranchises: touchedFranchises.size,
    dryRun: Boolean(dryRun),
    byLeague: Array.from(tierSummary.entries()).map(([league, info]) => ({
      league,
      changedPlayers: info.changedPlayers,
      avgOverallDrop: Number((info.changedPlayers ? info.ovrDrop / info.changedPlayers : 0).toFixed(2))
    }))
  };
}
