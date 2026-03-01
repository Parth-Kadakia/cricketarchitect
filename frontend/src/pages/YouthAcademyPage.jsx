import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import BarChart from '../components/BarChart';
import LineChart from '../components/LineChart';
import Panel from '../components/Panel';
import SimpleTable from '../components/SimpleTable';
import { useAuth } from '../context/AuthContext';

function clubControlLabel(row, userFranchiseId) {
  if (Number(row.id) === Number(userFranchiseId)) {
    return 'You';
  }

  if (row.control_type === 'CPU') {
    return 'CPU';
  }

  if (row.status === 'FOR_SALE') {
    return 'For Sale';
  }

  if (row.status === 'AVAILABLE') {
    return 'Available';
  }

  return row.owner_username || 'Managed';
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function academyUpgradeCost(level) {
  return 10 + Number(level || 1) * 5;
}

function youthRatingUpgradeCost(rating) {
  return 20 + Math.floor(Number(rating || 0) / 10) * 5;
}

export default function YouthAcademyPage() {
  const { token, franchise } = useAuth();

  const [academyData, setAcademyData] = useState(null);
  const [prospects, setProspects] = useState([]);
  const [globalClubs, setGlobalClubs] = useState([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState(null);
  const [growthHistory, setGrowthHistory] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setError('');

    try {
      const [academyResponse, prospectsResponse, clubsResponse] = await Promise.all([
        api.youth.academy(token),
        api.youth.prospects(token),
        api.marketplace.franchises()
      ]);

      setAcademyData(academyResponse);
      setProspects(prospectsResponse.prospects || []);
      setGlobalClubs(clubsResponse.franchises || []);

      if (!selectedPlayerId && prospectsResponse.prospects?.length) {
        setSelectedPlayerId(prospectsResponse.prospects[0].id);
      }
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [token]);

  useEffect(() => {
    async function loadHistory() {
      if (!selectedPlayerId) {
        setGrowthHistory([]);
        return;
      }

      try {
        const history = await api.youth.growthHistory(token, selectedPlayerId);
        setGrowthHistory(history.history || []);
      } catch (historyError) {
        setGrowthHistory([]);
      }
    }

    loadHistory();
  }, [selectedPlayerId, token]);

  async function generateProspects() {
    try {
      await api.youth.generate(token);
      await load();
    } catch (actionError) {
      setError(actionError.message);
    }
  }

  async function runGrowth() {
    try {
      await api.youth.grow(token);
      await load();
    } catch (actionError) {
      setError(actionError.message);
    }
  }

  async function upgrade(mode) {
    try {
      await api.youth.upgrade(token, mode);
      await load();
    } catch (actionError) {
      setError(actionError.message);
    }
  }

  const regionChart = useMemo(() => {
    if (!academyData?.regions?.length) {
      return [];
    }

    return academyData.regions.map((region) => ({
      label: region.name.split(' ').slice(-1)[0],
      value: Number(region.quality_rating)
    }));
  }, [academyData]);

  const growthChart = useMemo(
    () =>
      growthHistory.map((item, index) => ({
        label: `${index + 1}`,
        value: Number(item.batting_delta) + Number(item.bowling_delta) + Number(item.fielding_delta)
      })),
    [growthHistory]
  );

  if (loading) {
    return <div className="loading-state">Loading academy systems...</div>;
  }

  const franchiseData = academyData?.franchise;
  const academyCost = academyUpgradeCost(franchiseData?.academy_level);
  const youthCost = youthRatingUpgradeCost(franchiseData?.youth_development_rating);

  return (
    <div className="page-grid">
      {error ? <p className="error-text full-width">{error}</p> : null}

      <Panel title={franchiseData ? `${franchiseData.academy_name}` : 'Academy'} className="full-width">
        <div className="inline-metrics">
          <p>
            Academy Level: <strong>{franchiseData?.academy_level}</strong>
          </p>
          <p>
            Youth Rating: <strong>{Number(franchiseData?.youth_development_rating || 0).toFixed(1)}</strong>
          </p>
          <p>
            Prospect Points: <strong>{franchiseData?.prospect_points}</strong>
          </p>
          <p>
            Growth Points: <strong>{franchiseData?.growth_points}</strong>
          </p>
        </div>
      </Panel>

      <Panel
        title="Point-Based Academy Upgrades"
        actions={
          <div className="row-actions">
            <button className="button" type="button" onClick={() => upgrade('ACADEMY_LEVEL')}>
              Upgrade Academy ({academyCost} Prospect)
            </button>
            <button className="button secondary" type="button" onClick={() => upgrade('YOUTH_RATING')}>
              Upgrade Youth Rating ({youthCost} Growth)
            </button>
          </div>
        }
      >
        <p className="muted">Academy improvement is strictly point-based in this mode. Money does not upgrade youth systems.</p>
      </Panel>

      <Panel
        title="Prospect Pipeline Actions"
        actions={
          <div className="row-actions">
            <button className="button" type="button" onClick={generateProspects}>
              Generate Prospects (50 Prospect)
            </button>
            <button className="button secondary" type="button" onClick={runGrowth}>
              Apply Growth Cycle (5 Growth)
            </button>
          </div>
        }
      >
        <p className="muted">Every win grants +5 prospect points and +5 growth points.</p>
      </Panel>

      <Panel title="Regional Quality Chart">
        <BarChart data={regionChart} color="var(--moss)" />
      </Panel>

      <Panel title="Selected Player Growth Trend">
        <LineChart data={growthChart} valueFormatter={(value) => `${Math.round(value)} growth`} />
      </Panel>

      <Panel title="Global Academy + Valuation Board" className="full-width">
        <SimpleTable
          columns={[
            { key: 'franchise_name', label: 'Franchise' },
            { key: 'city_name', label: 'City' },
            { key: 'country', label: 'Country' },
            { key: 'control', label: 'Control', render: (_, row) => clubControlLabel(row, franchise?.id) },
            { key: 'academy_level', label: 'Academy' },
            { key: 'youth_development_rating', label: 'Youth' },
            { key: 'prospect_points', label: 'Prospect' },
            { key: 'growth_points', label: 'Growth' },
            { key: 'total_valuation', label: 'Value', render: (value) => money(value) }
          ]}
          rows={globalClubs}
          emptyMessage="No club academy/valuation data available."
        />
      </Panel>

      <Panel title="Youth Prospects" className="full-width">
        <SimpleTable
          columns={[
            { key: 'name', label: 'Player', render: (_, row) => `${row.first_name} ${row.last_name}` },
            { key: 'region_name', label: 'Region' },
            { key: 'country_origin', label: 'Country' },
            { key: 'role', label: 'Role' },
            { key: 'potential', label: 'Potential' },
            { key: 'age', label: 'Age' },
            {
              key: 'detail',
              label: 'Growth',
              render: (_, row) => (
                <button type="button" onClick={() => setSelectedPlayerId(row.id)}>
                  View
                </button>
              )
            }
          ]}
          rows={prospects}
        />
      </Panel>
    </div>
  );
}
