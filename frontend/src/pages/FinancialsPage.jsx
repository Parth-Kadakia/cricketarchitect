import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import NoFranchiseBox, { isNoFranchiseError } from '../components/NoFranchiseBox';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { money, moneyFull, pct, timeAgo, setPageTitle } from '../utils/format';

const TX_META = {
  SALARY:          { icon: '💰', color: 'var(--danger)', label: 'Salary' },
  TRANSFER_IN:     { icon: '📥', color: 'var(--leaf)',   label: 'Transfer In' },
  TRANSFER_OUT:    { icon: '📤', color: 'var(--accent)',  label: 'Transfer Out' },
  LOAN:            { icon: '🤝', color: 'var(--muted)',   label: 'Loan' },
  SPONSORSHIP:     { icon: '📢', color: 'var(--leaf)',    label: 'Sponsorship' },
  PRIZE_MONEY:     { icon: '🏆', color: 'var(--accent)',  label: 'Prize Money' },
  SALE:            { icon: '🏷️', color: 'var(--leaf)',   label: 'Sale' },
  PURCHASE:        { icon: '🛒', color: 'var(--danger)',  label: 'Purchase' },
  ACADEMY_UPGRADE: { icon: '🎓', color: 'var(--moss)',    label: 'Academy' },
  POINT_REWARD:    { icon: '⭐', color: 'var(--accent)',  label: 'Points' },
};

/* ── sparkline SVG ── */
function ValSparkline({ data, width = 220, height = 48 }) {
  if (!data?.length) return null;
  const vals = data.map((d) => Number(d.total_value || 0));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const pts = vals.map((v, i) => {
    const x = (i / Math.max(1, vals.length - 1)) * width;
    const y = height - 4 - ((v - min) / range) * (height - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg className="fn-sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="fnGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,174,71,.35)" />
          <stop offset="100%" stopColor="rgba(255,174,71,.02)" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${pts.join(' ')} ${width},${height}`} fill="url(#fnGrad)" />
      <polyline points={pts.join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── bar chart (inline SVG) ── */
function BreakdownBars({ data }) {
  if (!data?.length) return null;
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="fn-breakdown-bars">
      {data.map((d) => (
        <div key={d.label} className="fn-bar-row">
          <span className="fn-bar-label">{d.label}</span>
          <div className="fn-bar-track">
            <div
              className="fn-bar-fill"
              style={{ width: `${Math.max(2, (d.value / max) * 100)}%` }}
            />
          </div>
          <span className="fn-bar-value">{moneyFull(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

/* ──────────────────────────────────── */
export default function FinancialsPage() {
  const { token, franchise } = useAuth();
  const toast = useToast();
  const isInternationalMode = String(franchise?.competition_mode || '').toUpperCase() === 'INTERNATIONAL';
  const [summary, setSummary] = useState(null);
  const [valuations, setValuations] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState(null);
  const [tab, setTab] = useState('overview');
  const [txFilter, setTxFilter] = useState('ALL');

  useEffect(() => { setPageTitle('Financials'); }, []);

  async function load() {
    setError('');
    try {
      const [sRes, vRes, tRes] = await Promise.all([
        api.financials.summary(token),
        api.financials.valuations(token),
        api.financials.transactions(token),
      ]);
      setSummary(sRes);
      setValuations(vRes.valuations || []);
      setTransactions(tRes.transactions || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isInternationalMode) {
      setLoading(false);
      setSummary(null);
      setValuations([]);
      setTransactions([]);
      return;
    }
    load();
  }, [token, isInternationalMode]);

  async function upgrade(mode) {
    if (!franchise?.id) return;
    setUpgrading(mode);
    try {
      await api.franchise.academyUpgrade(token, franchise.id, mode);
      await load();
      toast.success('Facility upgraded!');
    } catch (e) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setUpgrading(null);
    }
  }

  /* derived data */
  const breakdownData = useMemo(() => {
    const latest = valuations[valuations.length - 1];
    if (!latest) return [];
    return [
      { label: 'Base',    value: Number(latest.base_value) },
      { label: 'Wins',    value: Number(latest.win_bonus) },
      { label: 'Streak',  value: Number(latest.streak_bonus) },
      { label: 'Cups',    value: Number(latest.cup_bonus) },
      { label: 'Fans',    value: Number(latest.fan_bonus) },
      { label: 'Players', value: Number(latest.player_bonus) },
    ];
  }, [valuations]);

  const totalValuation = valuations.length
    ? Number(valuations[valuations.length - 1].total_value)
    : 0;
  const prevValuation = valuations.length > 1
    ? Number(valuations[valuations.length - 2].total_value)
    : totalValuation;
  const valDelta = totalValuation - prevValuation;

  const txTypes = useMemo(() => {
    const set = new Set(transactions.map((t) => t.transaction_type));
    return ['ALL', ...Array.from(set).sort()];
  }, [transactions]);

  const filteredTx = useMemo(
    () => txFilter === 'ALL' ? transactions : transactions.filter((t) => t.transaction_type === txFilter),
    [transactions, txFilter]
  );

  /* ── render ── */
  if (loading) {
    return (
      <div className="sq-loading"><div className="sq-spinner" /><p>Loading financials…</p></div>
    );
  }

  if (isInternationalMode) {
    return (
      <div className="fn-page">
        <div className="sq-empty">Financial valuation is disabled in international mode. Team progression is tracked via strength and league results.</div>
      </div>
    );
  }

  if (error && !summary) {
    if (isNoFranchiseError(error)) return <NoFranchiseBox />;
    return <div className="sq-error">{error}</div>;
  }

  const tabs = [
    { key: 'overview',     label: 'Overview' },
    { key: 'transactions', label: 'Transactions', count: transactions.length },
  ];

  return (
    <div className="fn-page sq-fade-in">
      <header className="fn-header">
        <h1 className="fn-title">Financials</h1>
        <p className="fn-subtitle">{franchise?.franchise_name || 'Valuation & Transactions'}</p>
      </header>

      {error && <div className="sq-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {/* Tab bar */}
      <nav className="sq-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`sq-tab${tab === t.key ? ' sq-tab--active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.count != null && <span className="tm-tab-count">{t.count}</span>}
          </button>
        ))}
      </nav>

      {/* ════════════════ OVERVIEW TAB ════════════════ */}
      {tab === 'overview' && (
        <div className="fn-overview sq-fade-in">

          {/* Hero metric strip */}
          {summary && (
            <div className="fn-hero-strip">
              <div className="fn-hero-card fn-hero-card--accent">
                <span className="fn-hero-label">Total Valuation</span>
                <span className="fn-hero-value">{moneyFull(totalValuation)}</span>
                <span className={`fn-hero-delta ${valDelta >= 0 ? 'fn-hero-delta--up' : 'fn-hero-delta--down'}`}>
                  {valDelta >= 0 ? '▲' : '▼'} {moneyFull(Math.abs(valDelta))}
                </span>
              </div>
              <div className="fn-hero-card">
                <span className="fn-hero-label">Cash Balance</span>
                <span className="fn-hero-value">{moneyFull(summary.cashBalance)}</span>
              </div>
              <div className="fn-hero-card">
                <span className="fn-hero-label">Payroll</span>
                <span className="fn-hero-value">{moneyFull(summary.payroll)}</span>
              </div>
              <div className="fn-hero-card">
                <span className="fn-hero-label">Player Assets</span>
                <span className="fn-hero-value">{moneyFull(summary.playerMarketValue)}</span>
              </div>
              <div className="fn-hero-card">
                <span className="fn-hero-label">Cash Health</span>
                <span className={`fn-hero-value ${summary.cashFlowHealth < 0 ? 'fn-hero-value--danger' : ''}`}>
                  {moneyFull(summary.cashFlowHealth)}
                </span>
                <span className="fn-hero-hint">after payroll</span>
              </div>
            </div>
          )}

          {/* Two-column: Valuation Trend | Breakdown */}
          <div className="fn-two-col">
            <div className="fn-card">
              <h3 className="fn-section-title">Valuation Trend</h3>
              {valuations.length ? (
                <>
                  <ValSparkline data={valuations} width={400} height={100} />
                  <div className="fn-trend-footer">
                    <span className="fn-trend-range">
                      {moneyFull(Number(valuations[0].total_value))} → {moneyFull(totalValuation)}
                    </span>
                    <span className="fn-trend-count">{valuations.length} snapshots</span>
                  </div>
                </>
              ) : (
                <div className="sq-empty">No valuation history yet.</div>
              )}
            </div>

            <div className="fn-card">
              <h3 className="fn-section-title">Valuation Breakdown</h3>
              {breakdownData.length ? (
                <>
                  <BreakdownBars data={breakdownData} />
                  <div className="fn-breakdown-total">
                    Total: <strong>{moneyFull(totalValuation)}</strong>
                  </div>
                </>
              ) : (
                <div className="sq-empty">No valuation data.</div>
              )}
            </div>
          </div>

          {/* Academy Upgrades */}
          <div className="fn-card fn-upgrades">
            <h3 className="fn-section-title">Academy Upgrades</h3>
            <p className="fn-upgrade-note">Uses prospect / growth points — no cash spend.</p>
            <div className="fn-upgrade-row">
              <div className="fn-upgrade-option">
                <div className="fn-upgrade-icon">🏫</div>
                <div className="fn-upgrade-info">
                  <span className="fn-upgrade-name">Academy Level</span>
                  <span className="fn-upgrade-desc">Improves prospect generation quality</span>
                  <span className="fn-upgrade-current">Current: Lv.{summary?.franchise?.academy_level ?? '?'}</span>
                </div>
                <button
                  className="sq-btn sq-btn--primary"
                  disabled={upgrading === 'ACADEMY_LEVEL'}
                  onClick={() => upgrade('ACADEMY_LEVEL')}
                >
                  {upgrading === 'ACADEMY_LEVEL' ? 'Upgrading…' : 'Upgrade'}
                </button>
              </div>
              <div className="fn-upgrade-option">
                <div className="fn-upgrade-icon">⚡</div>
                <div className="fn-upgrade-info">
                  <span className="fn-upgrade-name">Youth Rating</span>
                  <span className="fn-upgrade-desc">Boosts youth development speed</span>
                  <span className="fn-upgrade-current">Current: {Number(summary?.franchise?.youth_development_rating ?? 0).toFixed(1)}</span>
                </div>
                <button
                  className="sq-btn sq-btn--primary"
                  disabled={upgrading === 'YOUTH_RATING'}
                  onClick={() => upgrade('YOUTH_RATING')}
                >
                  {upgrading === 'YOUTH_RATING' ? 'Upgrading…' : 'Upgrade'}
                </button>
              </div>
            </div>
          </div>

          {/* Recent transactions preview */}
          <div className="fn-card">
            <div className="fn-section-header">
              <h3 className="fn-section-title">Recent Transactions</h3>
              <button className="fn-link-btn" onClick={() => setTab('transactions')}>View all →</button>
            </div>
            {transactions.length === 0 ? (
              <div className="sq-empty">No transactions yet.</div>
            ) : (
              <div className="fn-tx-list">
                {transactions.slice(0, 5).map((tx) => {
                  const meta = TX_META[tx.transaction_type] || { icon: '💲', color: 'var(--muted)', label: tx.transaction_type };
                  const amt = Number(tx.amount);
                  return (
                    <div key={tx.id} className="fn-tx-item">
                      <span className="fn-tx-icon">{meta.icon}</span>
                      <div className="fn-tx-body">
                        <span className="fn-tx-desc">{tx.description || meta.label}</span>
                        <span className="fn-tx-time">{timeAgo(tx.created_at)}</span>
                      </div>
                      <span className={`fn-tx-amount ${amt >= 0 ? 'fn-tx-amount--pos' : 'fn-tx-amount--neg'}`}>
                        {amt >= 0 ? '+' : ''}{moneyFull(amt)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════════════ TRANSACTIONS TAB ════════════════ */}
      {tab === 'transactions' && (
        <div className="fn-tx-tab sq-fade-in">
          {/* Filter row */}
          <div className="fn-tx-filters">
            {txTypes.map((t) => (
              <button
                key={t}
                className={`sq-filter-btn${txFilter === t ? ' sq-filter-btn--active' : ''}`}
                onClick={() => setTxFilter(t)}
              >
                {t === 'ALL' ? 'All' : (TX_META[t]?.label || t)}
                {t !== 'ALL' && (
                  <span className="tm-tab-count">
                    {transactions.filter((tx) => tx.transaction_type === t).length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {filteredTx.length === 0 ? (
            <div className="sq-empty">No transactions found.</div>
          ) : (
            <div className="fn-tx-full-list">
              {filteredTx.map((tx) => {
                const meta = TX_META[tx.transaction_type] || { icon: '💲', color: 'var(--muted)', label: tx.transaction_type };
                const amt = Number(tx.amount);
                return (
                  <div key={tx.id} className="fn-tx-row">
                    <span className="fn-tx-icon">{meta.icon}</span>
                    <div className="fn-tx-main">
                      <span className="fn-tx-type-badge" style={{ background: meta.color }}>{meta.label}</span>
                      <span className="fn-tx-row-desc">{tx.description || '—'}</span>
                    </div>
                    <span className={`fn-tx-amount ${amt >= 0 ? 'fn-tx-amount--pos' : 'fn-tx-amount--neg'}`}>
                      {amt >= 0 ? '+' : ''}{moneyFull(amt)}
                    </span>
                    <span className="fn-tx-timestamp">{new Date(tx.created_at).toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
