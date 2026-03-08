import { useEffect, useState } from 'react';
import { api } from '../api/client';
import Panel from '../components/Panel';
import SimpleTable from '../components/SimpleTable';
import StatCard from '../components/StatCard';
import { useAuth } from '../context/AuthContext';
import { setPageTitle } from '../utils/format';

export default function TrophyRoomPage() {
  const { token } = useAuth();

  const [franchise, setFranchise] = useState(null);
  const [trophies, setTrophies] = useState([]);
  const [retired, setRetired] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { setPageTitle('Trophy Room'); }, []);

  useEffect(() => {
    async function load() {
      setError('');

      try {
        const franchiseResponse = await api.franchise.me(token);
        setFranchise(franchiseResponse.franchise || null);

        if (franchiseResponse.franchise?.id) {
          const trophyResponse = await api.franchise.trophies(token, franchiseResponse.franchise.id);
          setTrophies(trophyResponse.trophies || []);
        }

        const squad = await api.squad.get(token);
        setRetired((squad.players || []).filter((player) => player.squad_status === 'RETIRED'));
      } catch (loadError) {
        setError(loadError.message);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [token]);

  if (loading) {
    return <div className="loading-state">Loading trophy room...</div>;
  }

  return (
    <div className="page-grid">
      {error ? <p className="error-text full-width">{error}</p> : null}

      <div className="stat-grid full-width">
        <StatCard label="Titles" value={franchise?.championships || 0} hint="League championships" />
        <StatCard label="Wins" value={franchise?.wins || 0} hint="All-time wins" />
        <StatCard label="Losses" value={franchise?.losses || 0} hint="All-time losses" />
        <StatCard label="Best Streak" value={franchise?.best_win_streak || 0} hint="Longest run" />
      </div>

      <Panel title="Trophy Cabinet" className="full-width">
        <SimpleTable
          columns={[
            { key: 'title', label: 'Title' },
            { key: 'season_name', label: 'Season' },
            { key: 'won_at', label: 'Won At', render: (value) => new Date(value).toLocaleDateString() }
          ]}
          rows={trophies}
          emptyMessage="No trophies yet. Build from the bottom and take one." 
        />
      </Panel>

      <Panel title="Retired Club Players" className="full-width">
        <SimpleTable
          columns={[
            { key: 'name', label: 'Player', render: (_, row) => `${row.first_name} ${row.last_name}` },
            { key: 'country_origin', label: 'Country' },
            { key: 'role', label: 'Role' },
            { key: 'career_matches', label: 'Matches' },
            { key: 'career_runs', label: 'Runs' },
            { key: 'career_wickets', label: 'Wkts' },
            { key: 'retired_at', label: 'Retired', render: (value) => (value ? new Date(value).toLocaleDateString() : '-') }
          ]}
          rows={retired}
          emptyMessage="No retired players yet."
        />
      </Panel>
    </div>
  );
}
