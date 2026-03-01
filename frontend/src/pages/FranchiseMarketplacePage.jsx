import { useEffect, useState } from 'react';
import { api } from '../api/client';
import CityMap from '../components/CityMap';
import Panel from '../components/Panel';
import SimpleTable from '../components/SimpleTable';
import { useAuth } from '../context/AuthContext';

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function ownershipLabel(row, userFranchiseId) {
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

export default function FranchiseMarketplacePage() {
  const { token, franchise, refreshProfile } = useAuth();

  const [data, setData] = useState({ availableCities: [], franchisesForSale: [], allFranchises: [], recentSales: [] });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setError('');

    try {
      const response = await api.marketplace.overview();
      setData(response);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function claimCity(cityId, cityName) {
    try {
      await api.franchise.claim(token, { cityId, franchiseName: `${cityName} Rise` });
      await refreshProfile();
      await load();
    } catch (actionError) {
      setError(actionError.message);
    }
  }

  async function purchase(franchiseId) {
    try {
      await api.franchise.purchase(token, franchiseId);
      await refreshProfile();
      await load();
    } catch (actionError) {
      setError(actionError.message);
    }
  }

  if (loading) {
    return <div className="loading-state">Loading marketplace...</div>;
  }

  return (
    <div className="page-grid">
      {error ? <p className="error-text full-width">{error}</p> : null}

      <Panel title="Available Cities (Unclaimed)">
        <SimpleTable
          columns={[
            { key: 'name', label: 'City' },
            { key: 'country', label: 'Country' },
            {
              key: 'claim',
              label: 'Action',
              render: (_, row) => (
                <button type="button" onClick={() => claimCity(row.id, row.name)}>
                  Claim
                </button>
              )
            }
          ]}
          rows={data.availableCities}
        />
      </Panel>

      <Panel title="Franchises For Sale">
        <SimpleTable
          columns={[
            { key: 'franchise_name', label: 'Franchise' },
            { key: 'city_name', label: 'City' },
            { key: 'country', label: 'Country' },
            { key: 'total_valuation', label: 'Valuation', render: (value) => money(value) },
            {
              key: 'buy',
              label: 'Action',
              render: (_, row) => (
                <button type="button" onClick={() => purchase(row.id)} disabled={!!franchise}>
                  Purchase
                </button>
              )
            }
          ]}
          rows={(data.franchisesForSale || []).filter((item) => item.status === 'FOR_SALE')}
          emptyMessage="No franchises currently listed for sale."
        />
      </Panel>

      <Panel title="Global Club Valuation Board" className="full-width">
        <SimpleTable
          columns={[
            { key: 'franchise_name', label: 'Franchise' },
            { key: 'city_name', label: 'City' },
            { key: 'country', label: 'Country' },
            { key: 'current_league_tier', label: 'League', render: (value) => `League ${value || 1}` },
            { key: 'control', label: 'Control', render: (_, row) => ownershipLabel(row, franchise?.id) },
            { key: 'academy_level', label: 'Academy' },
            { key: 'youth_development_rating', label: 'Youth' },
            { key: 'prospect_points', label: 'Prospect' },
            { key: 'growth_points', label: 'Growth' },
            { key: 'promotions', label: 'Promoted' },
            { key: 'relegations', label: 'Relegated' },
            { key: 'total_valuation', label: 'Valuation', render: (value) => money(value) }
          ]}
          rows={data.allFranchises || []}
          emptyMessage="No franchise valuation data available."
        />
      </Panel>

      <Panel title="Recent Franchise Sales" className="full-width">
        <SimpleTable
          columns={[
            { key: 'franchise_name', label: 'Franchise' },
            { key: 'sale_value', label: 'Value', render: (value) => money(value) },
            { key: 'sold_at', label: 'Sold At', render: (value) => new Date(value).toLocaleString() }
          ]}
          rows={data.recentSales}
          emptyMessage="No sales yet."
        />
      </Panel>

      <Panel title="City Distribution" className="full-width">
        <CityMap cities={data.availableCities} />
      </Panel>
    </div>
  );
}
