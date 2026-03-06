import pool from '../config/db.js';

function roleOf(player) {
  return String(player?.role || '').toUpperCase();
}

function battingScore(player) {
  const role = roleOf(player);
  const roleBonus = role === 'BATTER' ? 7 : role === 'WICKET_KEEPER' ? 5 : role === 'ALL_ROUNDER' ? 3 : -5;
  return (
    Number(player.batting || 0) * 0.62 +
    Number(player.form || 0) * 0.14 +
    Number(player.morale || 0) * 0.1 +
    Number(player.temperament || 0) * 0.09 +
    Number(player.fitness || 0) * 0.05 +
    roleBonus
  );
}

function bowlingScore(player) {
  const role = roleOf(player);
  const roleBonus = role === 'BOWLER' ? 7 : role === 'ALL_ROUNDER' ? 4 : role === 'BATTER' ? -4 : -6;
  return (
    Number(player.bowling || 0) * 0.65 +
    Number(player.form || 0) * 0.12 +
    Number(player.fitness || 0) * 0.11 +
    Number(player.morale || 0) * 0.07 +
    Number(player.temperament || 0) * 0.05 +
    roleBonus
  );
}

function xiScore(player) {
  const role = roleOf(player);
  const roleBonus = role === 'ALL_ROUNDER' ? 3 : role === 'WICKET_KEEPER' ? 2 : role === 'BATTER' ? 1 : 0;
  return (
    Number(player.batting || 0) * 0.35 +
    Number(player.bowling || 0) * 0.32 +
    Number(player.fielding || 0) * 0.12 +
    Number(player.fitness || 0) * 0.1 +
    Number(player.form || 0) * 0.06 +
    Number(player.morale || 0) * 0.05 +
    roleBonus
  );
}

function sortDescBy(list, scorer) {
  return [...list].sort((a, b) => scorer(b) - scorer(a));
}

function uniquePlayers(players) {
  const map = new Map();
  for (const player of players || []) {
    const id = Number(player.id || 0);
    if (!id || map.has(id)) {
      continue;
    }
    map.set(id, player);
  }
  return [...map.values()];
}

function pickBestBalancedXI(players) {
  const eligible = uniquePlayers(players);
  if (eligible.length <= 11) {
    return eligible;
  }

  const keepers = sortDescBy(eligible.filter((p) => roleOf(p) === 'WICKET_KEEPER'), battingScore);
  const batters = sortDescBy(eligible.filter((p) => roleOf(p) === 'BATTER'), battingScore);
  const allRounders = sortDescBy(eligible.filter((p) => roleOf(p) === 'ALL_ROUNDER'), xiScore);
  const bowlers = sortDescBy(eligible.filter((p) => roleOf(p) === 'BOWLER'), bowlingScore);

  const selected = [];
  const selectedIds = new Set();

  // Core balance: 1 WK, 4 BAT, 2 AR, 4 BOWL (with fallback fill if role depth is limited).
  for (const keeper of keepers.slice(0, 1)) {
    selected.push(keeper);
    selectedIds.add(Number(keeper.id));
  }

  for (const batter of batters) {
    if (selected.length >= 5) break;
    const id = Number(batter.id);
    if (!selectedIds.has(id)) {
      selected.push(batter);
      selectedIds.add(id);
    }
  }

  for (const ar of allRounders) {
    if (selected.length >= 7) break;
    const id = Number(ar.id);
    if (!selectedIds.has(id)) {
      selected.push(ar);
      selectedIds.add(id);
    }
  }

  for (const bowler of bowlers) {
    if (selected.length >= 11) break;
    const id = Number(bowler.id);
    if (!selectedIds.has(id)) {
      selected.push(bowler);
      selectedIds.add(id);
    }
  }

  if (!selected.some((p) => roleOf(p) === 'WICKET_KEEPER')) {
    const fallbackKeeper = sortDescBy(eligible.filter((p) => roleOf(p) === 'WICKET_KEEPER'), battingScore)[0];
    if (fallbackKeeper) {
      const id = Number(fallbackKeeper.id);
      if (!selectedIds.has(id)) {
        selected.push(fallbackKeeper);
        selectedIds.add(id);
      }
    }
  }

  const remaining = sortDescBy(
    eligible.filter((p) => !selectedIds.has(Number(p.id || 0))),
    xiScore
  );
  for (const player of remaining) {
    if (selected.length >= 11) {
      break;
    }
    selected.push(player);
    selectedIds.add(Number(player.id));
  }

  if (selected.length > 11) {
    const keepersInSelected = selected.filter((p) => roleOf(p) === 'WICKET_KEEPER');
    const mustKeepKeeper = keepersInSelected.length > 0 ? Number(keepersInSelected[0].id) : null;
    const removable = sortDescBy(selected, xiScore).reverse();
    for (const player of removable) {
      if (selected.length <= 11) {
        break;
      }
      const id = Number(player.id);
      if (mustKeepKeeper && id === mustKeepKeeper) {
        continue;
      }
      const index = selected.findIndex((item) => Number(item.id) === id);
      if (index >= 0) {
        selected.splice(index, 1);
      }
    }
  }

  return selected.slice(0, 11);
}

function orderLineupPlayers(players) {
  const unique = uniquePlayers(players);
  if (!unique.length) {
    return [];
  }

  const nonBowlers = sortDescBy(unique.filter((p) => roleOf(p) !== 'BOWLER'), battingScore);
  const pureBowlers = sortDescBy(unique.filter((p) => roleOf(p) === 'BOWLER'), bowlingScore);

  const order = [];
  const push = (player) => {
    if (!player) return;
    const id = Number(player.id || 0);
    if (!id || order.some((existing) => Number(existing.id) === id)) {
      return;
    }
    order.push(player);
  };

  // Top 5 should be batting-focused whenever possible.
  for (const player of nonBowlers.slice(0, 5)) {
    push(player);
  }

  // #6-#7: best remaining all-round/keeper/batting options.
  const middleCandidates = sortDescBy(
    nonBowlers.filter((p) => !order.some((existing) => Number(existing.id) === Number(p.id))),
    battingScore
  );
  for (const player of middleCandidates.slice(0, 2)) {
    push(player);
  }

  // Tail: bowling-heavy order.
  const tailCandidates = [
    ...pureBowlers,
    ...unique.filter((p) => !order.some((existing) => Number(existing.id) === Number(p.id)))
  ];
  for (const player of tailCandidates) {
    push(player);
  }

  return order.slice(0, 11);
}

async function fetchEligiblePlayers(franchiseId, dbClient = pool) {
  const result = await dbClient.query(
    `SELECT id,
            franchise_id,
            role,
            batting,
            bowling,
            fielding,
            fitness,
            temperament,
            form,
            morale,
            potential,
            squad_status,
            starting_xi,
            lineup_slot
     FROM players
     WHERE franchise_id = $1
       AND squad_status IN ('MAIN_SQUAD', 'YOUTH')`,
    [franchiseId]
  );
  return result.rows;
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (Number(a[i]) !== Number(b[i])) return false;
  }
  return true;
}

function lineupStrength(players) {
  return players.reduce((sum, player) => sum + xiScore(player), 0);
}

function isBalancedLineup(players) {
  const rows = players || [];
  if (rows.length !== 11) {
    return false;
  }

  const wicketKeepers = rows.filter((row) => roleOf(row) === 'WICKET_KEEPER').length;
  const bowlingOptions = rows.filter((row) => ['BOWLER', 'ALL_ROUNDER'].includes(roleOf(row))).length;
  const topFourBowlers = rows
    .slice(0, 4)
    .filter((row) => roleOf(row) === 'BOWLER').length;

  return wicketKeepers >= 1 && bowlingOptions >= 5 && topFourBowlers <= 1;
}

async function applyLineup(franchiseId, playerIds, dbClient = pool) {
  const orderedIds = playerIds.map((id) => Number(id)).filter(Boolean).slice(0, 11);
  if (!orderedIds.length) {
    await dbClient.query(
      `UPDATE players
       SET starting_xi = FALSE,
           lineup_slot = NULL
       WHERE franchise_id = $1
         AND (starting_xi = TRUE OR lineup_slot IS NOT NULL)`,
      [franchiseId]
    );
    return [];
  }

  await dbClient.query(
    `UPDATE players
     SET starting_xi = FALSE,
         lineup_slot = NULL
     WHERE franchise_id = $1
       AND (starting_xi = TRUE OR lineup_slot IS NOT NULL)`,
    [franchiseId]
  );

  await dbClient.query(
    `UPDATE players
     SET starting_xi = TRUE,
         lineup_slot = ordered.slot::int,
         squad_status = CASE WHEN squad_status = 'YOUTH' THEN 'MAIN_SQUAD' ELSE squad_status END,
         is_youth = CASE WHEN squad_status = 'YOUTH' THEN FALSE ELSE is_youth END
     FROM (
       SELECT player_id::bigint, slot::int
       FROM unnest($1::bigint[]) WITH ORDINALITY AS t(player_id, slot)
     ) AS ordered
     WHERE players.id = ordered.player_id
       AND players.franchise_id = $2
       AND players.squad_status IN ('MAIN_SQUAD', 'YOUTH')`,
    [orderedIds, franchiseId]
  );

  return orderedIds;
}

export async function setFranchiseLineup(franchiseId, playerIds, dbClient = pool, options = {}) {
  const { normalizeOrder = true } = options;
  const eligible = await fetchEligiblePlayers(franchiseId, dbClient);
  const eligibleById = new Map(eligible.map((row) => [Number(row.id), row]));
  const chosenPlayers = playerIds.map((id) => eligibleById.get(Number(id))).filter(Boolean);
  const ordered = normalizeOrder ? orderLineupPlayers(chosenPlayers) : uniquePlayers(chosenPlayers);
  return applyLineup(franchiseId, ordered.map((player) => Number(player.id)), dbClient);
}

export async function ensureFranchiseLineup(franchiseId, dbClient = pool, options = {}) {
  const { mode = 'smart' } = options;
  const eligible = await fetchEligiblePlayers(franchiseId, dbClient);
  if (!eligible.length) {
    return [];
  }

  const eligibleById = new Map(eligible.map((row) => [Number(row.id), row]));
  const currentLineup = eligible
    .filter((row) => Number(row.starting_xi))
    .sort((a, b) => Number(a.lineup_slot || 99) - Number(b.lineup_slot || 99))
    .slice(0, 11);

  let selectedPlayers = [];
  const bestPlayers = pickBestBalancedXI(eligible);

  if (mode === 'auto') {
    selectedPlayers = bestPlayers;
  } else if (currentLineup.length >= 11) {
    const bestStrength = lineupStrength(bestPlayers);
    const currentStrength = lineupStrength(currentLineup);
    const isCurrentBalanced = isBalancedLineup(currentLineup);
    selectedPlayers = !isCurrentBalanced || bestStrength > currentStrength + 1.5 ? bestPlayers : currentLineup;
  } else if (currentLineup.length > 0) {
    const selectedIds = new Set(currentLineup.map((row) => Number(row.id)));
    const merged = [...currentLineup];
    for (const player of bestPlayers) {
      const id = Number(player.id);
      if (merged.length >= 11) break;
      if (!selectedIds.has(id)) {
        merged.push(player);
        selectedIds.add(id);
      }
    }
    if (merged.length < 11) {
      const remaining = sortDescBy(
        eligible.filter((row) => !selectedIds.has(Number(row.id))),
        xiScore
      );
      for (const player of remaining) {
        if (merged.length >= 11) break;
        merged.push(player);
      }
    }
    selectedPlayers = merged.slice(0, 11);
  } else {
    selectedPlayers = bestPlayers;
  }

  if (selectedPlayers.length < 11) {
    const selectedIds = new Set(selectedPlayers.map((row) => Number(row.id)));
    const fallback = sortDescBy(
      eligible.filter((row) => !selectedIds.has(Number(row.id))),
      xiScore
    );
    for (const row of fallback) {
      if (selectedPlayers.length >= 11) break;
      selectedPlayers.push(row);
    }
  }

  selectedPlayers = orderLineupPlayers(selectedPlayers.slice(0, 11)).map((row) => eligibleById.get(Number(row.id)) || row);
  const nextIds = selectedPlayers.map((row) => Number(row.id)).slice(0, 11);
  const currentIds = currentLineup.map((row) => Number(row.id)).slice(0, 11);

  if (!arraysEqual(nextIds, currentIds) || currentLineup.length !== 11) {
    return applyLineup(franchiseId, nextIds, dbClient);
  }

  return currentIds;
}
