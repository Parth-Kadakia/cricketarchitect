import { useEffect, useState } from 'react';
import { api } from '../api/client';
import Panel from '../components/Panel';
import SimpleTable from '../components/SimpleTable';
import { useAuth } from '../context/AuthContext';

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

export default function TransferMarketPage() {
  const { token } = useAuth();

  const [auctionPlayers, setAuctionPlayers] = useState([]);
  const [transferFeed, setTransferFeed] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setError('');

    try {
      const [auctionResponse, transferResponse] = await Promise.all([api.marketplace.auctionPool(), api.marketplace.transferFeed(120)]);
      setAuctionPlayers(auctionResponse.players || []);
      setTransferFeed(transferResponse.feed || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function buyPlayer(playerId) {
    try {
      await api.marketplace.buyAuctionPlayer(token, playerId);
      await load();
    } catch (buyError) {
      setError(buyError.message);
    }
  }

  if (loading) {
    return <div className="loading-state">Loading transfer hub...</div>;
  }

  return (
    <div className="page-grid">
      {error ? <p className="error-text full-width">{error}</p> : null}

      <Panel title="Auction Pool" className="full-width">
        <SimpleTable
          columns={[
            { key: 'name', label: 'Player', render: (_, row) => `${row.first_name} ${row.last_name}` },
            { key: 'country_origin', label: 'Country' },
            { key: 'role', label: 'Role' },
            { key: 'age', label: 'Age' },
            { key: 'batting', label: 'Bat' },
            { key: 'bowling', label: 'Bowl' },
            { key: 'potential', label: 'Potential' },
            { key: 'market_value', label: 'Value', render: (value) => money(value) },
            {
              key: 'buy',
              label: 'Action',
              render: (_, row) => (
                <button type="button" onClick={() => buyPlayer(row.id)}>
                  Buy
                </button>
              )
            }
          ]}
          rows={auctionPlayers}
          emptyMessage="Auction pool is empty right now."
        />
      </Panel>

      <Panel title="CPU Transfer / Loan / Retirement Feed" className="full-width">
        <SimpleTable
          columns={[
            { key: 'created_at', label: 'Time', render: (value) => new Date(value).toLocaleString() },
            { key: 'action_type', label: 'Type' },
            { key: 'source_franchise_name', label: 'Source' },
            { key: 'target_franchise_name', label: 'Target' },
            { key: 'message', label: 'Message' }
          ]}
          rows={transferFeed}
          emptyMessage="No transfer feed entries yet."
        />
      </Panel>
    </div>
  );
}
