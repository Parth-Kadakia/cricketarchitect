import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import BarChart from '../components/BarChart';
import LineChart from '../components/LineChart';
import Panel from '../components/Panel';
import SimpleTable from '../components/SimpleTable';
import { useAuth } from '../context/AuthContext';

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

export default function FinancialsPage() {
  const { token, franchise } = useAuth();

  const [summary, setSummary] = useState(null);
  const [valuations, setValuations] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setError('');

    try {
      const [summaryResponse, valuationResponse, transactionResponse] = await Promise.all([
        api.financials.summary(token),
        api.financials.valuations(token),
        api.financials.transactions(token)
      ]);

      setSummary(summaryResponse);
      setValuations(valuationResponse.valuations || []);
      setTransactions(transactionResponse.transactions || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [token]);

  async function upgrade(mode) {
    if (!franchise?.id) {
      return;
    }

    try {
      await api.franchise.academyUpgrade(token, franchise.id, mode);
      await load();
    } catch (actionError) {
      setError(actionError.message);
    }
  }

  const valuationLine = useMemo(
    () =>
      valuations.map((item, index) => ({
        label: `V${index + 1}`,
        value: Number(item.total_value)
      })),
    [valuations]
  );

  const valuationBars = useMemo(() => {
    const latest = valuations[valuations.length - 1];
    if (!latest) {
      return [];
    }

    return [
      { label: 'Base', value: Number(latest.base_value) },
      { label: 'Wins', value: Number(latest.win_bonus) },
      { label: 'Streak', value: Number(latest.streak_bonus) },
      { label: 'Cups', value: Number(latest.cup_bonus) },
      { label: 'Fans', value: Number(latest.fan_bonus) },
      { label: 'Players', value: Number(latest.player_bonus) }
    ];
  }, [valuations]);

  if (loading) {
    return <div className="loading-state">Loading valuation center...</div>;
  }

  return (
    <div className="page-grid">
      {error ? <p className="error-text full-width">{error}</p> : null}

      <Panel title="Franchise Finance Snapshot" className="full-width">
        {summary ? (
          <div className="inline-metrics">
            <p>
              Franchise Value: <strong>{money(summary.franchise.total_valuation)}</strong>
            </p>
            <p>
              Payroll: <strong>{money(summary.payroll)}</strong>
            </p>
            <p>
              Player Asset Value: <strong>{money(summary.playerMarketValue)}</strong>
            </p>
            <p>
              Cash Health: <strong>{money(summary.cashFlowHealth)}</strong>
            </p>
          </div>
        ) : (
          <div className="empty-state">No summary data.</div>
        )}
      </Panel>

      <Panel
        title="Quick Academy Upgrades"
        actions={
          <div className="row-actions">
            <button type="button" className="button" onClick={() => upgrade('ACADEMY_LEVEL')}>
              Upgrade Academy
            </button>
            <button type="button" className="button secondary" onClick={() => upgrade('YOUTH_RATING')}>
              Upgrade Youth Rating
            </button>
          </div>
        }
      >
        <p className="muted">Uses points only (prospect/growth), no direct money spend.</p>
      </Panel>

      <Panel title="Valuation Trend">
        <LineChart data={valuationLine} valueFormatter={money} />
      </Panel>

      <Panel title="Latest Valuation Breakdown">
        <BarChart data={valuationBars} color="var(--accent)" />
      </Panel>

      <Panel title="Transaction Timeline" className="full-width">
        <SimpleTable
          columns={[
            { key: 'created_at', label: 'Time', render: (value) => new Date(value).toLocaleString() },
            { key: 'transaction_type', label: 'Type' },
            { key: 'amount', label: 'Amount', render: (value) => money(value) },
            { key: 'description', label: 'Description' }
          ]}
          rows={transactions}
          emptyMessage="No transactions yet."
        />
      </Panel>
    </div>
  );
}
