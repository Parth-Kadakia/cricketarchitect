import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import TeamNameButton from '../components/TeamNameButton';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { money, timeAgo, setPageTitle } from '../utils/format';

function controlLabel(row, myId) {
  if (Number(row.id) === Number(myId)) return 'YOU';
  if (row.control_type === 'CPU') return 'CPU';
  if (row.status === 'FOR_SALE') return 'SALE';
  if (row.status === 'AVAILABLE') return 'OPEN';
  return row.owner_username?.toUpperCase().slice(0, 6) || 'USER';
}

function controlClass(label) {
  const l = label.toLowerCase();
  if (l === 'you') return 'mp-ctrl--you';
  if (l === 'cpu') return 'mp-ctrl--cpu';
  if (l === 'sale' || l === 'open') return 'mp-ctrl--open';
  return 'mp-ctrl--user';
}

function ValRing({ value, max, size = 42 }) {
  const v = Number(value || 0);
  const pct = Math.max(0, Math.min(100, (v / (max || 1)) * 100));
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  const color = pct >= 60 ? 'var(--leaf)' : pct >= 30 ? '#daa520' : 'var(--danger)';
  return (
    <svg width={size} height={size} className="mp-val-ring">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--border)" strokeWidth={3} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={3}
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle"
        fontSize={size*0.28} fontWeight="700" fontFamily="'Space Grotesk', sans-serif" fill={color}>
        {money(v).replace('$', '')}
      </text>
    </svg>
  );
}

export default function FranchiseMarketplacePage() {
  const { token, franchise, refreshProfile } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState('clubs');
  const [data, setData] = useState({ availableCities: [], franchisesForSale: [], allFranchises: [], recentSales: [] });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(null);
  const [clubSearch, setClubSearch] = useState('');
  const [citySearch, setCitySearch] = useState('');
  const [tierFilter, setTierFilter] = useState('ALL');
  const [clubSort, setClubSort] = useState('valuation');

  useEffect(() => { setPageTitle('Franchise Marketplace'); }, []);

  async function load() {
    setError('');
    try {
      const response = await api.marketplace.overview();
      setData(response);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function act(fn, key) {
    setActing(key);
    try { await fn(); await refreshProfile(); await load(); toast.success('Franchise action complete!'); }
    catch (e) { setError(e.message); toast.error(e.message); }
    finally { setActing(null); }
  }

  /* ── Derived data ── */
  const tiers = useMemo(() => {
    const s = new Set((data.allFranchises || []).map((f) => f.current_league_tier));
    return ['ALL', ...Array.from(s).sort((a, b) => Number(a) - Number(b))];
  }, [data.allFranchises]);

  const maxVal = useMemo(() => Math.max(...(data.allFranchises || []).map((f) => Number(f.total_valuation || 0)), 1), [data.allFranchises]);

  const filteredClubs = useMemo(() => {
    let list = [...(data.allFranchises || [])];
    if (tierFilter !== 'ALL') list = list.filter((f) => String(f.current_league_tier) === String(tierFilter));
    if (clubSearch.trim()) {
      const q = clubSearch.toLowerCase();
      list = list.filter((f) =>
        (f.franchise_name || '').toLowerCase().includes(q) ||
        (f.city_name || '').toLowerCase().includes(q) ||
        (f.country || '').toLowerCase().includes(q) ||
        (f.owner_username || '').toLowerCase().includes(q)
      );
    }
    if (clubSort === 'valuation') list.sort((a, b) => Number(b.total_valuation || 0) - Number(a.total_valuation || 0));
    else if (clubSort === 'wins') list.sort((a, b) => Number(b.wins || 0) - Number(a.wins || 0));
    else if (clubSort === 'academy') list.sort((a, b) => Number(b.academy_level || 0) - Number(a.academy_level || 0));
    else if (clubSort === 'name') list.sort((a, b) => (a.franchise_name || '').localeCompare(b.franchise_name || ''));
    return list;
  }, [data.allFranchises, tierFilter, clubSearch, clubSort]);

  const forSale = useMemo(() => (data.franchisesForSale || []).filter((f) => f.status === 'FOR_SALE'), [data.franchisesForSale]);

  const filteredCities = useMemo(() => {
    if (!citySearch.trim()) return data.availableCities || [];
    const q = citySearch.toLowerCase();
    return (data.availableCities || []).filter((c) => (c.name || '').toLowerCase().includes(q) || (c.country || '').toLowerCase().includes(q));
  }, [data.availableCities, citySearch]);

  const summaryStats = useMemo(() => {
    const all = data.allFranchises || [];
    const userOwned = all.filter((f) => f.control_type === 'USER').length;
    const cpuOwned = all.filter((f) => f.control_type === 'CPU').length;
    const totalVal = all.reduce((s, f) => s + Number(f.total_valuation || 0), 0);
    return { total: all.length, userOwned, cpuOwned, forSale: forSale.length, cities: (data.availableCities || []).length, totalVal };
  }, [data, forSale]);

  if (loading) return <div className="sq-loading"><div className="sq-spinner" /><span>Loading marketplace...</span></div>;

  return (
    <div className="mp-page">
      {error && <div className="sq-error">{error}<button type="button" onClick={() => setError('')}>×</button></div>}

      {/* ── Header ── */}
      <div className="mp-header">
        <div>
          <h2 className="mp-title">Franchise Marketplace</h2>
          <span className="mp-subtitle">{summaryStats.total} franchises &middot; {summaryStats.cities} unclaimed cities</span>
        </div>
      </div>

      {/* ── Summary strip ── */}
      <div className="mp-stats-strip">
        <div className="mp-stat-card">
          <span className="mp-stat-label">Total Clubs</span>
          <span className="mp-stat-value">{summaryStats.total}</span>
        </div>
        <div className="mp-stat-card">
          <span className="mp-stat-label">User Owned</span>
          <span className="mp-stat-value">{summaryStats.userOwned}</span>
        </div>
        <div className="mp-stat-card">
          <span className="mp-stat-label">CPU Managed</span>
          <span className="mp-stat-value">{summaryStats.cpuOwned}</span>
        </div>
        <div className="mp-stat-card mp-stat-card--accent">
          <span className="mp-stat-label">For Sale</span>
          <span className="mp-stat-value">{summaryStats.forSale}</span>
        </div>
        <div className="mp-stat-card mp-stat-card--accent">
          <span className="mp-stat-label">Open Cities</span>
          <span className="mp-stat-value">{summaryStats.cities}</span>
        </div>
        <div className="mp-stat-card">
          <span className="mp-stat-label">Total Valuation</span>
          <span className="mp-stat-value">{money(summaryStats.totalVal)}</span>
        </div>
      </div>

      {/* ── Tabs ── */}
      <nav className="sq-tabs">
        <button type="button" className={`sq-tab ${tab === 'clubs' ? 'active' : ''}`} onClick={() => setTab('clubs')}>
          <span className="sq-tab-icon">🏟️</span>All Clubs<span className="tm-tab-count">{(data.allFranchises||[]).length}</span>
        </button>
        <button type="button" className={`sq-tab ${tab === 'sale' ? 'active' : ''}`} onClick={() => setTab('sale')}>
          <span className="sq-tab-icon">🏷️</span>For Sale<span className="tm-tab-count">{forSale.length}</span>
        </button>
        <button type="button" className={`sq-tab ${tab === 'cities' ? 'active' : ''}`} onClick={() => setTab('cities')}>
          <span className="sq-tab-icon">🌍</span>Open Cities<span className="tm-tab-count">{(data.availableCities||[]).length}</span>
        </button>
        <button type="button" className={`sq-tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
          <span className="sq-tab-icon">📜</span>Sale History
        </button>
      </nav>

      {/* ═══ ALL CLUBS TAB ═══ */}
      {tab === 'clubs' && (
        <div className="sq-tab-content">
          <div className="tm-controls">
            <input type="text" className="sq-search" placeholder="Search clubs, cities, owners..." value={clubSearch} onChange={(e) => setClubSearch(e.target.value)} />
            <div className="tm-filters">
              {tiers.map((t) => (
                <button key={t} type="button" className={`sq-filter-btn ${tierFilter === t ? 'active' : ''}`} onClick={() => setTierFilter(t)}>
                  {t === 'ALL' ? 'All Tiers' : `Tier ${t}`}
                </button>
              ))}
            </div>
            <select className="tm-sort-select" value={clubSort} onChange={(e) => setClubSort(e.target.value)}>
              <option value="valuation">Sort: Valuation</option>
              <option value="wins">Sort: Wins</option>
              <option value="academy">Sort: Academy</option>
              <option value="name">Sort: Name</option>
            </select>
          </div>

          {filteredClubs.length === 0 ? (
            <div className="sq-empty">No clubs match your filters.</div>
          ) : (
            <div className="mp-club-grid">
              {filteredClubs.map((club) => {
                const ctrl = controlLabel(club, franchise?.id);
                const isMe = ctrl === 'YOU';
                return (
                  <div key={club.id} className={`mp-club-card ${isMe ? 'mp-club-card--mine' : ''}`}>
                    <div className="mp-club-top">
                      <div className="mp-club-identity">
                        <TeamNameButton
                          franchiseId={club.id}
                          name={club.franchise_name}
                          city={club.city_name}
                          country={club.country}
                          className="mp-club-name"
                        >
                          {club.franchise_name}
                        </TeamNameButton>
                        <span className="mp-club-loc">📍 {club.city_name}, {club.country}</span>
                      </div>
                      <span className={`mp-ctrl-badge ${controlClass(ctrl)}`}>{ctrl}</span>
                    </div>

                    <div className="mp-club-metrics">
                      <div className="mp-metric">
                        <span className="mp-metric-val">{club.wins || 0}</span>
                        <span className="mp-metric-lbl">W</span>
                      </div>
                      <div className="mp-metric">
                        <span className="mp-metric-val">{club.losses || 0}</span>
                        <span className="mp-metric-lbl">L</span>
                      </div>
                      <div className="mp-metric">
                        <span className="mp-metric-val">{club.championships || 0}</span>
                        <span className="mp-metric-lbl">🏆</span>
                      </div>
                      <div className="mp-metric">
                        <span className="mp-metric-val">{club.win_streak || 0}</span>
                        <span className="mp-metric-lbl">Streak</span>
                      </div>
                    </div>

                    <div className="mp-club-details">
                      <div className="mp-detail-row">
                        <span>League Tier</span>
                        <span className={`lg-tier-badge lg-tier-badge--${club.current_league_tier}`} style={{ width: 22, height: 22, fontSize: '0.65rem' }}>{club.current_league_tier}</span>
                      </div>
                      <div className="mp-detail-row">
                        <span>Academy</span>
                        <strong>Lv {club.academy_level}</strong>
                      </div>
                      <div className="mp-detail-row">
                        <span>Youth Rating</span>
                        <strong>{Number(club.youth_development_rating || 0).toFixed(1)}</strong>
                      </div>
                      <div className="mp-detail-row">
                        <span>Record</span>
                        <span className="mp-promo-rele">
                          <span className="mp-promo">▲{club.promotions || 0}</span>
                          <span className="mp-rele">▼{club.relegations || 0}</span>
                        </span>
                      </div>
                    </div>

                    <div className="mp-club-footer">
                      <span className="mp-club-val">{money(club.total_valuation)}</span>
                      <div className="mp-val-bar"><div className="mp-val-bar-fill" style={{ width: `${(Number(club.total_valuation || 0) / maxVal) * 100}%` }} /></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ FOR SALE TAB ═══ */}
      {tab === 'sale' && (
        <div className="sq-tab-content">
          {forSale.length === 0 ? (
            <div className="sq-empty">No franchises currently listed for sale. Check back later!</div>
          ) : (
            <div className="mp-sale-grid">
              {forSale.map((club) => (
                <div key={club.id} className="mp-sale-card">
                  <div className="mp-sale-header">
                    <div>
                      <TeamNameButton franchiseId={club.id} name={club.franchise_name} city={club.city_name} country={club.country} className="mp-sale-name">
                        {club.franchise_name}
                      </TeamNameButton>
                      <span className="mp-sale-loc">📍 {club.city_name}, {club.country}</span>
                    </div>
                    <span className={`lg-tier-badge lg-tier-badge--${club.current_league_tier}`} style={{ width: 26, height: 26, fontSize: '0.72rem' }}>{club.current_league_tier}</span>
                  </div>

                  <div className="mp-sale-stats">
                    <div className="mp-sale-stat"><span className="mp-sale-stat-lbl">Wins</span><strong>{club.wins||0}</strong></div>
                    <div className="mp-sale-stat"><span className="mp-sale-stat-lbl">Losses</span><strong>{club.losses||0}</strong></div>
                    <div className="mp-sale-stat"><span className="mp-sale-stat-lbl">Academy</span><strong>Lv {club.academy_level}</strong></div>
                    <div className="mp-sale-stat"><span className="mp-sale-stat-lbl">Trophies</span><strong>{club.championships||0}</strong></div>
                  </div>

                  <div className="mp-sale-footer">
                    <span className="mp-sale-price">{money(club.total_valuation)}</span>
                    <button type="button" className="sq-btn sq-btn--primary" disabled={!!franchise || acting === `buy-${club.id}`}
                      onClick={() => act(() => api.franchise.purchase(token, club.id), `buy-${club.id}`)}>
                      {acting === `buy-${club.id}` ? 'Purchasing...' : '🛒 Purchase'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ OPEN CITIES TAB ═══ */}
      {tab === 'cities' && (
        <div className="sq-tab-content">
          <input type="text" className="sq-search" placeholder="Search cities or countries..." value={citySearch} onChange={(e) => setCitySearch(e.target.value)} style={{ maxWidth: 360, marginBottom: '0.75rem' }} />

          {filteredCities.length === 0 ? (
            <div className="sq-empty">No unclaimed cities available.</div>
          ) : (
            <div className="mp-city-grid">
              {filteredCities.map((city) => (
                <div key={city.id} className="mp-city-card">
                  <div className="mp-city-info">
                    <strong className="mp-city-name">{city.name}</strong>
                    <span className="mp-city-country">{city.country}</span>
                    {city.latitude && city.longitude && (
                      <span className="mp-city-coords">{Number(city.latitude).toFixed(1)}°, {Number(city.longitude).toFixed(1)}°</span>
                    )}
                  </div>
                  <button type="button" className="sq-btn sq-btn--primary mp-claim-btn" disabled={!!franchise || acting === `claim-${city.id}`}
                    onClick={() => act(() => api.franchise.claim(token, { cityId: city.id, franchiseName: `${city.name} Rise` }), `claim-${city.id}`)}>
                    {acting === `claim-${city.id}` ? 'Claiming...' : '🏴 Claim'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ SALE HISTORY TAB ═══ */}
      {tab === 'history' && (
        <div className="sq-tab-content">
          {(data.recentSales || []).length === 0 ? (
            <div className="sq-empty">No franchise sales recorded yet.</div>
          ) : (
            <div className="mp-history-list">
              {data.recentSales.map((sale, i) => (
                <div key={sale.id || i} className="mp-history-item">
                  <div className="mp-history-dot" />
                  <div className="mp-history-body">
                    <TeamNameButton franchiseId={sale.franchise_id} name={sale.franchise_name} className="mp-history-name">
                      {sale.franchise_name}
                    </TeamNameButton>
                    <span className="mp-history-detail">Sold for <strong>{money(sale.sale_value)}</strong></span>
                  </div>
                  <span className="mp-history-time">{sale.sold_at ? timeAgo(sale.sold_at) : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
