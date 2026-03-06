import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import TeamNameButton from '../components/TeamNameButton';
import { useAuth } from '../context/AuthContext';

/* ── Helpers ── */
const money = (v) => `$${Number(v || 0).toFixed(2)}`;
const overall = (p) => ((Number(p.batting || 0) + Number(p.bowling || 0) + Number(p.fielding || 0) + Number(p.fitness || 0) + Number(p.temperament || 0)) / 5).toFixed(0);
const ROLE_EMOJI = { BATTER: '🏏', BOWLER: '🎯', ALL_ROUNDER: '⚡', WICKET_KEEPER: '🧤' };
const ROLE_SHORT = { BATTER: 'BAT', BOWLER: 'BWL', ALL_ROUNDER: 'AR', WICKET_KEEPER: 'WK' };
const ACTION_ICON = { TRANSFER: '🔄', LOAN: '📋', RETIREMENT: '👋', RELEASE: '🚪', PROMOTION: '⬆️', RETURN: '↩️' };
const SORT_OPTIONS = [
  { value: 'overall-desc', label: 'Overall ↓' },
  { value: 'potential-desc', label: 'Potential ↓' },
  { value: 'value-desc', label: 'Value ↓' },
  { value: 'value-asc', label: 'Value ↑' },
  { value: 'age-asc', label: 'Youngest' },
  { value: 'age-desc', label: 'Oldest' },
];

function StatMini({ label, value, max = 100 }) {
  const pct = Math.max(0, Math.min(100, (Number(value) / max) * 100));
  const color = pct >= 70 ? 'var(--leaf)' : pct >= 45 ? '#daa520' : 'var(--danger)';
  return (
    <div className="tm-stat-mini">
      <div className="tm-stat-mini-header">
        <span className="tm-stat-mini-label">{label}</span>
        <span className="tm-stat-mini-val" style={{ color }}>{value}</span>
      </div>
      <div className="tm-stat-mini-track"><div className="tm-stat-mini-fill" style={{ width: `${pct}%`, background: color }} /></div>
    </div>
  );
}

function OvrRing({ value, size = 38 }) {
  const v = Number(value || 0);
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, v));
  const offset = c * (1 - pct / 100);
  const color = pct >= 70 ? 'var(--leaf)' : pct >= 45 ? '#daa520' : 'var(--danger)';
  return (
    <svg width={size} height={size} className="tm-ovr-ring">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={3} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={3} strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size * 0.32} fontWeight="700" fontFamily="'Space Grotesk', sans-serif" fill={color}>{v}</text>
    </svg>
  );
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function TransferMarketPage() {
  const { token, franchise, refreshProfile } = useAuth();
  const isInternationalMode = String(franchise?.competition_mode || '').toUpperCase() === 'INTERNATIONAL';

  const [tab, setTab] = useState('auction');
  const [auctionPlayers, setAuctionPlayers] = useState([]);
  const [transferFeed, setTransferFeed] = useState([]);
  const [cashBalance, setCashBalance] = useState(Number(franchise?.financial_balance || 0));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [sort, setSort] = useState('overall-desc');
  const [buying, setBuying] = useState(null);
  const [feedFilter, setFeedFilter] = useState('ALL');

  async function load() {
    setError('');
    try {
      const [aResp, tResp, fResp] = await Promise.all([
        api.marketplace.auctionPool(),
        api.marketplace.transferFeed(120),
        api.financials.summary(token)
      ]);
      setAuctionPlayers(aResp.players || []);
      setTransferFeed(tResp.feed || []);
      setCashBalance(Number(fResp?.cashBalance ?? fResp?.franchise?.financial_balance ?? 0));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (isInternationalMode) {
      setLoading(false);
      setAuctionPlayers([]);
      setTransferFeed([]);
      return;
    }
    load();
  }, [token, isInternationalMode]);

  async function buyPlayer(playerId) {
    setBuying(playerId);
    try {
      await api.marketplace.buyAuctionPlayer(token, playerId);
      await load();
      await refreshProfile();
    } catch (e) { setError(e.message); }
    finally { setBuying(null); }
  }

  const filtered = useMemo(() => {
    let list = [...auctionPlayers];
    if (roleFilter !== 'ALL') list = list.filter((p) => p.role === roleFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) =>
        `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) ||
        (p.country_origin || '').toLowerCase().includes(q) ||
        (p.role || '').toLowerCase().includes(q)
      );
    }
    const [field, dir] = sort.split('-');
    list.sort((a, b) => {
      let av, bv;
      if (field === 'overall') { av = Number(overall(a)); bv = Number(overall(b)); }
      else if (field === 'potential') { av = Number(a.potential || 0); bv = Number(b.potential || 0); }
      else if (field === 'value') { av = Number(a.market_value || 0); bv = Number(b.market_value || 0); }
      else if (field === 'age') { av = Number(a.age || 0); bv = Number(b.age || 0); }
      else { av = 0; bv = 0; }
      return dir === 'asc' ? av - bv : bv - av;
    });
    return list;
  }, [auctionPlayers, roleFilter, search, sort]);

  const roleCounts = useMemo(() => {
    const c = { ALL: auctionPlayers.length, BATTER: 0, BOWLER: 0, ALL_ROUNDER: 0, WICKET_KEEPER: 0 };
    for (const p of auctionPlayers) c[p.role] = (c[p.role] || 0) + 1;
    return c;
  }, [auctionPlayers]);

  const feedCategories = useMemo(() => {
    const map = new Map();
    for (const entry of transferFeed) {
      const type = String(entry.action_type || 'UNKNOWN').toUpperCase();
      map.set(type, (map.get(type) || 0) + 1);
    }
    return [{ key: 'ALL', count: transferFeed.length }, ...Array.from(map.entries()).sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }))];
  }, [transferFeed]);

  const filteredFeed = useMemo(() => {
    if (feedFilter === 'ALL') return transferFeed;
    return transferFeed.filter((e) => String(e.action_type || '').toUpperCase() === feedFilter);
  }, [transferFeed, feedFilter]);

  if (loading) return <div className="sq-loading"><div className="sq-spinner" /><span>Loading transfer hub...</span></div>;
  if (isInternationalMode) {
    return (
      <div className="tm-page">
        <div className="sq-empty">Transfers and loans are disabled in international mode. Use Youth Academy call-ups and demotions instead.</div>
      </div>
    );
  }

  return (
    <div className="tm-page">
      {error && <div className="sq-error">{error}<button type="button" onClick={() => setError('')}>×</button></div>}

      {/* Header strip */}
      <div className="tm-header">
        <div className="tm-header-left">
          <h2 className="tm-title">Transfer Hub</h2>
          <span className="tm-subtitle">
            {auctionPlayers.length} players available &middot; {transferFeed.length} recent activities
          </span>
          <span className="tm-subtitle tm-subtitle--cash">
            Cash available: <strong>{money(cashBalance)}</strong> · Franchise value: <strong>{money(franchise?.total_valuation)}</strong>
          </span>
        </div>
      </div>

      {/* Tabs */}
      <nav className="sq-tabs">
        <button type="button" className={`sq-tab ${tab === 'auction' ? 'active' : ''}`} onClick={() => setTab('auction')}>
          <span className="sq-tab-icon">🏷️</span>Auction Pool <span className="tm-tab-count">{auctionPlayers.length}</span>
        </button>
        <button type="button" className={`sq-tab ${tab === 'feed' ? 'active' : ''}`} onClick={() => setTab('feed')}>
          <span className="sq-tab-icon">📰</span>Activity Feed <span className="tm-tab-count">{transferFeed.length}</span>
        </button>
      </nav>

      {/* ═══ AUCTION TAB ═══ */}
      {tab === 'auction' && (
        <div className="sq-tab-content">
          {/* Controls */}
          <div className="tm-controls">
            <input type="text" className="sq-search" placeholder="Search by name, country, role..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="tm-filters">
              {['ALL', 'BATTER', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'].map((r) => (
                <button key={r} type="button" className={`sq-filter-btn ${roleFilter === r ? 'active' : ''}`} onClick={() => setRoleFilter(r)}>
                  {r === 'ALL' ? 'All' : `${ROLE_EMOJI[r] || ''} ${ROLE_SHORT[r] || r}`}
                  <span className="tm-filter-count">{roleCounts[r] || 0}</span>
                </button>
              ))}
            </div>
            <select className="tm-sort-select" value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Player cards */}
          {filtered.length === 0 ? (
            <div className="sq-empty">No players match your search.</div>
          ) : (
            <div className="tm-card-grid">
              {filtered.map((p) => {
                const ovr = overall(p);
                const cannotAfford = Number(p.market_value || 0) > Number(cashBalance || 0);
                return (
                  <div key={p.id} className="tm-player-card">
                    <div className="tm-card-top">
                      <OvrRing value={ovr} />
                      <div className="tm-card-identity">
                        <strong className="tm-card-name">{p.first_name} {p.last_name}</strong>
                        <span className="tm-card-meta">{p.country_origin} &middot; Age {p.age}</span>
                      </div>
                      <span className={`sq-role-pill sq-role-pill--${(p.role || '').toLowerCase()}`}>
                        {ROLE_EMOJI[p.role] || ''} {ROLE_SHORT[p.role] || p.role}
                      </span>
                    </div>
                    <div className="tm-card-stats">
                      <StatMini label="BAT" value={p.batting} />
                      <StatMini label="BWL" value={p.bowling} />
                      <StatMini label="FLD" value={p.fielding} />
                      <StatMini label="FIT" value={p.fitness} />
                      <StatMini label="TMP" value={p.temperament} />
                    </div>
                    <div className="tm-card-footer">
                      <div className="tm-card-footer-left">
                        <span className="tm-val-label">Value</span>
                        <span className="tm-val-amount">{money(p.market_value)}</span>
                      </div>
                      <div className="tm-card-footer-right">
                        <span className="tm-pot-label">Potential</span>
                        <span className="tm-pot-val">{p.potential}</span>
                      </div>
                      <button
                        type="button"
                        className="sq-btn sq-btn--primary tm-buy-btn"
                        onClick={() => buyPlayer(p.id)}
                        disabled={buying === p.id || cannotAfford}
                        title={cannotAfford ? `Need ${money(p.market_value)} cash.` : undefined}
                      >
                        {buying === p.id ? 'Buying...' : cannotAfford ? 'Insufficient Cash' : '💰 Buy'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ FEED TAB ═══ */}
      {tab === 'feed' && (
        <div className="sq-tab-content">
          {/* Feed sub-tabs */}
          <div className="tm-feed-subtabs">
            {feedCategories.map((cat) => (
              <button key={cat.key} type="button" className={`tm-feed-subtab ${feedFilter === cat.key ? 'active' : ''}`} onClick={() => setFeedFilter(cat.key)}>
                {cat.key === 'ALL' ? '📋 All' : `${ACTION_ICON[cat.key] || '📋'} ${cat.key.replace(/_/g, ' ')}`}
                <span className="tm-feed-subtab-count">{cat.count}</span>
              </button>
            ))}
          </div>

          {filteredFeed.length === 0 ? (
            <div className="sq-empty">No {feedFilter === 'ALL' ? 'transfer' : feedFilter.replace(/_/g, ' ').toLowerCase()} activity yet.</div>
          ) : (
            <div className="tm-feed">
              {filteredFeed.map((entry, i) => {
                const icon = ACTION_ICON[String(entry.action_type || '').toUpperCase()] || '📋';
                const actionType = String(entry.action_type || '').replace(/_/g, ' ');
                return (
                  <div key={entry.id || i} className="tm-feed-item">
                    <span className="tm-feed-icon">{icon}</span>
                    <div className="tm-feed-body">
                      <div className="tm-feed-headline">
                        <span className={`tm-feed-type tm-feed-type--${(entry.action_type || '').toLowerCase()}`}>{actionType}</span>
                        {entry.first_name && <strong className="tm-feed-player">{entry.first_name} {entry.last_name}</strong>}
                      </div>
                      <div className="tm-feed-route">
                        {entry.source_franchise_name && (
                          <TeamNameButton
                            franchiseId={entry.source_franchise_id}
                            name={entry.source_franchise_name}
                            className="tm-feed-franchise"
                          >
                            {entry.source_franchise_name}
                          </TeamNameButton>
                        )}
                        {entry.source_franchise_name && entry.target_franchise_name && <span className="tm-feed-arrow">→</span>}
                        {entry.target_franchise_name && (
                          <TeamNameButton
                            franchiseId={entry.target_franchise_id}
                            name={entry.target_franchise_name}
                            className="tm-feed-franchise"
                          >
                            {entry.target_franchise_name}
                          </TeamNameButton>
                        )}
                      </div>
                      {entry.message && <p className="tm-feed-msg">{entry.message}</p>}
                    </div>
                    <span className="tm-feed-time">{timeAgo(entry.created_at)}</span>
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
