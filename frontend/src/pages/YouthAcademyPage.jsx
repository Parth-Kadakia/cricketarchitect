import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import NoFranchiseBox, { isNoFranchiseError } from '../components/NoFranchiseBox';
import TeamNameButton from '../components/TeamNameButton';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { money, overall, setPageTitle } from '../utils/format';
import { StatMini, OvrRing } from '../utils/MiniComponents';

const academyUpgradeCost = (level) => 10 + Number(level || 1) * 5;
const youthRatingUpgradeCost = (rating) => 20 + Math.floor(Number(rating || 0) / 10) * 5;

const ROLE_EMOJI = { BATTER: '🏏', BOWLER: '🎯', ALL_ROUNDER: '⚡', WICKET_KEEPER: '🧤' };
const ROLE_SHORT = { BATTER: 'BAT', BOWLER: 'BWL', ALL_ROUNDER: 'AR', WICKET_KEEPER: 'WK' };

function GrowthSparkline({ data }) {
  if (!data || data.length < 2) return <span className="ya-spark-empty">No history</span>;
  const vals = data.map((d) => Number(d.batting_delta || 0) + Number(d.bowling_delta || 0) + Number(d.fielding_delta || 0));
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, 0);
  const range = max - min || 1;
  const w = 88;
  const h = 28;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ');
  return (
    <svg width={w} height={h} className="ya-sparkline">
      <polyline points={pts} fill="none" stroke="var(--leaf)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AcademyActionButton({ icon, title, description, cost, disabled, busy, onClick, tone = 'default' }) {
  return (
    <button type="button" className={`ya-action-card ya-action-card--${tone}`} disabled={disabled} onClick={onClick}>
      <span className="ya-action-icon">{icon}</span>
      <span className="ya-action-copy">
        <strong>{busy ? `${title}...` : title}</strong>
        <span>{description}</span>
      </span>
      <span className="ya-action-cost">{cost}</span>
    </button>
  );
}

function InfoChip({ label, value }) {
  return (
    <div className="ya-info-chip">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
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

  useEffect(() => {
    setPageTitle('Youth Academy');
  }, []);

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
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [token]);

  useEffect(() => {
    if (!selectedPlayerId) {
      setGrowthHistory([]);
      return;
    }
    (async () => {
      try {
        const h = await api.youth.growthHistory(token, selectedPlayerId);
        setGrowthHistory(h.history || []);
      } catch {
        setGrowthHistory([]);
      }
    })();
  }, [selectedPlayerId, token]);

  async function act(fn, label) {
    setActing(label);
    try {
      await fn();
      await load();
      toast.success(
        label === 'gen' ? 'Prospects generated' : label === 'grow' ? 'Growth cycle complete' : 'Upgrade complete'
      );
    } catch (e) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setActing(null);
    }
  }

  const franchiseData = academyData?.franchise;
  const regions = academyData?.regions || [];
  const academyCost = academyUpgradeCost(franchiseData?.academy_level);
  const youthCost = youthRatingUpgradeCost(franchiseData?.youth_development_rating);

  const selectedProspect = useMemo(
    () => prospects.find((p) => Number(p.id) === Number(selectedPlayerId)) || null,
    [prospects, selectedPlayerId]
  );

  const filteredProspects = useMemo(() => {
    let list = [...prospects];
    if (prospectRole !== 'ALL') list = list.filter((p) => p.role === prospectRole);
    if (prospectSearch.trim()) {
      const q = prospectSearch.toLowerCase();
      list = list.filter(
        (p) =>
          `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) ||
          (p.country_origin || '').toLowerCase().includes(q) ||
          (p.region_name || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [prospects, prospectRole, prospectSearch]);

  const filteredClubs = useMemo(() => {
    if (!clubSearch.trim()) return globalClubs;
    const q = clubSearch.toLowerCase();
    return globalClubs.filter(
      (c) =>
        (c.franchise_name || '').toLowerCase().includes(q) ||
        (c.city_name || '').toLowerCase().includes(q) ||
        (c.country || '').toLowerCase().includes(q)
    );
  }, [globalClubs, clubSearch]);

  const academySnapshot = useMemo(() => {
    const roleCounts = prospects.reduce(
      (acc, player) => {
        acc[player.role] = (acc[player.role] || 0) + 1;
        return acc;
      },
      { BATTER: 0, BOWLER: 0, ALL_ROUNDER: 0, WICKET_KEEPER: 0 }
    );

    const sortedRegions = [...regions].sort((a, b) => Number(b.quality_rating || 0) - Number(a.quality_rating || 0));
    const strongestRegion = sortedRegions[0] || null;
    const avgRegionQuality = regions.length
      ? (regions.reduce((sum, region) => sum + Number(region.quality_rating || 0), 0) / regions.length).toFixed(1)
      : '0.0';

    const bestProspect = [...prospects].sort((a, b) => {
      const potDelta = Number(b.potential || 0) - Number(a.potential || 0);
      if (potDelta !== 0) return potDelta;
      return Number(overall(b)) - Number(overall(a));
    })[0] || null;

    const leaderboard = [...globalClubs].sort((a, b) => {
      const aScore = Number(a.academy_level || 0) * 100 + Number(a.youth_development_rating || 0) * 10 + Number(a.prospect_points || 0);
      const bScore = Number(b.academy_level || 0) * 100 + Number(b.youth_development_rating || 0) * 10 + Number(b.prospect_points || 0);
      return bScore - aScore;
    });

    const myRank = leaderboard.findIndex((club) => Number(club.id) === Number(franchise?.id));
    const topClub = leaderboard[0] || null;

    const prospectValue = prospects.reduce((sum, player) => sum + Number(player.market_value || 0), 0);
    const readyForPromotion = prospects.filter((p) => Number(overall(p)) >= 58 || Number(p.potential || 0) >= 72).length;

    return {
      roleCounts,
      strongestRegion,
      avgRegionQuality,
      bestProspect,
      academyRank: myRank >= 0 ? myRank + 1 : null,
      topClub,
      prospectValue,
      readyForPromotion
    };
  }, [prospects, regions, globalClubs, franchise]);

  const globalLeaderboard = useMemo(() => {
    return [...filteredClubs]
      .sort((a, b) => {
        const aScore = Number(a.academy_level || 0) * 100 + Number(a.youth_development_rating || 0) * 10 + Number(a.prospect_points || 0);
        const bScore = Number(b.academy_level || 0) * 100 + Number(b.youth_development_rating || 0) * 10 + Number(b.prospect_points || 0);
        return bScore - aScore;
      })
      .map((club, index) => ({ ...club, boardRank: index + 1 }));
  }, [filteredClubs]);

  if (loading) return <div className="sq-loading"><div className="sq-spinner" /><span>Loading academy...</span></div>;
  if (isNoFranchiseError(error)) return <NoFranchiseBox />;

  return (
    <div className="ya-page">
      {error && <div className="sq-error">{error}<button type="button" onClick={() => setError('')}>×</button></div>}

      <section className="ya-hero">
        <div className="ya-hero-copy">
          <span className="ya-hero-kicker">Youth Academy Command</span>
          <h1 className="ya-hero-title">{franchiseData?.academy_name || 'Youth Academy'}</h1>
          <p className="ya-hero-subtitle">
            Build a pipeline that outlasts one season. Scout your regions, invest in academy quality, and shape prospects before they hit the senior squad.
          </p>
          <div className="ya-hero-chips">
            <InfoChip label="Scouting regions" value={regions.length} />
            <InfoChip
              label="Strongest zone"
              value={academySnapshot.strongestRegion ? academySnapshot.strongestRegion.name : 'None yet'}
            />
            <InfoChip label="Ready soon" value={academySnapshot.readyForPromotion} />
            <InfoChip label="Global academy rank" value={academySnapshot.academyRank ? `#${academySnapshot.academyRank}` : 'Unranked'} />
          </div>
        </div>

        <div className="ya-hero-side">
          <div className="ya-hero-metrics">
            <div className="ya-hero-metric"><span>Academy Level</span><strong>{franchiseData?.academy_level || 1}</strong></div>
            <div className="ya-hero-metric"><span>Youth Rating</span><strong>{Number(franchiseData?.youth_development_rating || 0).toFixed(1)}</strong></div>
            <div className="ya-hero-metric"><span>Prospect Points</span><strong>{franchiseData?.prospect_points || 0}</strong></div>
            <div className="ya-hero-metric"><span>Growth Points</span><strong>{franchiseData?.growth_points || 0}</strong></div>
          </div>

          <div className="ya-action-grid">
            <AcademyActionButton
              icon="🔍"
              title="Generate Prospects"
              description="Open the next intake from your three regional pipelines."
              cost="50 PP"
              disabled={!!acting}
              busy={acting === 'gen'}
              onClick={() => act(() => api.youth.generate(token), 'gen')}
              tone="primary"
            />
            <AcademyActionButton
              icon="📈"
              title="Run Growth Cycle"
              description="Apply your development cycle and push attributes upward."
              cost="5 GP"
              disabled={!!acting}
              busy={acting === 'grow'}
              onClick={() => act(() => api.youth.grow(token), 'grow')}
              tone="leaf"
            />
            <AcademyActionButton
              icon="🏗️"
              title="Upgrade Academy"
              description="Raise intake floor and improve the quality of future classes."
              cost={`${academyCost} PP`}
              disabled={!!acting}
              busy={acting === 'acad'}
              onClick={() => act(() => api.youth.upgrade(token, 'ACADEMY_LEVEL'), 'acad')}
            />
            <AcademyActionButton
              icon="⭐"
              title="Upgrade Youth Rating"
              description="Increase player development returns across future cycles."
              cost={`${youthCost} GP`}
              disabled={!!acting}
              busy={acting === 'yr'}
              onClick={() => act(() => api.youth.upgrade(token, 'YOUTH_RATING'), 'yr')}
            />
          </div>
        </div>
      </section>

      <nav className="sq-tabs ya-tabs">
        <button type="button" className={`sq-tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>
          <span className="sq-tab-icon">🎓</span>Academy Overview
        </button>
        <button type="button" className={`sq-tab ${tab === 'prospects' ? 'active' : ''}`} onClick={() => setTab('prospects')}>
          <span className="sq-tab-icon">🌱</span>Prospect Lab<span className="tm-tab-count">{prospects.length}</span>
        </button>
        <button type="button" className={`sq-tab ${tab === 'global' ? 'active' : ''}`} onClick={() => setTab('global')}>
          <span className="sq-tab-icon">🌍</span>Global Benchmarking
        </button>
      </nav>

      {tab === 'overview' && (
        <div className="sq-tab-content ya-tab-shell">
          <div className="ya-overview-grid">
            <section className="ya-panel ya-panel--command">
              <div className="ya-panel-head">
                <div>
                  <span className="ya-panel-kicker">Pipeline Status</span>
                  <h3>Academy snapshot</h3>
                </div>
                <span className="ya-panel-badge">Live</span>
              </div>
              <div className="ya-snapshot-grid">
                <div className="ya-snapshot-card">
                  <span>Best prospect</span>
                  <strong>
                    {academySnapshot.bestProspect ? `${academySnapshot.bestProspect.first_name} ${academySnapshot.bestProspect.last_name}` : 'No prospects yet'}
                  </strong>
                  <small>
                    {academySnapshot.bestProspect
                      ? `${academySnapshot.bestProspect.potential} POT • ${overall(academySnapshot.bestProspect)} OVR`
                      : 'Generate a class to start the pipeline.'}
                  </small>
                </div>
                <div className="ya-snapshot-card">
                  <span>Average region quality</span>
                  <strong>{academySnapshot.avgRegionQuality}</strong>
                  <small>{regions.length ? 'Across your full scouting network.' : 'No scouting regions found.'}</small>
                </div>
                <div className="ya-snapshot-card">
                  <span>Prospect market value</span>
                  <strong>{money(academySnapshot.prospectValue)}</strong>
                  <small>Combined market estimate for your active youth group.</small>
                </div>
              </div>
              <div className="ya-role-bands">
                {['BATTER', 'WICKET_KEEPER', 'ALL_ROUNDER', 'BOWLER'].map((role) => (
                  <div key={role} className="ya-role-band">
                    <span>{ROLE_EMOJI[role]} {role.replace('_', ' ')}</span>
                    <strong>{academySnapshot.roleCounts[role] || 0}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="ya-panel ya-panel--resource">
              <div className="ya-panel-head">
                <div>
                  <span className="ya-panel-kicker">Resource Loop</span>
                  <h3>How this academy grows</h3>
                </div>
              </div>
              <div className="ya-flow-list">
                <div className="ya-flow-step">
                  <span className="ya-flow-icon">🏆</span>
                  <div>
                    <strong>Match results feed the system</strong>
                    <p>Wins currently return +5 prospect points and +5 growth points. Losses still trickle in +2 / +2.</p>
                  </div>
                </div>
                <div className="ya-flow-step">
                  <span className="ya-flow-icon">🔍</span>
                  <div>
                    <strong>Prospect generation is expensive by design</strong>
                    <p>Spend 50 PP only when you want a real intake, not random clutter.</p>
                  </div>
                </div>
                <div className="ya-flow-step">
                  <span className="ya-flow-icon">📈</span>
                  <div>
                    <strong>Growth points improve existing players</strong>
                    <p>Use GP on development cycles and youth rating once you have talent worth nurturing.</p>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <section className="ya-panel">
            <div className="ya-panel-head">
              <div>
                <span className="ya-panel-kicker">Regional Network</span>
                <h3>Scouting regions</h3>
              </div>
              <span className="ya-panel-note">Three local zones drive intake quality every season.</span>
            </div>
            <div className="ya-region-grid ya-region-grid--rich">
              {regions.map((region) => {
                const quality = Number(region.quality_rating || 0);
                const pct = Math.min(100, quality);
                const color = quality >= 60 ? 'var(--leaf)' : quality >= 35 ? 'var(--accent)' : 'var(--danger)';
                return (
                  <article key={region.id} className="ya-region-card ya-region-card--rich">
                    <div className="ya-region-top">
                      <div>
                        <strong className="ya-region-name">{region.name}</strong>
                        <span className="ya-region-country">{region.region_country}</span>
                      </div>
                      <span className="ya-region-score" style={{ color }}>{quality.toFixed(1)}</span>
                    </div>
                    <div className="ya-region-meter">
                      <div className="ya-region-bar"><div className="ya-region-bar-fill" style={{ width: `${pct}%`, background: color }} /></div>
                    </div>
                    <div className="ya-region-kpis">
                      <div><span>Prospects</span><strong>{region.youth_count || 0}</strong></div>
                      <div><span>Investment</span><strong>{money(region.coaching_investment)}</strong></div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {tab === 'prospects' && (
        <div className="sq-tab-content ya-tab-shell">
          <div className="ya-lab-layout">
            <aside className="ya-lab-side">
              <div className="ya-panel ya-panel--detail">
                <div className="ya-panel-head">
                  <div>
                    <span className="ya-panel-kicker">Prospect Lab</span>
                    <h3>{selectedProspect ? 'Selected prospect' : 'No prospect selected'}</h3>
                  </div>
                </div>
                {selectedProspect ? (
                  <>
                    <div className="ya-detail-header">
                      <OvrRing value={overall(selectedProspect)} size={60} />
                      <div>
                        <strong className="ya-detail-name">{selectedProspect.first_name} {selectedProspect.last_name}</strong>
                        <span className="ya-detail-info">
                          {selectedProspect.country_origin} • {selectedProspect.role?.replace(/_/g, ' ')} • Age {selectedProspect.age}
                        </span>
                      </div>
                    </div>
                    <div className="ya-detail-stats ya-detail-stats--grid">
                      <StatMini label="Batting" value={selectedProspect.batting} />
                      <StatMini label="Bowling" value={selectedProspect.bowling} />
                      <StatMini label="Fielding" value={selectedProspect.fielding} />
                      <StatMini label="Fitness" value={selectedProspect.fitness} />
                      <StatMini label="Temperament" value={selectedProspect.temperament} />
                    </div>
                    <div className="ya-detail-rows">
                      <div className="ya-detail-row"><span>Potential</span><strong>{selectedProspect.potential}</strong></div>
                      <div className="ya-detail-row"><span>Morale</span><strong>{Number(selectedProspect.morale || 0).toFixed(0)}</strong></div>
                      <div className="ya-detail-row"><span>Form</span><strong>{Number(selectedProspect.form || 0).toFixed(0)}</strong></div>
                      <div className="ya-detail-row"><span>Market Value</span><strong>{money(selectedProspect.market_value)}</strong></div>
                      <div className="ya-detail-row"><span>Region</span><strong>{selectedProspect.region_name || 'Unassigned'}</strong></div>
                    </div>
                    <div className="ya-detail-growth">
                      <span className="ya-detail-growth-label">Growth trend</span>
                      <GrowthSparkline data={growthHistory} />
                    </div>
                    {growthHistory.length > 0 && (
                      <div className="ya-growth-log">
                        {growthHistory.slice(0, 8).map((g, i) => {
                          const total = Number(g.batting_delta || 0) + Number(g.bowling_delta || 0) + Number(g.fielding_delta || 0);
                          return (
                            <div key={i} className="ya-growth-entry">
                              <span className="ya-growth-season">{g.season_name || `Cycle ${i + 1}`}</span>
                              <span className={`ya-growth-delta ${total >= 0 ? 'ya-growth-delta--pos' : 'ya-growth-delta--neg'}`}>
                                {total >= 0 ? '+' : ''}{total.toFixed(0)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="sq-empty">Generate or select a prospect to inspect their development profile.</div>
                )}
              </div>
            </aside>

            <div className="ya-lab-main">
              <section className="ya-panel">
                <div className="ya-panel-head">
                  <div>
                    <span className="ya-panel-kicker">Prospect Pool</span>
                    <h3>Scout board</h3>
                  </div>
                  <span className="ya-panel-note">Filter by role, country, or region to review your current class.</span>
                </div>
                <div className="tm-controls ya-lab-controls">
                  <input
                    type="text"
                    className="sq-search"
                    placeholder="Search by name, country, or region..."
                    value={prospectSearch}
                    onChange={(e) => setProspectSearch(e.target.value)}
                  />
                  <div className="tm-filters">
                    {['ALL', 'BATTER', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'].map((role) => (
                      <button
                        key={role}
                        type="button"
                        className={`sq-filter-btn ${prospectRole === role ? 'active' : ''}`}
                        onClick={() => setProspectRole(role)}
                      >
                        {role === 'ALL' ? 'All roles' : `${ROLE_EMOJI[role] || ''} ${ROLE_SHORT[role] || role}`}
                      </button>
                    ))}
                  </div>
                </div>

                {filteredProspects.length === 0 ? (
                  <div className="sq-empty">No prospects match those filters. Reset or generate a new class.</div>
                ) : (
                  <div className="ya-prospect-grid ya-prospect-grid--wide">
                    {filteredProspects.map((player) => {
                      const playerOverall = Number(overall(player));
                      const isSelected = Number(player.id) === Number(selectedPlayerId);
                      return (
                        <button
                          key={player.id}
                          type="button"
                          className={`ya-prospect-card ya-prospect-card--wide ${isSelected ? 'ya-prospect-card--selected' : ''}`}
                          onClick={() => setSelectedPlayerId(player.id)}
                        >
                          <div className="ya-prospect-top">
                            <div className="ya-prospect-ring-wrap">
                              <OvrRing value={playerOverall} size={42} />
                            </div>
                            <div className="ya-prospect-identity">
                              <strong className="ya-prospect-name">{player.first_name} {player.last_name}</strong>
                              <span className="ya-prospect-meta">{player.country_origin} • Age {player.age} • {player.region_name || 'Unknown region'}</span>
                            </div>
                            <span className={`sq-role-pill sq-role-pill--${(player.role || '').toLowerCase()}`}>
                              {ROLE_EMOJI[player.role] || ''} {ROLE_SHORT[player.role] || player.role}
                            </span>
                          </div>
                          <div className="ya-prospect-statline">
                            <StatMini label="BAT" value={player.batting} />
                            <StatMini label="BWL" value={player.bowling} />
                            <StatMini label="FLD" value={player.fielding} />
                            <StatMini label="FIT" value={player.fitness} />
                          </div>
                          <div className="ya-prospect-bottom">
                            <span className="ya-prospect-pot">Potential <strong>{player.potential}</strong></span>
                            <span className="ya-prospect-region">Value {money(player.market_value)}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}

      {tab === 'global' && (
        <div className="sq-tab-content ya-tab-shell">
          <div className="ya-overview-grid ya-overview-grid--benchmark">
            <section className="ya-panel">
              <div className="ya-panel-head">
                <div>
                  <span className="ya-panel-kicker">Benchmarking</span>
                  <h3>Your academy position</h3>
                </div>
              </div>
              <div className="ya-benchmark-grid">
                <div className="ya-benchmark-card">
                  <span>Your rank</span>
                  <strong>{academySnapshot.academyRank ? `#${academySnapshot.academyRank}` : '—'}</strong>
                  <small>Combined academy, youth rating, and prospect point profile.</small>
                </div>
                <div className="ya-benchmark-card">
                  <span>Best academy in world</span>
                  <strong>{academySnapshot.topClub?.franchise_name || '—'}</strong>
                  <small>
                    {academySnapshot.topClub ? `${academySnapshot.topClub.city_name}, ${academySnapshot.topClub.country}` : 'No comparison data yet.'}
                  </small>
                </div>
              </div>
            </section>

            <section className="ya-panel ya-panel--resource">
              <div className="ya-panel-head">
                <div>
                  <span className="ya-panel-kicker">Search</span>
                  <h3>Scan the global board</h3>
                </div>
              </div>
              <input
                type="text"
                className="sq-search ya-global-search"
                placeholder="Search franchises, cities, or countries..."
                value={clubSearch}
                onChange={(e) => setClubSearch(e.target.value)}
              />
              <p className="ya-global-note">Use this board to compare how aggressively other clubs are building their pipeline.</p>
            </section>
          </div>

          <section className="ya-board-grid">
            {globalLeaderboard.length === 0 ? (
              <div className="sq-empty">No clubs match your search.</div>
            ) : (
              globalLeaderboard.map((club) => {
                const isMe = Number(club.id) === Number(franchise?.id);
                const ctrl = isMe
                  ? 'You'
                  : club.control_type === 'CPU'
                    ? 'CPU'
                    : club.status === 'FOR_SALE'
                      ? 'Sale'
                      : club.status === 'AVAILABLE'
                        ? 'Open'
                        : club.owner_username || 'User';

                return (
                  <article key={club.id} className={`ya-board-card ${isMe ? 'ya-board-card--mine' : ''}`}>
                    <div className="ya-board-head">
                      <div>
                        <span className="ya-board-rank">#{club.boardRank}</span>
                        <TeamNameButton franchiseId={club.id} name={club.franchise_name} city={club.city_name} country={club.country} className="ya-team-link ya-team-link--card">
                          {club.franchise_name}
                        </TeamNameButton>
                        <span className="ya-club-sub">{club.city_name}, {club.country}</span>
                      </div>
                      <span className={`ya-club-ctrl ya-club-ctrl--${String(ctrl).toLowerCase()}`}>{ctrl}</span>
                    </div>
                    <div className="ya-board-metrics">
                      <div><span>Academy</span><strong>Lv {club.academy_level}</strong></div>
                      <div><span>Youth</span><strong>{Number(club.youth_development_rating || 0).toFixed(1)}</strong></div>
                      <div><span>PP</span><strong>{club.prospect_points}</strong></div>
                      <div><span>GP</span><strong>{club.growth_points}</strong></div>
                      <div><span>Value</span><strong>{money(club.total_valuation)}</strong></div>
                      <div><span>League</span><strong>L{club.current_league_tier}</strong></div>
                    </div>
                  </article>
                );
              })
            )}
          </section>
        </div>
      )}
    </div>
  );
}
