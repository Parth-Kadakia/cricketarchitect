import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import LineChart from '../components/LineChart';
import Panel from '../components/Panel';
import SimpleTable from '../components/SimpleTable';
import StatCard from '../components/StatCard';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

export default function DashboardPage() {
  const { token, franchise, refreshProfile } = useAuth();
  const { subscribe } = useSocket();

  const [franchiseData, setFranchiseData] = useState(null);
  const [availableCities, setAvailableCities] = useState([]);
  const [seasonSummary, setSeasonSummary] = useState(null);
  const [valuations, setValuations] = useState([]);
  const [transferFeed, setTransferFeed] = useState([]);
  const [citySearch, setCitySearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [simulatingRound, setSimulatingRound] = useState(false);
  const [simulatingSeason, setSimulatingSeason] = useState(false);
  const [error, setError] = useState('');

  async function loadData() {
    setError('');

    try {
      const [franchiseResponse, marketCities, activeSeason, feedResponse] = await Promise.all([
        api.franchise.me(token),
        api.marketplace.cities('', 1200),
        api.league.activeSeason(),
        api.marketplace.transferFeed(40)
      ]);

      setFranchiseData(franchiseResponse.franchise || null);
      setAvailableCities(marketCities.cities || []);
      setTransferFeed(feedResponse.feed || []);

      if (activeSeason.season?.id) {
        const summary = await api.league.seasonSummary(activeSeason.season.id);
        setSeasonSummary(summary);
      }

      if (franchiseResponse.franchise) {
        const valuationResponse = await api.financials.valuations(token);
        setValuations(valuationResponse.valuations || []);
      } else {
        setValuations([]);
      }
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  useEffect(() => {
    let mounted = true;

    async function run() {
      setLoading(true);
      if (mounted) {
        await loadData();
      }
      if (mounted) {
        setLoading(false);
      }
    }

    run();

    return () => {
      mounted = false;
    };
  }, [token]);

  useEffect(() => {
    const un1 = subscribe('*', (message) => {
      if (message.event === 'match:complete' || message.event === 'league:update' || message.event === 'market:update') {
        loadData();
        refreshProfile();
      }
    });

    return () => {
      un1();
    };
  }, [subscribe]);

  async function claimCity(cityId, cityName) {
    try {
      setError('');
      await api.franchise.claim(token, { cityId, franchiseName: `${cityName} Rise` });
      await refreshProfile();
      await loadData();
    } catch (claimError) {
      setError(claimError.message);
    }
  }

  async function simulateNextRound() {
    try {
      setError('');
      setSimulatingRound(true);
      await api.league.simulateNextRound(token);
      await loadData();
    } catch (simulationError) {
      setError(simulationError.message);
    } finally {
      setSimulatingRound(false);
    }
  }

  async function simulateFullSeason() {
    try {
      setError('');
      setSimulatingSeason(true);
      await api.league.simulateSeason(token);
      await loadData();
    } catch (simulationError) {
      setError(simulationError.message);
    } finally {
      setSimulatingSeason(false);
    }
  }

  const valuationSeries = useMemo(() => {
    if (!franchiseData?.id || !valuations.length) {
      return [];
    }

    return valuations.map((entry, index) => ({
      label: `V${index + 1}`,
      value: Number(entry.total_value)
    }));
  }, [franchiseData, valuations]);

  const filteredCities = useMemo(() => {
    const query = citySearch.trim().toLowerCase();
    if (!query) {
      return availableCities;
    }

    return availableCities.filter((city) => city.name.toLowerCase().includes(query) || city.country.toLowerCase().includes(query));
  }, [availableCities, citySearch]);

  if (loading) {
    return <div className="loading-state">Loading career dashboard...</div>;
  }

  if (!franchise) {
    return (
      <div className="page-grid">
        {error ? <p className="error-text">{error}</p> : null}

        <Panel title="Pick Your City Franchise" className="full-width">
          <p className="muted">
            Every career starts at the bottom. Choose one city to control. Your franchise starts at <strong>$100.00</strong> and grows with wins, streaks, player performance, and trophies.
          </p>
          <input
            className="city-search-input"
            type="search"
            value={citySearch}
            onChange={(event) => setCitySearch(event.target.value)}
            placeholder="Search any city or country..."
          />
          <p className="muted">Cities listed: {filteredCities.length}</p>
          <div className="city-claim-grid">
            {filteredCities.map((city) => (
              <button key={city.id} className="city-claim-card" type="button" onClick={() => claimCity(city.id, city.name)}>
                <strong>{city.name}</strong>
                <span>{city.country}</span>
              </button>
            ))}
          </div>
          {filteredCities.length === 0 ? <p className="muted">No matching cities found.</p> : null}
        </Panel>
      </div>
    );
  }

  return (
    <div className="page-grid">
      {error ? <p className="error-text full-width">{error}</p> : null}

      <div className="stat-grid full-width">
        <StatCard label="Franchise Value" value={money(franchiseData?.total_valuation)} hint="Starts at $100.00" />
        <StatCard
          label="Current League"
          value={`League ${franchiseData?.league_tier || franchiseData?.current_league_tier || franchise?.league_tier || franchise?.current_league_tier || 1}`}
          hint={`Pos ${franchiseData?.league_position || franchise?.league_position || '-'}`}
        />
        <StatCard label="Win Streak" value={franchiseData?.win_streak || 0} hint={`Best ${franchiseData?.best_win_streak || 0}`} />
        <StatCard label="Prospect Points" value={franchiseData?.prospect_points || 0} hint="+5 on every win" />
        <StatCard label="Growth Points" value={franchiseData?.growth_points || 0} hint="+5 on every win" />
      </div>

      <Panel
        title="Season Controls"
        actions={
          <div className="row-actions">
            <button className="button" type="button" onClick={simulateNextRound} disabled={simulatingRound || simulatingSeason}>
              {simulatingRound ? 'Simulating Round...' : 'Simulate Next Round'}
            </button>
            <button className="button secondary" type="button" onClick={simulateFullSeason} disabled={simulatingRound || simulatingSeason}>
              {simulatingSeason ? 'Simulating Season...' : 'Simulate Full Season'}
            </button>
          </div>
        }
      >
        {seasonSummary ? (
          <div className="inline-metrics">
            <p>
              Active Season: <strong>{seasonSummary.season.name}</strong>
            </p>
            <p>
              League Pyramid: <strong>{seasonSummary.season.league_count || 4} leagues</strong>
            </p>
            <p>
              Completed Fixtures: <strong>{seasonSummary.fixtures.completed_matches}</strong> / {seasonSummary.fixtures.total_matches}
            </p>
            <p>
              Scheduled: <strong>{seasonSummary.fixtures.scheduled_matches}</strong>
            </p>
          </div>
        ) : (
          <div className="empty-state">No season summary loaded.</div>
        )}
      </Panel>

      <Panel title="Regular Season Round Progress">
        <SimpleTable
          columns={[
            { key: 'round_no', label: 'Round' },
            { key: 'completed_matches', label: 'Completed' },
            { key: 'total_matches', label: 'Total' },
            {
              key: 'completion',
              label: 'Progress',
              render: (_, row) => {
                const total = Number(row.total_matches || 0);
                const done = Number(row.completed_matches || 0);
                return `${total ? Math.round((done / total) * 100) : 0}%`;
              }
            }
          ]}
          rows={(seasonSummary?.rounds || []).slice(0, 14)}
          emptyMessage="No round data yet."
        />
      </Panel>

      <Panel title="Value Snapshot">
        <LineChart data={valuationSeries} valueFormatter={money} />
      </Panel>

      <Panel title="CPU Transfer & Loan Activity">
        <ul className="activity-list">
          {transferFeed.slice(0, 20).map((item) => (
            <li key={item.id}>
              <span>{new Date(item.created_at).toLocaleString()}</span>
              <p>{item.message}</p>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
