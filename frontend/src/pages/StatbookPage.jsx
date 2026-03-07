import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

function fmt(value) {
  if (value == null) {
    return '-';
  }
  return Number(value).toLocaleString();
}

function fmtDec(value, digits = 2) {
  if (value == null) {
    return '-';
  }
  return Number(value).toFixed(digits);
}

function oversFromBalls(balls) {
  const safeBalls = Number(balls || 0);
  return `${Math.floor(safeBalls / 6)}.${safeBalls % 6}`;
}

function nameOf(row) {
  return `${row?.first_name || ''} ${row?.last_name || ''}`.trim() || '-';
}

const TABS = [
  { key: 'players', label: 'Player Records' },
  { key: 'teams', label: 'Team Records' },
  { key: 'archive', label: 'Match Archive' },
  { key: 'h2h', label: 'Head-to-Head' }
];

export default function StatbookPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('players');
  const [seasonId, setSeasonId] = useState('');

  const [overview, setOverview] = useState(null);
  const [playerRecords, setPlayerRecords] = useState(null);
  const [teamRecords, setTeamRecords] = useState(null);
  const [archive, setArchive] = useState(null);

  const [teamAId, setTeamAId] = useState('');
  const [teamBId, setTeamBId] = useState('');
  const [headToHead, setHeadToHead] = useState(null);
  const [headToHeadLoading, setHeadToHeadLoading] = useState(false);

  async function loadStatbook(activeSeasonId) {
    setLoading(true);
    setError('');
    try {
      const numericSeasonId = activeSeasonId ? Number(activeSeasonId) : null;
      const [overviewData, playerData, teamData, archiveData] = await Promise.all([
        api.statbook.overview(numericSeasonId),
        api.statbook.playerRecords(numericSeasonId, 25),
        api.statbook.teamRecords(numericSeasonId, 25),
        api.statbook.matchArchive({ seasonId: numericSeasonId, limit: 40, offset: 0 })
      ]);

      setOverview(overviewData);
      setPlayerRecords(playerData);
      setTeamRecords(teamData);
      setArchive(archiveData);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load statbook.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatbook(seasonId);
  }, [seasonId]);

  const teams = overview?.teams || [];
  const seasons = overview?.seasons || [];
  const totals = overview?.totals || {};
  const records = overview?.records || {};
  const milestones = overview?.milestones || {};

  useEffect(() => {
    if (!teams.length) {
      return;
    }
    if (!teamAId) {
      setTeamAId(String(teams[0]?.franchise_id || ''));
    }
    if (!teamBId && teams.length > 1) {
      setTeamBId(String(teams[1]?.franchise_id || ''));
    }
  }, [teams, teamAId, teamBId]);

  useEffect(() => {
    async function loadHeadToHead() {
      if (!teamAId || !teamBId || teamAId === teamBId) {
        setHeadToHead(null);
        return;
      }
      setHeadToHeadLoading(true);
      try {
        const payload = await api.statbook.headToHead(Number(teamAId), Number(teamBId), seasonId ? Number(seasonId) : null, 20);
        setHeadToHead(payload);
      } catch (h2hError) {
        setHeadToHead(null);
        setError(h2hError.message || 'Failed to load head-to-head stats.');
      } finally {
        setHeadToHeadLoading(false);
      }
    }
    loadHeadToHead();
  }, [teamAId, teamBId, seasonId]);

  const mostRuns = playerRecords?.most_runs || [];
  const mostWickets = playerRecords?.most_wickets || [];
  const bestAverage = playerRecords?.best_batting_average || [];
  const bestEconomy = playerRecords?.best_economy || [];
  const highestTotals = teamRecords?.highest_totals || [];
  const biggestWinsByRuns = teamRecords?.biggest_wins_by_runs || [];
  const topTeams = teamRecords?.top_teams || [];

  const selectedTeams = useMemo(() => {
    const map = new Map(teams.map((team) => [String(team.franchise_id), team]));
    return {
      a: map.get(String(teamAId)) || null,
      b: map.get(String(teamBId)) || null
    };
  }, [teams, teamAId, teamBId]);

  if (loading) {
    return (
      <div className="sq-loading">
        <div className="sq-spinner" />
        <span>Loading statbook...</span>
      </div>
    );
  }

  return (
    <div className="sb-page">
      {error && (
        <div className="sq-error">
          {error}
          <button type="button" onClick={() => setError('')}>
            ×
          </button>
        </div>
      )}

      <div className="sb-header">
        <div>
          <h2 className="sb-title">Deep Records & Statbook</h2>
          <p className="sb-subtitle">Historical records, milestones, and match archive across seasons.</p>
        </div>
        <div className="sb-season">
          <label htmlFor="sb-season-select">Season</label>
          <select id="sb-season-select" value={seasonId} onChange={(event) => setSeasonId(event.target.value)}>
            <option value="">All Time</option>
            {seasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name} {season.status === 'ACTIVE' ? '(current)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="sb-metrics-grid">
        <div className="stat-card">
          <span className="stat-label">Matches</span>
          <strong className="stat-value">{fmt(totals.completed_matches)}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Teams</span>
          <strong className="stat-value">{fmt(totals.teams_involved)}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Players</span>
          <strong className="stat-value">{fmt(totals.players_involved)}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Runs</span>
          <strong className="stat-value">{fmt(totals.total_runs)}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Wickets</span>
          <strong className="stat-value">{fmt(totals.total_wickets)}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Boundaries</span>
          <strong className="stat-value">
            {fmt(totals.fours)}x4 / {fmt(totals.sixes)}x6
          </strong>
        </div>
      </div>

      <div className="sb-quick-grid">
        <div className="panel sb-quick-card">
          <h3>Highest Team Total</h3>
          {records.highest_team_total ? (
            <div className="sb-quick-card-body">
              <p>
                <strong>{records.highest_team_total.franchise_name}</strong> ({records.highest_team_total.country})
              </p>
              <p>
                {records.highest_team_total.runs}/{records.highest_team_total.wickets} ({oversFromBalls(records.highest_team_total.balls)})
              </p>
            </div>
          ) : (
            <div className="sb-quick-card-body">No data yet.</div>
          )}
        </div>
        <div className="panel sb-quick-card">
          <h3>Highest Individual Score</h3>
          {records.highest_individual_score ? (
            <div className="sb-quick-card-body">
              <p>
                <strong>{nameOf(records.highest_individual_score)}</strong> · {records.highest_individual_score.franchise_name}
              </p>
              <p>
                {records.highest_individual_score.batting_runs} ({records.highest_individual_score.batting_balls}b)
              </p>
            </div>
          ) : (
            <div className="sb-quick-card-body">No data yet.</div>
          )}
        </div>
        <div className="panel sb-quick-card">
          <h3>Best Bowling Figures</h3>
          {records.best_bowling_figures ? (
            <div className="sb-quick-card-body">
              <p>
                <strong>{nameOf(records.best_bowling_figures)}</strong> · {records.best_bowling_figures.franchise_name}
              </p>
              <p>
                {records.best_bowling_figures.bowling_wickets}/{records.best_bowling_figures.bowling_runs} ({oversFromBalls(records.best_bowling_figures.bowling_balls)})
              </p>
            </div>
          ) : (
            <div className="sb-quick-card-body">No data yet.</div>
          )}
        </div>
        <div className="panel sb-quick-card">
          <h3>Milestones</h3>
          <div className="sb-quick-card-body">
            <p>50s: {fmt(milestones.fifties)}</p>
            <p>100s: {fmt(milestones.hundreds)}</p>
            <p>5W: {fmt(milestones.five_wicket_hauls)}</p>
          </div>
        </div>
      </div>

      <div className="stats-tabs sb-tabs">
        {TABS.map((item) => (
          <button key={item.key} type="button" className={`stats-tab ${tab === item.key ? 'active' : ''}`} onClick={() => setTab(item.key)}>
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'players' && (
        <div className="sb-section-grid">
          <div className="panel">
            <h3>Most Runs</h3>
            <div className="table-wrap">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Player</th>
                    <th>Team</th>
                    <th>Mat</th>
                    <th>Runs</th>
                    <th>Avg</th>
                    <th>SR</th>
                    <th>50s</th>
                    <th>100s</th>
                  </tr>
                </thead>
                <tbody>
                  {mostRuns.slice(0, 15).map((row, index) => (
                    <tr key={`runs-${row.player_id}`}>
                      <td>{index + 1}</td>
                      <td>{nameOf(row)}</td>
                      <td>{row.franchise_name}</td>
                      <td>{fmt(row.matches)}</td>
                      <td>{fmt(row.runs)}</td>
                      <td>{fmtDec(row.batting_average)}</td>
                      <td>{fmtDec(row.strike_rate)}</td>
                      <td>{fmt(row.fifties)}</td>
                      <td>{fmt(row.hundreds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <h3>Most Wickets</h3>
            <div className="table-wrap">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Player</th>
                    <th>Team</th>
                    <th>Mat</th>
                    <th>Wkts</th>
                    <th>Overs</th>
                    <th>Econ</th>
                    <th>Best</th>
                  </tr>
                </thead>
                <tbody>
                  {mostWickets.slice(0, 15).map((row, index) => (
                    <tr key={`wkts-${row.player_id}`}>
                      <td>{index + 1}</td>
                      <td>{nameOf(row)}</td>
                      <td>{row.franchise_name}</td>
                      <td>{fmt(row.matches)}</td>
                      <td>{fmt(row.wickets)}</td>
                      <td>{oversFromBalls(row.bowling_balls)}</td>
                      <td>{fmtDec(row.economy)}</td>
                      <td>{fmt(row.best_wickets)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <h3>Best Batting Average</h3>
            <div className="table-wrap">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Player</th>
                    <th>Team</th>
                    <th>Runs</th>
                    <th>Outs</th>
                    <th>Avg</th>
                  </tr>
                </thead>
                <tbody>
                  {bestAverage.slice(0, 10).map((row, index) => (
                    <tr key={`avg-${row.player_id}`}>
                      <td>{index + 1}</td>
                      <td>{nameOf(row)}</td>
                      <td>{row.franchise_name}</td>
                      <td>{fmt(row.runs)}</td>
                      <td>{fmt(row.outs)}</td>
                      <td>{fmtDec(row.batting_average)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <h3>Best Economy (20+ overs)</h3>
            <div className="table-wrap">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Player</th>
                    <th>Team</th>
                    <th>Overs</th>
                    <th>Wkts</th>
                    <th>Econ</th>
                  </tr>
                </thead>
                <tbody>
                  {bestEconomy.slice(0, 10).map((row, index) => (
                    <tr key={`econ-${row.player_id}`}>
                      <td>{index + 1}</td>
                      <td>{nameOf(row)}</td>
                      <td>{row.franchise_name}</td>
                      <td>{oversFromBalls(row.bowling_balls)}</td>
                      <td>{fmt(row.wickets)}</td>
                      <td>{fmtDec(row.economy)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'teams' && (
        <div className="sb-section-grid">
          <div className="panel">
            <h3>Top Team Records</h3>
            <div className="table-wrap">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Team</th>
                    <th>Country</th>
                    <th>P</th>
                    <th>W</th>
                    <th>L</th>
                    <th>Pts</th>
                    <th>NRR</th>
                  </tr>
                </thead>
                <tbody>
                  {topTeams.slice(0, 15).map((row, index) => (
                    <tr key={`team-${row.franchise_id}`}>
                      <td>{index + 1}</td>
                      <td>{row.franchise_name}</td>
                      <td>{row.country}</td>
                      <td>{fmt(row.played)}</td>
                      <td>{fmt(row.won)}</td>
                      <td>{fmt(row.lost)}</td>
                      <td>{fmt(row.points)}</td>
                      <td>{fmtDec(row.avg_nrr, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <h3>Highest Team Totals</h3>
            <div className="table-wrap">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Team</th>
                    <th>Country</th>
                    <th>Score</th>
                    <th>Match</th>
                  </tr>
                </thead>
                <tbody>
                  {highestTotals.slice(0, 15).map((row, index) => (
                    <tr key={`high-total-${row.match_id}-${row.franchise_id}-${index}`}>
                      <td>{index + 1}</td>
                      <td>{row.franchise_name}</td>
                      <td>{row.country}</td>
                      <td>
                        {row.runs}/{row.wickets} ({oversFromBalls(row.balls)})
                      </td>
                      <td>#{row.match_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <h3>Biggest Wins By Runs</h3>
            <div className="table-wrap">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Winner</th>
                    <th>Fixture</th>
                    <th>Margin</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {biggestWinsByRuns.slice(0, 15).map((row, index) => (
                    <tr key={`margin-runs-${row.match_id}`}>
                      <td>{index + 1}</td>
                      <td>{row.winner_name || '-'}</td>
                      <td>
                        {row.home_team} vs {row.away_team}
                      </td>
                      <td>{fmt(row.margin_runs)} runs</td>
                      <td>{row.result_summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'archive' && (
        <div className="panel">
          <h3>Match Archive ({fmt(archive?.total || 0)})</h3>
          <div className="table-wrap">
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Season</th>
                  <th>Round</th>
                  <th>League</th>
                  <th>Home</th>
                  <th>Away</th>
                  <th>Result</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {(archive?.matches || []).map((row) => (
                  <tr key={`archive-${row.id}`}>
                    <td>{row.season_name}</td>
                    <td>{row.round_no}</td>
                    <td>{row.league_tier ? `League ${row.league_tier}` : row.stage}</td>
                    <td>
                      {row.home_team} ({row.home_country})
                      <div className="sb-subline">
                        {row.home_score}/{row.home_wickets} ({oversFromBalls(row.home_balls)})
                      </div>
                    </td>
                    <td>
                      {row.away_team} ({row.away_country})
                      <div className="sb-subline">
                        {row.away_score}/{row.away_wickets} ({oversFromBalls(row.away_balls)})
                      </div>
                    </td>
                    <td>{row.result_summary || '-'}</td>
                    <td>
                      <button type="button" className="sq-btn sq-btn--ghost" onClick={() => navigate(`/matches/${row.id}`)}>
                        Open Match
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'h2h' && (
        <div className="sb-section-grid">
          <div className="panel">
            <h3>Head-to-Head Selector</h3>
            <div className="sb-h2h-controls">
              <div>
                <label htmlFor="h2h-team-a">Team A</label>
                <select id="h2h-team-a" value={teamAId} onChange={(event) => setTeamAId(event.target.value)}>
                  <option value="">Select Team A</option>
                  {teams.map((team) => (
                    <option key={`team-a-${team.franchise_id}`} value={team.franchise_id}>
                      {team.franchise_name} ({team.country})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="h2h-team-b">Team B</label>
                <select id="h2h-team-b" value={teamBId} onChange={(event) => setTeamBId(event.target.value)}>
                  <option value="">Select Team B</option>
                  {teams.map((team) => (
                    <option key={`team-b-${team.franchise_id}`} value={team.franchise_id}>
                      {team.franchise_name} ({team.country})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="sb-h2h-summary">
              {headToHeadLoading && <p>Loading head-to-head...</p>}
              {!headToHeadLoading && headToHead?.summary && (
                <>
                  <p>
                    <strong>{selectedTeams.a?.franchise_name || 'Team A'}</strong> wins: {fmt(headToHead.summary.team_a_wins)}
                  </p>
                  <p>
                    <strong>{selectedTeams.b?.franchise_name || 'Team B'}</strong> wins: {fmt(headToHead.summary.team_b_wins)}
                  </p>
                  <p>Total matches: {fmt(headToHead.summary.matches)}</p>
                  <p>Ties/NR: {fmt(headToHead.summary.ties_or_no_result)}</p>
                </>
              )}
            </div>
          </div>

          <div className="panel">
            <h3>Recent Head-to-Head Matches</h3>
            <div className="table-wrap">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th>Match</th>
                    <th>Round</th>
                    <th>Result</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(headToHead?.matches || []).map((row) => (
                    <tr key={`h2h-${row.id}`}>
                      <td>
                        {row.home_team} vs {row.away_team}
                      </td>
                      <td>{row.round_no}</td>
                      <td>{row.result_summary || '-'}</td>
                      <td>
                        <button type="button" className="sq-btn sq-btn--ghost" onClick={() => navigate(`/matches/${row.id}`)}>
                          Open Match
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
