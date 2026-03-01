import { useEffect, useMemo, useState } from 'react';
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

export default function LeagueTablePage() {
  const { subscribe } = useSocket();

  const [seasons, setSeasons] = useState([]);
  const [seasonId, setSeasonId] = useState(null);
  const [table, setTable] = useState([]);
  const [summary, setSummary] = useState(null);
  const [seasonStats, setSeasonStats] = useState({ batting: [], bowling: [] });
  const [playoffFixtures, setPlayoffFixtures] = useState([]);
  const [finalFixtures, setFinalFixtures] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const tableByLeague = useMemo(
    () =>
      [1, 2, 3, 4].map((tier) => ({
        tier,
        rows: (table || []).filter((row) => Number(row.league_tier) === tier)
      })),
    [table]
  );

  async function load(initial = false) {
    setError('');

    try {
      const seasonResponse = await api.league.seasons();
      const seasonRows = seasonResponse.seasons || [];
      setSeasons(seasonRows);

      const currentSeasonId = seasonId || seasonRows[0]?.id;
      setSeasonId(currentSeasonId);

      if (currentSeasonId) {
        const [tableResponse, summaryResponse, fixturesResponse, statsResponse] = await Promise.all([
          api.league.table(currentSeasonId),
          api.league.seasonSummary(currentSeasonId),
          api.league.fixtures(currentSeasonId),
          api.league.seasonStats(currentSeasonId)
        ]);
        setTable(tableResponse.table || []);
        setSummary(summaryResponse || null);
        setSeasonStats(statsResponse || { batting: [], bowling: [] });
        const fixtures = fixturesResponse.fixtures || [];
        setPlayoffFixtures(fixtures.filter((fixture) => fixture.stage === 'PLAYOFF'));
        setFinalFixtures(fixtures.filter((fixture) => fixture.stage === 'FINAL'));
      }
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      if (initial) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    load(true);
  }, []);

  useEffect(() => {
    const off = subscribe('league:update', () => {
      load(false);
    });

    return () => {
      off();
    };
  }, [subscribe, seasonId]);

  async function handleSeasonChange(nextSeasonId) {
    setSeasonId(nextSeasonId);

    try {
      const [tableResponse, summaryResponse, fixturesResponse, statsResponse] = await Promise.all([
        api.league.table(nextSeasonId),
        api.league.seasonSummary(nextSeasonId),
        api.league.fixtures(nextSeasonId),
        api.league.seasonStats(nextSeasonId)
      ]);
      setTable(tableResponse.table || []);
      setSummary(summaryResponse || null);
      setSeasonStats(statsResponse || { batting: [], bowling: [] });
      const fixtures = fixturesResponse.fixtures || [];
      setPlayoffFixtures(fixtures.filter((fixture) => fixture.stage === 'PLAYOFF'));
      setFinalFixtures(fixtures.filter((fixture) => fixture.stage === 'FINAL'));
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  if (loading) {
    return <div className="loading-state">Loading league table...</div>;
  }

  return (
    <div className="page-grid">
      {error ? <p className="error-text full-width">{error}</p> : null}

      <Panel title="Seasons" className="full-width">
        <div className="round-selector">
          {seasons.map((season) => (
            <button
              key={season.id}
              type="button"
              className={Number(season.id) === Number(seasonId) ? 'active' : ''}
              onClick={() => handleSeasonChange(season.id)}
            >
              {season.name} ({season.status})
            </button>
          ))}
        </div>
      </Panel>

      <Panel
        title={summary?.season?.name ? `${summary.season.name} Standings (${summary?.season?.team_count || table.length} teams)` : 'Standings'}
        className="full-width"
      >
        <p className="muted">League winners qualify for semifinals. Bottom-two and top-two movement applies between Leagues 1-4 every season.</p>
      </Panel>

      {tableByLeague.map((leagueGroup) => (
        <Panel key={`league-tier-${leagueGroup.tier}`} title={`League ${leagueGroup.tier} Standings`} className="full-width">
          <SimpleTable
            columns={[
              { key: 'league_position', label: '#' },
              { key: 'franchise_name', label: 'Franchise' },
              { key: 'city', label: 'City' },
              { key: 'country', label: 'Country' },
              { key: 'played', label: 'P' },
              { key: 'won', label: 'W' },
              { key: 'lost', label: 'L' },
              { key: 'tied', label: 'T' },
              { key: 'points', label: 'Pts' },
              { key: 'net_run_rate', label: 'NRR', render: (value) => Number(value).toFixed(3) },
              { key: 'movement', label: 'Move' },
              { key: 'promotions', label: 'Promoted' },
              { key: 'relegations', label: 'Relegated' }
            ]}
            rows={leagueGroup.rows}
            emptyMessage={`No teams in League ${leagueGroup.tier}.`}
          />
        </Panel>
      ))}

      <Panel title="Season Progress">
        {summary ? (
          <div className="inline-metrics">
            <p>
              Fixtures Completed: <strong>{summary.fixtures.completed_matches}</strong> / {summary.fixtures.total_matches}
            </p>
            <p>
              Live: <strong>{summary.fixtures.live_matches}</strong>
            </p>
            <p>
              Scheduled: <strong>{summary.fixtures.scheduled_matches}</strong>
            </p>
          </div>
        ) : (
          <div className="empty-state">No season summary available.</div>
        )}
      </Panel>

      <Panel title="Top Batters (Season)" className="full-width">
        <SimpleTable
          columns={[
            { key: 'player', label: 'Player', render: (_, row) => `${row.first_name} ${row.last_name}` },
            { key: 'franchise_name', label: 'Franchise' },
            { key: 'innings', label: 'Inns' },
            { key: 'runs', label: 'Runs' },
            { key: 'balls', label: 'Balls' },
            { key: 'strike_rate', label: 'SR', render: (value) => Number(value).toFixed(2) },
            { key: 'fours', label: '4s' },
            { key: 'sixes', label: '6s' }
          ]}
          rows={(seasonStats?.batting || []).slice(0, 12)}
          emptyMessage="No batting stats yet."
        />
      </Panel>

      <Panel title="Top Bowlers (Season)" className="full-width">
        <SimpleTable
          columns={[
            { key: 'player', label: 'Player', render: (_, row) => `${row.first_name} ${row.last_name}` },
            { key: 'franchise_name', label: 'Franchise' },
            { key: 'overs', label: 'Overs', render: (_, row) => oversFromBalls(row.balls) },
            { key: 'wickets', label: 'Wkts' },
            { key: 'runs_conceded', label: 'Runs' },
            { key: 'maidens', label: 'Maidens' },
            { key: 'economy', label: 'Econ', render: (value) => Number(value).toFixed(2) }
          ]}
          rows={(seasonStats?.bowling || []).slice(0, 12)}
          emptyMessage="No bowling stats yet."
        />
      </Panel>

      <Panel title="Playoffs (Semifinals)" className="full-width">
        <SimpleTable
          columns={[
            { key: 'matchday_label', label: 'Match' },
            { key: 'home_franchise_name', label: 'Home', render: (_, row) => `${row.home_franchise_name} (${row.home_country || '-'})` },
            { key: 'away_franchise_name', label: 'Away', render: (_, row) => `${row.away_franchise_name} (${row.away_country || '-'})` },
            { key: 'status', label: 'Status' },
            { key: 'home_score', label: 'Home Score', render: (_, row) => scoreLabel(row.home_score, row.home_wickets, row.home_balls) },
            { key: 'away_score', label: 'Away Score', render: (_, row) => scoreLabel(row.away_score, row.away_wickets, row.away_balls) }
          ]}
          rows={playoffFixtures}
          emptyMessage="No playoff fixtures for this season."
        />
      </Panel>

      <Panel title="Final" className="full-width">
        <SimpleTable
          columns={[
            { key: 'matchday_label', label: 'Match' },
            { key: 'home_franchise_name', label: 'Home', render: (_, row) => `${row.home_franchise_name} (${row.home_country || '-'})` },
            { key: 'away_franchise_name', label: 'Away', render: (_, row) => `${row.away_franchise_name} (${row.away_country || '-'})` },
            { key: 'status', label: 'Status' },
            { key: 'home_score', label: 'Home Score', render: (_, row) => scoreLabel(row.home_score, row.home_wickets, row.home_balls) },
            { key: 'away_score', label: 'Away Score', render: (_, row) => scoreLabel(row.away_score, row.away_wickets, row.away_balls) }
          ]}
          rows={finalFixtures}
          emptyMessage="No final fixture for this season."
        />
      </Panel>
    </div>
  );
}
