import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import Panel from '../components/Panel';
import SimpleTable from '../components/SimpleTable';
import { useSocket } from '../context/SocketContext';

function oversFromBalls(balls) {
  const complete = Math.floor(Number(balls || 0) / 6);
  const rem = Number(balls || 0) % 6;
  return `${complete}.${rem}`;
}

function scoreLabel(runs, wickets, balls) {
  if (runs == null) {
    return '-';
  }

  return `${runs}/${wickets} (${oversFromBalls(balls)})`;
}

function teamNameById(row, franchiseId) {
  const id = Number(franchiseId || 0);
  const homeId = Number(row.home_franchise_id || 0);
  const awayId = Number(row.away_franchise_id || 0);

  if (id === homeId) {
    return row.home_franchise_name || 'Home';
  }
  if (id === awayId) {
    return row.away_franchise_name || 'Away';
  }
  return `Franchise ${id || '?'}`;
}

function teamCountryById(row, franchiseId) {
  const id = Number(franchiseId || 0);
  const homeId = Number(row.home_franchise_id || 0);
  const awayId = Number(row.away_franchise_id || 0);

  if (id === homeId) {
    return row.home_country || '-';
  }
  if (id === awayId) {
    return row.away_country || '-';
  }
  return '-';
}

function teamDisplayById(row, franchiseId) {
  return `${teamNameById(row, franchiseId)} (${teamCountryById(row, franchiseId)})`;
}

function venueTagById(row, franchiseId) {
  const id = Number(franchiseId || 0);
  if (id === Number(row.home_franchise_id || 0)) {
    return 'H';
  }
  if (id === Number(row.away_franchise_id || 0)) {
    return 'A';
  }
  return '?';
}

function scoreByTeamId(row, franchiseId) {
  const id = Number(franchiseId || 0);
  const homeId = Number(row.home_franchise_id || 0);
  const awayId = Number(row.away_franchise_id || 0);

  if (id === homeId) {
    return scoreLabel(row.home_score, row.home_wickets, row.home_balls);
  }
  if (id === awayId) {
    return scoreLabel(row.away_score, row.away_wickets, row.away_balls);
  }
  return '-';
}

function inningsOrder(row) {
  const homeId = Number(row.home_franchise_id || 0);
  const awayId = Number(row.away_franchise_id || 0);
  const tossWinnerId = Number(row.toss_winner_franchise_id || 0);
  const tossDecision = String(row.toss_decision || '').toUpperCase();

  if (tossWinnerId && (tossDecision === 'BAT' || tossDecision === 'BOWL')) {
    const first = tossDecision === 'BAT' ? tossWinnerId : tossWinnerId === homeId ? awayId : homeId;
    const second = first === homeId ? awayId : homeId;
    return { first, second };
  }

  return { first: homeId, second: awayId };
}

function inningsLabel(row, inningsNo) {
  const order = inningsOrder(row);
  const teamId = inningsNo === 1 ? order.first : order.second;
  return `${teamDisplayById(row, teamId)} (${venueTagById(row, teamId)}) - ${scoreByTeamId(row, teamId)}`;
}

function winnerLabel(row) {
  const winnerId = Number(row.winner_franchise_id || 0);
  if (winnerId) {
    return teamDisplayById(row, winnerId);
  }

  if (String(row.status || '').toUpperCase() === 'COMPLETED' && row.home_score != null && row.away_score != null) {
    if (Number(row.home_score) === Number(row.away_score)) {
      return 'Tie';
    }
    return row.result_summary || 'Completed';
  }

  return '-';
}

function roundStatus(round) {
  if (Number(round.completed_matches) === Number(round.total_matches)) {
    return 'completed';
  }

  if (Number(round.completed_matches) > 0) {
    return 'in-progress';
  }

  return 'pending';
}

export default function FixturesResultsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { subscribe } = useSocket();

  const [seasons, setSeasons] = useState([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState(Number(searchParams.get('season') || 0) || null);
  const [rounds, setRounds] = useState([]);
  const [selectedRound, setSelectedRound] = useState(Number(searchParams.get('round') || 0) || null);
  const [selectedLeagueTier, setSelectedLeagueTier] = useState(Number(searchParams.get('league') || 0) || 0);
  const [fixtures, setFixtures] = useState([]);
  const [allFixtures, setAllFixtures] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  function filterRoundFixtures(allRows, roundNo, leagueTier = 0) {
    return (allRows || []).filter(
      (fixture) =>
        fixture.stage === 'REGULAR' &&
        Number(fixture.round_no) === Number(roundNo) &&
        (!leagueTier || Number(fixture.league_tier) === Number(leagueTier))
    );
  }

  function syncQueryParams(seasonId, roundNo, leagueTier) {
    const next = {};
    if (seasonId) {
      next.season = String(seasonId);
    }
    if (roundNo) {
      next.round = String(roundNo);
    }
    if (leagueTier) {
      next.league = String(leagueTier);
    }
    setSearchParams(next, { replace: true });
  }

  async function loadSeason(nextSeasonId = null, nextRound = null) {
    setError('');
    setLoading(true);

    try {
      const seasonResponse = await api.league.seasons();
      const seasonRows = seasonResponse.seasons || [];
      setSeasons(seasonRows);

      const querySeason = Number(searchParams.get('season') || 0) || null;
      const requestedSeason = nextSeasonId || selectedSeasonId || querySeason;
      const resolvedSeason =
        (requestedSeason && seasonRows.find((season) => Number(season.id) === Number(requestedSeason))) || seasonRows[0] || null;

      if (!resolvedSeason?.id) {
        setSelectedSeasonId(null);
        setRounds([]);
        setFixtures([]);
        setAllFixtures([]);
        setSelectedRound(null);
        syncQueryParams(null, null, null);
        return;
      }

      const seasonId = Number(resolvedSeason.id);
      setSelectedSeasonId(seasonId);

      const [roundsResponse, allFixturesResponse] = await Promise.all([api.league.rounds(seasonId), api.league.fixtures(seasonId)]);
      const roundRows = roundsResponse.rounds || [];
      const fixtureRows = allFixturesResponse.fixtures || [];

      setRounds(roundRows);
      setAllFixtures(fixtureRows);

      const queryRound = Number(searchParams.get('round') || 0);
      const firstPending = roundRows.find((round) => Number(round.completed_matches) < Number(round.total_matches))?.round_no;
      const fallbackRound = firstPending || roundRows[0]?.round_no || null;
      const resolvedRoundCandidate = nextRound || selectedRound || queryRound || fallbackRound;
      const resolvedRound =
        resolvedRoundCandidate && roundRows.some((round) => Number(round.round_no) === Number(resolvedRoundCandidate))
          ? Number(resolvedRoundCandidate)
          : fallbackRound || null;

      setSelectedRound(resolvedRound);
      setFixtures(filterRoundFixtures(fixtureRows, resolvedRound, selectedLeagueTier));
      syncQueryParams(seasonId, resolvedRound, selectedLeagueTier);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  async function changeRound(roundNo) {
    if (!roundNo || !seasonId) {
      return;
    }

    setError('');
    setSelectedRound(roundNo);
    setFixtures(filterRoundFixtures(allFixtures, roundNo, selectedLeagueTier));
    syncQueryParams(selectedSeasonId, roundNo, selectedLeagueTier);
  }

  async function changeSeason(seasonId) {
    if (!seasonId) {
      return;
    }

    setSelectedSeasonId(seasonId);
    await loadSeason(seasonId, null);
  }

  useEffect(() => {
    loadSeason();
  }, []);

  useEffect(() => {
    const offLeagueUpdate = subscribe('league:update', async (message) => {
      const seasonFromEvent = Number(message.payload?.seasonId || 0);
      const currentSeasonId = Number(selectedSeasonId || 0);
      if (!seasonFromEvent || !currentSeasonId || seasonFromEvent !== currentSeasonId) {
        return;
      }

      try {
        const [roundsResponse, allFixturesResponse] = await Promise.all([api.league.rounds(currentSeasonId), api.league.fixtures(currentSeasonId)]);
        const roundRows = roundsResponse.rounds || [];
        const fixtureRows = allFixturesResponse.fixtures || [];

        setRounds(roundRows);
        setAllFixtures(fixtureRows);
        setFixtures(filterRoundFixtures(fixtureRows, selectedRound, selectedLeagueTier));
      } catch {
        // Ignore transient websocket refresh failures.
      }
    });

    return () => {
      offLeagueUpdate();
    };
  }, [subscribe, selectedSeasonId, selectedRound, selectedLeagueTier]);

  const seasonMeta = useMemo(
    () => seasons.find((season) => Number(season.id) === Number(selectedSeasonId)) || null,
    [seasons, selectedSeasonId]
  );

  const seasonId = selectedSeasonId;
  const playoffFixtures = useMemo(() => (allFixtures || []).filter((fixture) => fixture.stage === 'PLAYOFF'), [allFixtures]);
  const finalFixtures = useMemo(() => (allFixtures || []).filter((fixture) => fixture.stage === 'FINAL'), [allFixtures]);

  const fixtureColumns = [
    { key: 'league_tier', label: 'League', render: (value) => (value ? `League ${value}` : '-') },
    { key: 'home_franchise_name', label: 'Home', render: (_, row) => `${row.home_franchise_name} (${row.home_country || '-'})` },
    { key: 'away_franchise_name', label: 'Away', render: (_, row) => `${row.away_franchise_name} (${row.away_country || '-'})` },
    { key: 'status', label: 'Status' },
    { key: 'winner_franchise_id', label: 'Winner', render: (_, row) => winnerLabel(row) },
    { key: 'innings_1', label: 'Innings 1', render: (_, row) => inningsLabel(row, 1) },
    { key: 'innings_2', label: 'Innings 2', render: (_, row) => inningsLabel(row, 2) },
    {
      key: 'open',
      label: 'Match Center',
      render: (_, row) => (
        <button
          type="button"
          onClick={() =>
            navigate(`/matches/${row.id}?season=${seasonId || ''}&round=${selectedRound || row.round_no}`)
          }
        >
          Open Match
        </button>
      )
    }
  ];

  const knockoutColumns = [
    { key: 'matchday_label', label: 'Match' },
    { key: 'home_franchise_name', label: 'Home', render: (_, row) => `${row.home_franchise_name} (${row.home_country || '-'})` },
    { key: 'away_franchise_name', label: 'Away', render: (_, row) => `${row.away_franchise_name} (${row.away_country || '-'})` },
    { key: 'status', label: 'Status' },
    { key: 'winner_franchise_id', label: 'Winner', render: (_, row) => winnerLabel(row) },
    { key: 'innings_1', label: 'Innings 1', render: (_, row) => inningsLabel(row, 1) },
    { key: 'innings_2', label: 'Innings 2', render: (_, row) => inningsLabel(row, 2) },
    {
      key: 'open',
      label: 'Match Center',
      render: (_, row) => (
        <button
          type="button"
          onClick={() =>
            navigate(`/matches/${row.id}?season=${seasonId || ''}&round=${selectedRound || row.round_no}`)
          }
        >
          Open Match
        </button>
      )
    }
  ];

  const selectedRoundIndex = useMemo(
    () => rounds.findIndex((round) => Number(round.round_no) === Number(selectedRound)),
    [rounds, selectedRound]
  );

  const visibleRounds = useMemo(() => {
    if (!rounds.length) {
      return [];
    }

    const anchor = selectedRoundIndex >= 0 ? selectedRoundIndex : 0;
    let start = Math.max(0, anchor - 5);
    let end = Math.min(rounds.length, start + 12);

    if (end - start < 12) {
      start = Math.max(0, end - 12);
    }

    return rounds.slice(start, end);
  }, [rounds, selectedRoundIndex]);

  const completedRounds = useMemo(
    () => rounds.filter((round) => Number(round.completed_matches) === Number(round.total_matches)).length,
    [rounds]
  );

  const currentRoundMeta = useMemo(
    () => rounds.find((round) => Number(round.round_no) === Number(selectedRound)) || null,
    [rounds, selectedRound]
  );

  const previousRound = selectedRoundIndex > 0 ? rounds[selectedRoundIndex - 1]?.round_no : null;
  const nextRound = selectedRoundIndex >= 0 && selectedRoundIndex < rounds.length - 1 ? rounds[selectedRoundIndex + 1]?.round_no : null;

  function changeLeagueFilter(nextLeagueTier) {
    setSelectedLeagueTier(nextLeagueTier);
    setFixtures(filterRoundFixtures(allFixtures, selectedRound, nextLeagueTier));
    syncQueryParams(selectedSeasonId, selectedRound, nextLeagueTier);
  }

  if (loading) {
    return <div className="loading-state">Loading season center...</div>;
  }

  return (
    <div className="page-grid">
      {error ? <p className="error-text full-width">{error}</p> : null}

      <Panel title="Season Archive" className="full-width">
        {!seasons.length ? (
          <div className="empty-state">No seasons available yet.</div>
        ) : (
          <div className="round-selector">
            {seasons.map((season) => (
              <button
                key={season.id}
                type="button"
                className={Number(season.id) === Number(selectedSeasonId) ? 'active' : ''}
                onClick={() => changeSeason(season.id)}
              >
                {season.name} ({season.status})
              </button>
            ))}
          </div>
        )}
      </Panel>

      <Panel title={seasonMeta ? `${seasonMeta.name} - Regular Season Rounds` : 'Regular Season Rounds'} className="full-width">
        {!seasonMeta ? (
          <div className="empty-state">Select a season to view fixtures.</div>
        ) : (
          <>
            <div className="round-browser">
              <button type="button" className="round-nav-btn" disabled={!previousRound} onClick={() => changeRound(previousRound)}>
                Previous
              </button>
              <div className="round-browser-meta">
                <p>
                  Round <strong>{selectedRound || '-'}</strong> of {rounds.length}
                </p>
                <small>
                  Completed rounds: {completedRounds} / {rounds.length}
                </small>
              </div>
              <button type="button" className="round-nav-btn" disabled={!nextRound} onClick={() => changeRound(nextRound)}>
                Next
              </button>
            </div>

            <div className="round-selector">
              {[0, 1, 2, 3, 4].map((tier) => (
                <button
                  key={`league-filter-${tier}`}
                  type="button"
                  className={Number(selectedLeagueTier) === Number(tier) ? 'active' : ''}
                  onClick={() => changeLeagueFilter(tier)}
                >
                  {tier === 0 ? 'All Leagues' : `League ${tier}`}
                </button>
              ))}
            </div>

            <div className="round-chip-grid">
              {visibleRounds.map((round) => {
                const completion = Number(round.total_matches)
                  ? (Number(round.completed_matches) / Number(round.total_matches)) * 100
                  : 0;
                const status = roundStatus(round);

                return (
                  <button
                    key={round.round_no}
                    type="button"
                    className={`round-chip ${status} ${Number(selectedRound) === Number(round.round_no) ? 'active' : ''}`.trim()}
                    onClick={() => changeRound(round.round_no)}
                  >
                    <div className="round-chip-top">
                      <strong>R{round.round_no}</strong>
                      <span>
                        {round.completed_matches}/{round.total_matches}
                      </span>
                    </div>
                    <div className="round-progress">
                      <div className="round-progress-fill" style={{ width: `${completion}%` }} />
                    </div>
                  </button>
                );
              })}
            </div>

            {currentRoundMeta ? (
              <p className="muted round-meta-line">
                Round {currentRoundMeta.round_no}: {currentRoundMeta.completed_matches} of {currentRoundMeta.total_matches} matches completed.
              </p>
            ) : null}
          </>
        )}
      </Panel>

      <Panel title={selectedRound ? `Round ${selectedRound} Fixtures${selectedLeagueTier ? ` - League ${selectedLeagueTier}` : ''}` : 'Round Fixtures'} className="full-width">
        <SimpleTable
          columns={fixtureColumns}
          rows={fixtures}
          emptyMessage="No fixtures in this round."
        />
      </Panel>

      <Panel title="Playoffs (Semifinals)" className="full-width">
        <SimpleTable columns={knockoutColumns} rows={playoffFixtures} emptyMessage="No semifinal fixtures in this season." />
      </Panel>

      <Panel title="Final" className="full-width">
        <SimpleTable columns={knockoutColumns} rows={finalFixtures} emptyMessage="No final fixture in this season yet." />
      </Panel>
    </div>
  );
}
