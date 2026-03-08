import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import NoFranchiseBox, { isNoFranchiseError } from '../components/NoFranchiseBox';
import TeamNameButton from '../components/TeamNameButton';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { money, overall, setPageTitle } from '../utils/format';
import { StatMini, OvrRing } from '../utils/MiniComponents';

/* ── Helpers ── */
const academyUpgradeCost = (level) => 10 + Number(level || 1) * 5;
const youthRatingUpgradeCost = (rating) => 20 + Math.floor(Number(rating || 0) / 10) * 5;

const ROLE_EMOJI = { BATTER: '🏏', BOWLER: '🎯', ALL_ROUNDER: '⚡', WICKET_KEEPER: '🧤' };
const ROLE_SHORT = { BATTER: 'BAT', BOWLER: 'BWL', ALL_ROUNDER: 'AR', WICKET_KEEPER: 'WK' };

function GrowthSparkline({ data }) {
  if (!data || data.length < 2) return <span className="ya-spark-empty">No history</span>;
  const vals = data.map((d) => Number(d.batting_delta||0) + Number(d.bowling_delta||0) + Number(d.fielding_delta||0));
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, 0);
  const range = max - min || 1;
  const w = 80;
  const h = 24;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ');
  return (
    <svg width={w} height={h} className="ya-sparkline">
      <polyline points={pts} fill="none" stroke="var(--leaf)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function YouthAcademyPage() {
  const { token, franchise } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState('overview');
  const [academyData, setAcademyData] = useState(null);
  const [prospects, setProspects] = useState([]);
  const [globalClubs, setGlobalClubs] = useState([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState(null);
  const [growthHistory, setGrowthHistory] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(null);
  const [prospectSearch, setProspectSearch] = useState('');
  const [prospectRole, setProspectRole] = useState('ALL');
  const [clubSearch, setClubSearch] = useState('');

  useEffect(() => { setPageTitle('Youth Academy'); }, []);

  async function load() {
    setError('');
    try {
      const [aResp, pResp, cResp] = await Promise.all([
        api.youth.academy(token),
        api.youth.prospects(token),
        api.marketplace.franchises(token)
      ]);
      setAcademyData(aResp);
      setProspects(pResp.prospects || []);
      setGlobalClubs(cResp.franchises || []);
      if (!selectedPlayerId && pResp.prospects?.length) setSelectedPlayerId(pResp.prospects[0].id);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [token]);

  useEffect(() => {
    if (!selectedPlayerId) { setGrowthHistory([]); return; }
    (async () => {
      try {
        const h = await api.youth.growthHistory(token, selectedPlayerId);
        setGrowthHistory(h.history || []);
      } catch { setGrowthHistory([]); }
    })();
  }, [selectedPlayerId, token]);

  async function act(fn, label) {
    setActing(label);
    try { await fn(); await load(); toast.success(label === 'gen' ? 'Prospects generated' : label === 'grow' ? 'Growth cycle complete' : 'Upgrade complete'); }
    catch (e) { setError(e.message); toast.error(e.message); }
    finally { setActing(null); }
  }

  const franchiseData = academyData?.franchise;
  const regions = academyData?.regions || [];
  const academyCost = academyUpgradeCost(franchiseData?.academy_level);
  const youthCost = youthRatingUpgradeCost(franchiseData?.youth_development_rating);

  const filteredProspects = useMemo(() => {
    let list = [...prospects];
    if (prospectRole !== 'ALL') list = list.filter((p) => p.role === prospectRole);
    if (prospectSearch.trim()) {
      const q = prospectSearch.toLowerCase();
      list = list.filter((p) => `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) || (p.country_origin||'').toLowerCase().includes(q));
    }
    return list;
  }, [prospects, prospectRole, prospectSearch]);

  const filteredClubs = useMemo(() => {
    if (!clubSearch.trim()) return globalClubs;
    const q = clubSearch.toLowerCase();
    return globalClubs.filter((c) => (c.franchise_name||'').toLowerCase().includes(q) || (c.city_name||'').toLowerCase().includes(q) || (c.country||'').toLowerCase().includes(q));
  }, [globalClubs, clubSearch]);

  const selectedProspect = useMemo(() => prospects.find((p) => p.id === selectedPlayerId) || null, [prospects, selectedPlayerId]);

  if (loading) return <div className="sq-loading"><div className="sq-spinner" /><span>Loading academy...</span></div>;

  if (isNoFranchiseError(error)) return <NoFranchiseBox />;

  return (
    <div className="ya-page">
      {error && <div className="sq-error">{error}<button type="button" onClick={() => setError('')}>×</button></div>}

      {/* ── Header ── */}
      <div className="ya-header">
        <div>
          <h2 className="ya-title">{franchiseData?.academy_name || 'Youth Academy'}</h2>
          <span className="ya-subtitle">{prospects.length} prospects &middot; {regions.length} scouting regions</span>
        </div>
      </div>

      {/* ── Stats strip ── */}
      <div className="ya-stats-strip">
        <div className="ya-stat-card">
          <span className="ya-stat-label">Academy Level</span>
          <span className="ya-stat-value">{franchiseData?.academy_level || 1}</span>
        </div>
        <div className="ya-stat-card">
          <span className="ya-stat-label">Youth Rating</span>
          <span className="ya-stat-value">{Number(franchiseData?.youth_development_rating || 0).toFixed(1)}</span>
        </div>
        <div className="ya-stat-card ya-stat-card--accent">
          <span className="ya-stat-label">Prospect Pts</span>
          <span className="ya-stat-value">{franchiseData?.prospect_points || 0}</span>
        </div>
        <div className="ya-stat-card ya-stat-card--accent">
          <span className="ya-stat-label">Growth Pts</span>
          <span className="ya-stat-value">{franchiseData?.growth_points || 0}</span>
        </div>
      </div>

      {/* ── Actions bar ── */}
      <div className="ya-actions-bar">
        <button type="button" className="sq-btn sq-btn--primary" disabled={!!acting} onClick={() => act(() => api.youth.generate(token), 'gen')}>
          {acting === 'gen' ? 'Generating...' : '🔍 Generate Prospects'}<span className="ya-cost-tag">50 PP</span>
        </button>
        <button type="button" className="sq-btn sq-btn--primary" disabled={!!acting} onClick={() => act(() => api.youth.grow(token), 'grow')}>
          {acting === 'grow' ? 'Growing...' : '📈 Growth Cycle'}<span className="ya-cost-tag">5 GP</span>
        </button>
        <button type="button" className="sq-btn" disabled={!!acting} onClick={() => act(() => api.youth.upgrade(token, 'ACADEMY_LEVEL'), 'acad')}>
          {acting === 'acad' ? 'Upgrading...' : '🏗️ Upgrade Academy'}<span className="ya-cost-tag">{academyCost} PP</span>
        </button>
        <button type="button" className="sq-btn" disabled={!!acting} onClick={() => act(() => api.youth.upgrade(token, 'YOUTH_RATING'), 'yr')}>
          {acting === 'yr' ? 'Upgrading...' : '⭐ Upgrade Youth Rating'}<span className="ya-cost-tag">{youthCost} GP</span>
        </button>
      </div>

      {/* ── Tabs ── */}
      <nav className="sq-tabs">
        <button type="button" className={`sq-tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>
          <span className="sq-tab-icon">🎓</span>Academy &amp; Regions
        </button>
        <button type="button" className={`sq-tab ${tab === 'prospects' ? 'active' : ''}`} onClick={() => setTab('prospects')}>
          <span className="sq-tab-icon">🌱</span>Prospects<span className="tm-tab-count">{prospects.length}</span>
        </button>
        <button type="button" className={`sq-tab ${tab === 'global' ? 'active' : ''}`} onClick={() => setTab('global')}>
          <span className="sq-tab-icon">🌍</span>Global Board
        </button>
      </nav>

      {/* ═══ OVERVIEW TAB ═══ */}
      {tab === 'overview' && (
        <div className="sq-tab-content">
          {/* Regions */}
          <h3 className="ya-section-title">Scouting Regions</h3>
          <div className="ya-region-grid">
            {regions.map((region) => {
              const quality = Number(region.quality_rating || 0);
              const pct = Math.min(100, quality);
              const color = quality >= 60 ? 'var(--leaf)' : quality >= 35 ? '#daa520' : 'var(--danger)';
              return (
                <div key={region.id} className="ya-region-card">
                  <div className="ya-region-header">
                    <strong className="ya-region-name">{region.name}</strong>
                    <span className="ya-region-country">{region.region_country}</span>
                  </div>
                  <div className="ya-region-quality">
                    <span className="ya-region-q-label">Quality</span>
                    <div className="ya-region-bar"><div className="ya-region-bar-fill" style={{ width: `${pct}%`, background: color }} /></div>
                    <span className="ya-region-q-val" style={{ color }}>{quality.toFixed(1)}</span>
                  </div>
                  <div className="ya-region-footer">
                    <span>🌱 {region.youth_count || 0} prospects</span>
                    <span>💰 {money(region.coaching_investment)} invested</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* How it works */}
          <div className="ya-how-it-works">
            <h3 className="ya-section-title">How It Works</h3>
            <div className="ya-how-grid">
              <div className="ya-how-card"><span className="ya-how-icon">🏆</span><strong>Match Reward</strong><span>Win: +5 PP &amp; +5 GP · Loss: +2 PP &amp; +2 GP</span></div>
              <div className="ya-how-card"><span className="ya-how-icon">🔍</span><strong>Generate Prospects</strong><span>50 PP — creates youth players from your regions</span></div>
              <div className="ya-how-card"><span className="ya-how-icon">📈</span><strong>Growth Cycle</strong><span>5 GP — boosts attributes, morale &amp; value</span></div>
              <div className="ya-how-card"><span className="ya-how-icon">🏗️</span><strong>Academy Upgrade</strong><span>10 + (Level × 5) PP — improves generation quality</span></div>
              <div className="ya-how-card"><span className="ya-how-icon">⭐</span><strong>Youth Rating</strong><span>20 + floor(Rating/10) × 5 GP — boosts growth rates</span></div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ PROSPECTS TAB ═══ */}
      {tab === 'prospects' && (
        <div className="sq-tab-content">
          <div className="tm-controls">
            <input type="text" className="sq-search" placeholder="Search by name or country..." value={prospectSearch} onChange={(e) => setProspectSearch(e.target.value)} />
            <div className="tm-filters">
              {['ALL', 'BATTER', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'].map((r) => (
                <button key={r} type="button" className={`sq-filter-btn ${prospectRole === r ? 'active' : ''}`} onClick={() => setProspectRole(r)}>
                  {r === 'ALL' ? 'All' : `${ROLE_EMOJI[r]||''} ${ROLE_SHORT[r]||r}`}
                </button>
              ))}
            </div>
          </div>

          {filteredProspects.length === 0 ? (
            <div className="sq-empty">No prospects match your filters. Generate some!</div>
          ) : (
            <div className="ya-prospect-layout">
              {/* Prospect cards */}
              <div className="ya-prospect-grid">
                {filteredProspects.map((p) => {
                  const ovr = overall(p);
                  const isSelected = p.id === selectedPlayerId;
                  return (
                    <div key={p.id} className={`ya-prospect-card ${isSelected ? 'ya-prospect-card--selected' : ''}`} onClick={() => setSelectedPlayerId(p.id)}>
                      <div className="ya-prospect-top">
                        <OvrRing value={ovr} size={34} />
                        <div className="ya-prospect-identity">
                          <strong className="ya-prospect-name">{p.first_name} {p.last_name}</strong>
                          <span className="ya-prospect-meta">{p.country_origin} &middot; Age {p.age}</span>
                        </div>
                        <span className={`sq-role-pill sq-role-pill--${(p.role||'').toLowerCase()}`}>
                          {ROLE_EMOJI[p.role]||''} {ROLE_SHORT[p.role]||p.role}
                        </span>
                      </div>
                      <div className="tm-card-stats">
                        <StatMini label="BAT" value={p.batting} />
                        <StatMini label="BWL" value={p.bowling} />
                        <StatMini label="FLD" value={p.fielding} />
                        <StatMini label="FIT" value={p.fitness} />
                        <StatMini label="TMP" value={p.temperament} />
                      </div>
                      <div className="ya-prospect-bottom">
                        <span className="ya-prospect-pot">⭐ {p.potential} POT</span>
                        {p.region_name && <span className="ya-prospect-region">📍 {p.region_name}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Detail sidebar */}
              {selectedProspect && (
                <div className="ya-detail-panel">
                  <div className="ya-detail-header">
                    <OvrRing value={overall(selectedProspect)} size={48} />
                    <div>
                      <strong className="ya-detail-name">{selectedProspect.first_name} {selectedProspect.last_name}</strong>
                      <span className="ya-detail-info">{selectedProspect.country_origin} &middot; {selectedProspect.role?.replace(/_/g, ' ')} &middot; Age {selectedProspect.age}</span>
                    </div>
                  </div>
                  <div className="ya-detail-stats">
                    <StatMini label="Batting" value={selectedProspect.batting} />
                    <StatMini label="Bowling" value={selectedProspect.bowling} />
                    <StatMini label="Fielding" value={selectedProspect.fielding} />
                    <StatMini label="Fitness" value={selectedProspect.fitness} />
                    <StatMini label="Temperament" value={selectedProspect.temperament} />
                  </div>
                  <div className="ya-detail-row"><span>Potential</span><strong>{selectedProspect.potential}</strong></div>
                  <div className="ya-detail-row"><span>Morale</span><strong>{Number(selectedProspect.morale||0).toFixed(0)}</strong></div>
                  <div className="ya-detail-row"><span>Form</span><strong>{Number(selectedProspect.form||0).toFixed(0)}</strong></div>
                  <div className="ya-detail-row"><span>Market Value</span><strong>{money(selectedProspect.market_value)}</strong></div>
                  <div className="ya-detail-growth">
                    <span className="ya-detail-growth-label">Growth Trend</span>
                    <GrowthSparkline data={growthHistory} />
                  </div>
                  {growthHistory.length > 0 && (
                    <div className="ya-growth-log">
                      {growthHistory.slice(0, 8).map((g, i) => {
                        const total = Number(g.batting_delta||0) + Number(g.bowling_delta||0) + Number(g.fielding_delta||0);
                        return (
                          <div key={i} className="ya-growth-entry">
                            <span className="ya-growth-season">{g.season_name || `#${i + 1}`}</span>
                            <span className={`ya-growth-delta ${total >= 0 ? 'ya-growth-delta--pos' : 'ya-growth-delta--neg'}`}>
                              {total >= 0 ? '+' : ''}{total.toFixed(0)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══ GLOBAL BOARD TAB ═══ */}
      {tab === 'global' && (
        <div className="sq-tab-content">
          <input type="text" className="sq-search" placeholder="Search franchises..." value={clubSearch} onChange={(e) => setClubSearch(e.target.value)} style={{ maxWidth: 320, marginBottom: '0.75rem' }} />
          <div className="ya-club-table">
            <div className="ya-club-row ya-club-row--header">
              <span className="ya-club-col ya-club-col--name">Franchise</span>
              <span className="ya-club-col">Control</span>
              <span className="ya-club-col">League</span>
              <span className="ya-club-col">Academy</span>
              <span className="ya-club-col">Youth</span>
              <span className="ya-club-col">PP</span>
              <span className="ya-club-col">GP</span>
              <span className="ya-club-col">Value</span>
            </div>
            {filteredClubs.length === 0 ? (
              <div className="sq-empty">No clubs match your search.</div>
            ) : (
              filteredClubs.map((club) => {
                const isMe = Number(club.id) === Number(franchise?.id);
                const ctrl = isMe ? 'You' : club.control_type === 'CPU' ? 'CPU' : club.status === 'FOR_SALE' ? 'Sale' : club.status === 'AVAILABLE' ? 'Open' : club.owner_username || 'User';
                return (
                  <div key={club.id} className={`ya-club-row ${isMe ? 'ya-club-row--mine' : ''}`}>
                    <span className="ya-club-col ya-club-col--name">
                      <TeamNameButton franchiseId={club.id} name={club.franchise_name} city={club.city_name} country={club.country} className="ya-team-link">
                        {club.franchise_name}
                      </TeamNameButton>
                      <span className="ya-club-sub">{club.city_name}, {club.country}</span>
                    </span>
                    <span className={`ya-club-col ya-club-ctrl ya-club-ctrl--${ctrl.toLowerCase()}`}>{ctrl}</span>
                    <span className="ya-club-col"><span className={`lg-tier-badge lg-tier-badge--${club.current_league_tier}`} style={{ width: 20, height: 20, fontSize: '0.65rem' }}>{club.current_league_tier}</span></span>
                    <span className="ya-club-col ya-club-num">{club.academy_level}</span>
                    <span className="ya-club-col ya-club-num">{Number(club.youth_development_rating||0).toFixed(1)}</span>
                    <span className="ya-club-col ya-club-num">{club.prospect_points}</span>
                    <span className="ya-club-col ya-club-num">{club.growth_points}</span>
                    <span className="ya-club-col ya-club-num">{money(club.total_valuation)}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
