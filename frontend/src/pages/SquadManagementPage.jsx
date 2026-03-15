import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import NoFranchiseBox, { isNoFranchiseError } from '../components/NoFranchiseBox';
import PlayerCard from '../components/PlayerCard';
import PlayerDetailModal from '../components/PlayerDetailModal';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { setPageTitle } from '../utils/format';

const TABS = [
  { key: 'squad', label: 'Squad', icon: '👥' },
  { key: 'lineup', label: 'Lineup Builder', icon: '📋' },
  { key: 'roster', label: 'Roster Actions', icon: '⚙️' }
];

const ROLE_ORDER = { BATTER: 0, WICKET_KEEPER: 1, ALL_ROUNDER: 2, BOWLER: 3 };

function RolePill({ role }) {
  const cls = (role || '').toLowerCase().replace(/[^a-z]/g, '-');
  return <span className={`sq-role-pill sq-role--${cls}`}>{role}</span>;
}

function StatBar({ label, value, max = 100 }) {
  const pct = Math.min(100, Math.max(0, (Number(value) / max) * 100));
  const color = pct >= 70 ? 'var(--leaf)' : pct >= 40 ? 'var(--accent)' : 'var(--danger)';
  return (
    <div className="sq-stat-bar">
      <div className="sq-stat-bar-label">
        <span>{label}</span>
        <span>{Number(value).toFixed(0)}</span>
      </div>
      <div className="sq-stat-bar-track">
        <div className="sq-stat-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function OverallRing({ value }) {
  const v = Number(value || 0);
  const pct = Math.min(100, Math.max(0, v));
  const color = pct >= 70 ? 'var(--leaf)' : pct >= 40 ? 'var(--accent)' : 'var(--danger)';
  const circumference = 2 * Math.PI * 28;
  const offset = circumference - (pct / 100) * circumference;
  return (
    <div className="sq-overall-ring">
      <svg width="68" height="68" viewBox="0 0 68 68">
        <circle cx="34" cy="34" r="28" fill="none" stroke="rgba(110,80,60,0.12)" strokeWidth="5" />
        <circle
          cx="34"
          cy="34"
          r="28"
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 34 34)"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <span className="sq-overall-ring-val">{v.toFixed(1)}</span>
    </div>
  );
}

export default function SquadManagementPage() {
  const { token } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState('squad');
  const [squadData, setSquadData] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [playerDetail, setPlayerDetail] = useState(null);
  const [selectedLineup, setSelectedLineup] = useState([]);
  const [rosterFilter, setRosterFilter] = useState('ALL');
  const [rosterSearch, setRosterSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { setPageTitle('Squad Management'); }, []);

  async function load() {
    setError('');
    try {
      const [squadResponse, lineupResponse] = await Promise.all([api.squad.get(token), api.squad.lineup(token)]);
      setSquadData(squadResponse);
      setSelectedLineup((lineupResponse.lineup || []).map((p) => Number(p.id)));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [token]);

  useEffect(() => {
    if (!selectedPlayer?.id) { setPlayerDetail(null); return; }
    (async () => {
      try { setPlayerDetail(await api.squad.playerDetail(token, selectedPlayer.id)); }
      catch { setPlayerDetail(null); }
    })();
  }, [selectedPlayer, token]);

  async function saveLineup() {
    try { await api.squad.setLineup(token, selectedLineup.slice(0, 11)); await load(); toast.success('Lineup saved'); }
    catch (e) { setError(e.message); toast.error(e.message); }
  }
  async function promote(id) {
    try { await api.squad.promote(token, id); await load(); toast.success('Player promoted'); } catch (e) { setError(e.message); toast.error(e.message); }
  }
  async function release(id) {
    try { await api.squad.release(token, id); await load(); toast.success('Player released'); } catch (e) { setError(e.message); toast.error(e.message); }
  }
  async function demote(id) {
    try { await api.squad.demote(token, id); await load(); toast.success('Player demoted'); } catch (e) { setError(e.message); toast.error(e.message); }
  }

  function toggleLineup(playerId) {
    setSelectedLineup((cur) => {
      const id = Number(playerId);
      if (cur.includes(id)) return cur.filter((v) => v !== id);
      if (cur.length >= 11) return cur;
      return [...cur, id];
    });
  }

  function moveLineupPlayer(index, direction) {
    setSelectedLineup((cur) => {
      const next = [...cur];
      const target = index + direction;
      if (index < 0 || index >= next.length || target < 0 || target >= next.length) return cur;
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  }

  const grouped = useMemo(() => {
    if (!squadData?.players) return { main: [], youth: [], other: [] };
    const sort = (arr) => [...arr].sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9));
    return {
      main: sort(squadData.players.filter((p) => p.squad_status === 'MAIN_SQUAD')),
      youth: sort(squadData.players.filter((p) => p.squad_status === 'YOUTH')),
      other: sort(squadData.players.filter((p) => !['MAIN_SQUAD', 'YOUTH'].includes(p.squad_status)))
    };
  }, [squadData]);

  const allPlayers = useMemo(() => [...grouped.main, ...grouped.youth, ...grouped.other], [grouped]);

  const playerById = useMemo(() => {
    const m = new Map();
    for (const p of squadData?.players || []) m.set(Number(p.id), p);
    return m;
  }, [squadData]);

  const orderedLineup = useMemo(
    () => selectedLineup.map((id, i) => ({ slot: i + 1, playerId: Number(id), player: playerById.get(Number(id)) })),
    [selectedLineup, playerById]
  );

  const squadStats = useMemo(() => {
    if (!allPlayers.length) return null;
    const overalls = allPlayers.map((p) => Number(p.overall || 0));
    const avg = overalls.reduce((s, v) => s + v, 0) / overalls.length;
    const batsmen = allPlayers.filter((p) => String(p.role || '').toUpperCase() === 'BATTER').length;
    const bowlers = allPlayers.filter((p) => String(p.role || '').toUpperCase() === 'BOWLER').length;
    const allRounders = allPlayers.filter((p) => String(p.role || '').toUpperCase() === 'ALL_ROUNDER').length;
    const keepers = allPlayers.filter((p) => String(p.role || '').toUpperCase() === 'WICKET_KEEPER').length;
    return { total: allPlayers.length, avg: avg.toFixed(1), batsmen, bowlers, allRounders, keepers, mainCount: grouped.main.length, youthCount: grouped.youth.length };
  }, [allPlayers, grouped]);

  const lineupSummary = useMemo(() => {
    const players = orderedLineup.map((entry) => entry.player).filter(Boolean);
    const byRole = {
      BATTER: players.filter((p) => p.role === 'BATTER').length,
      WICKET_KEEPER: players.filter((p) => p.role === 'WICKET_KEEPER').length,
      ALL_ROUNDER: players.filter((p) => p.role === 'ALL_ROUNDER').length,
      BOWLER: players.filter((p) => p.role === 'BOWLER').length
    };
    const bowlingOptions = byRole.BOWLER + byRole.ALL_ROUNDER;
    const battingCore = byRole.BATTER + byRole.WICKET_KEEPER + byRole.ALL_ROUNDER;
    const avgOverall = players.length
      ? (players.reduce((sum, p) => sum + Number(p.overall || 0), 0) / players.length).toFixed(1)
      : '0.0';
    const warnings = [];
    if (players.length > 0 && byRole.WICKET_KEEPER === 0) warnings.push('No wicket-keeper selected.');
    if (players.length > 0 && bowlingOptions < 4) warnings.push('You have fewer than 4 bowling options.');
    if (players.length > 0 && battingCore < 6) warnings.push('The batting unit looks thin.');
    return { ...byRole, bowlingOptions, battingCore, avgOverall, warnings };
  }, [orderedLineup]);

  const filteredRoster = useMemo(() => {
    let list = allPlayers;
    if (rosterFilter !== 'ALL') list = list.filter((p) => p.squad_status === rosterFilter);
    if (rosterSearch.trim()) {
      const q = rosterSearch.toLowerCase();
      list = list.filter((p) => `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) || p.role.toLowerCase().includes(q));
    }
    return list;
  }, [allPlayers, rosterFilter, rosterSearch]);

  if (loading) return <div className="sq-loading"><div className="sq-spinner" /><span>Loading squad...</span></div>;

  if (isNoFranchiseError(error)) return <NoFranchiseBox />;

  return (
    <div className="sq-page">
      {error && <div className="sq-error">{error}<button type="button" onClick={() => setError('')}>×</button></div>}

      <section className="sq-page-hero">
        <div className="sq-page-hero-copy">
          <span className="sq-page-kicker">Squad Command</span>
          <h1 className="sq-page-title">Shape the team, set the XI, control the roster.</h1>
          <p className="sq-page-sub">
            Review every player card, build a balanced match-day XI, and move players between the main squad and youth pathway without leaving this screen.
          </p>
        </div>
        <div className="sq-page-hero-meta">
          <div className="sq-page-hero-stat">
            <span>Current XI</span>
            <strong>{selectedLineup.length}/11</strong>
          </div>
          <div className="sq-page-hero-stat">
            <span>Avg OVR</span>
            <strong>{squadStats?.avg || '0.0'}</strong>
          </div>
          <div className="sq-page-hero-stat">
            <span>Ready Now</span>
            <strong>{grouped.main.length}</strong>
          </div>
        </div>
      </section>

      {/* Header stats strip */}
      {squadStats && (
        <div className="sq-header-strip">
          <div className="sq-strip-stat"><span className="sq-strip-val">{squadStats.total}</span><span className="sq-strip-label">Total</span></div>
          <div className="sq-strip-stat"><span className="sq-strip-val">{squadStats.mainCount}</span><span className="sq-strip-label">Main Squad</span></div>
          <div className="sq-strip-stat"><span className="sq-strip-val">{squadStats.youthCount}</span><span className="sq-strip-label">Youth</span></div>
          <div className="sq-strip-divider" />
          <div className="sq-strip-stat"><span className="sq-strip-val">{squadStats.avg}</span><span className="sq-strip-label">Avg Overall</span></div>
          <div className="sq-strip-stat"><span className="sq-strip-val">{squadStats.batsmen}</span><span className="sq-strip-label">Batsmen</span></div>
          <div className="sq-strip-stat"><span className="sq-strip-val">{squadStats.bowlers}</span><span className="sq-strip-label">Bowlers</span></div>
          <div className="sq-strip-stat"><span className="sq-strip-val">{squadStats.allRounders}</span><span className="sq-strip-label">All-Rounders</span></div>
          <div className="sq-strip-stat"><span className="sq-strip-val">{squadStats.keepers}</span><span className="sq-strip-label">Keepers</span></div>
        </div>
      )}

      {/* Tab navigation */}
      <nav className="sq-tabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`sq-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            <span className="sq-tab-icon">{t.icon}</span>{t.label}
          </button>
        ))}
      </nav>

      {/* ─── SQUAD TAB ─── */}
      {tab === 'squad' && (
        <div className="sq-tab-content">
          {grouped.main.length > 0 && (
            <section className="sq-section">
              <div className="sq-section-header">
                <div>
                  <h3>Main Squad</h3>
                  <p className="sq-hint">First-team players available for selection right now.</p>
                </div>
                <span className="sq-badge">{grouped.main.length}</span>
              </div>
              <div className="sq-card-grid">
                {grouped.main.map((p) => (
                  <PlayerCard key={p.id} player={p} onOpen={setSelectedPlayer} StatBar={StatBar} OverallRing={OverallRing} RolePill={RolePill} />
                ))}
              </div>
            </section>
          )}
          {grouped.youth.length > 0 && (
            <section className="sq-section">
              <div className="sq-section-header">
                <div>
                  <h3>Youth Academy</h3>
                  <p className="sq-hint">Prospects developing below the senior squad.</p>
                </div>
                <span className="sq-badge sq-badge--youth">{grouped.youth.length}</span>
              </div>
              <div className="sq-card-grid">
                {grouped.youth.map((p) => (
                  <PlayerCard key={p.id} player={p} onOpen={setSelectedPlayer} StatBar={StatBar} OverallRing={OverallRing} RolePill={RolePill} />
                ))}
              </div>
            </section>
          )}
          {grouped.other.length > 0 && (
            <section className="sq-section">
              <div className="sq-section-header">
                <div>
                  <h3>Other</h3>
                  <p className="sq-hint">Loaned, inactive, or otherwise unavailable players.</p>
                </div>
                <span className="sq-badge">{grouped.other.length}</span>
              </div>
              <div className="sq-card-grid">
                {grouped.other.map((p) => (
                  <PlayerCard key={p.id} player={p} onOpen={setSelectedPlayer} StatBar={StatBar} OverallRing={OverallRing} RolePill={RolePill} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ─── LINEUP TAB ─── */}
      {tab === 'lineup' && (
        <div className="sq-tab-content">
          <section className="sq-section">
            <div className="sq-section-header">
              <div>
                <h3>Playing XI</h3>
                <p className="sq-hint">Select exactly 11 players. Use the arrows to adjust batting order from opener to No. 11.</p>
              </div>
              <button
                className={`sq-btn sq-btn--primary ${selectedLineup.length === 11 ? '' : 'sq-btn--disabled'}`}
                type="button"
                onClick={saveLineup}
                disabled={selectedLineup.length !== 11}
              >
                Save XI ({selectedLineup.length}/11)
              </button>
            </div>

            <div className="sq-lineup-summary">
              <div className="sq-lineup-summary-grid">
                <div className="sq-lineup-summary-card">
                  <span>Avg XI OVR</span>
                  <strong>{lineupSummary.avgOverall}</strong>
                </div>
                <div className="sq-lineup-summary-card">
                  <span>Batters</span>
                  <strong>{lineupSummary.BATTER}</strong>
                </div>
                <div className="sq-lineup-summary-card">
                  <span>Keepers</span>
                  <strong>{lineupSummary.WICKET_KEEPER}</strong>
                </div>
                <div className="sq-lineup-summary-card">
                  <span>All-Rounders</span>
                  <strong>{lineupSummary.ALL_ROUNDER}</strong>
                </div>
                <div className="sq-lineup-summary-card">
                  <span>Bowlers</span>
                  <strong>{lineupSummary.BOWLER}</strong>
                </div>
                <div className="sq-lineup-summary-card">
                  <span>Bowling Options</span>
                  <strong>{lineupSummary.bowlingOptions}</strong>
                </div>
              </div>
              {lineupSummary.warnings.length > 0 && (
                <div className="sq-lineup-warnings">
                  {lineupSummary.warnings.map((warning) => (
                    <span key={warning} className="sq-lineup-warning">{warning}</span>
                  ))}
                </div>
              )}
            </div>

            {/* Selected slots */}
            <div className="sq-lineup-slots">
              {Array.from({ length: 11 }, (_, i) => {
                const entry = orderedLineup[i];
                return (
                  <div key={i} className={`sq-lineup-slot ${entry ? 'filled' : ''}`}>
                    <div className="sq-slot-num-wrap">
                      <span className="sq-slot-num">{i + 1}</span>
                      <span className="sq-slot-label">{i < 2 ? 'Open' : i < 5 ? 'Top' : i < 7 ? 'Middle' : 'Lower'}</span>
                    </div>
                    {entry?.player ? (
                      <>
                        <div className="sq-slot-info">
                          <strong>{entry.player.first_name} {entry.player.last_name}</strong>
                          <div className="sq-slot-meta">
                            <RolePill role={entry.player.role} />
                            <span>OVR {Number(entry.player.overall || 0).toFixed(1)}</span>
                          </div>
                        </div>
                        <div className="sq-slot-actions">
                          <button type="button" className="sq-slot-move" disabled={i === 0} onClick={() => moveLineupPlayer(i, -1)} aria-label="Move up">↑</button>
                          <button type="button" className="sq-slot-move" disabled={i === orderedLineup.length - 1} onClick={() => moveLineupPlayer(i, 1)} aria-label="Move down">↓</button>
                          <button type="button" className="sq-slot-remove" onClick={() => toggleLineup(entry.playerId)} aria-label="Remove from lineup">×</button>
                        </div>
                      </>
                    ) : (
                      <span className="sq-slot-empty">Tap a player below to assign this batting slot.</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Player picker */}
            <div className="sq-section-header sq-section-header--compact">
              <div>
                <h4 className="sq-picker-heading">Available Players</h4>
                <p className="sq-hint">Tap any player to add or remove them from the XI.</p>
              </div>
            </div>
            <div className="sq-picker-grid">
              {[...grouped.main, ...grouped.youth].map((p) => {
                const isIn = selectedLineup.includes(Number(p.id));
                const idx = selectedLineup.indexOf(Number(p.id));
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`sq-picker-chip ${isIn ? 'active' : ''}`}
                    onClick={() => toggleLineup(p.id)}
                  >
                    <div className="sq-picker-chip-top">
                      {isIn && <span className="sq-picker-num">#{idx + 1}</span>}
                      <span className="sq-picker-name">{p.first_name} {p.last_name}</span>
                    </div>
                    <div className="sq-picker-chip-bot">
                      <RolePill role={p.role} />
                      <span className="sq-picker-tag">{p.country_origin || p.country}</span>
                      <span className="sq-picker-ovr">{Number(p.overall || 0).toFixed(1)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* ─── ROSTER TAB ─── */}
      {tab === 'roster' && (
        <div className="sq-tab-content">
          <section className="sq-section">
            <div className="sq-section-header">
              <div>
                <h3>Roster Management</h3>
                <p className="sq-hint">Promote, demote, or release players without leaving the squad screen.</p>
              </div>
            </div>

            <div className="sq-roster-controls">
              <input className="sq-roster-search" placeholder="Search players..." value={rosterSearch} onChange={(e) => setRosterSearch(e.target.value)} />
              <div className="sq-roster-filters">
                {['ALL', 'MAIN_SQUAD', 'YOUTH'].map((f) => (
                  <button key={f} type="button" className={`sq-filter-btn ${rosterFilter === f ? 'active' : ''}`} onClick={() => setRosterFilter(f)}>
                    {f === 'ALL' ? 'All' : f === 'MAIN_SQUAD' ? 'Main Squad' : 'Youth'}
                  </button>
                ))}
              </div>
            </div>

            <div className="sq-roster-list">
              {filteredRoster.length === 0 ? (
                <div className="sq-empty">No players match your filter.</div>
              ) : (
                filteredRoster.map((p) => (
                  <div key={p.id} className="sq-roster-row">
                    <div className="sq-roster-player" role="button" tabIndex={0} onClick={() => setSelectedPlayer(p)} onKeyDown={(e) => e.key === 'Enter' && setSelectedPlayer(p)}>
                      <OverallRing value={p.overall} />
                      <div className="sq-roster-info">
                        <strong>{p.first_name} {p.last_name}</strong>
                        <div className="sq-roster-meta">
                          <RolePill role={p.role} />
                          <span className="sq-roster-status">{p.squad_status.replace('_', ' ')}</span>
                          {p.starting_xi && <span className="sq-roster-xi">XI #{p.lineup_slot || '-'}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="sq-roster-stats-mini">
                      <span>Bat <b>{p.batting}</b></span>
                      <span>Bowl <b>{p.bowling}</b></span>
                      <span>Fld <b>{p.fielding}</b></span>
                      <span>Fit <b>{p.fitness}</b></span>
                    </div>
                    <div className="sq-roster-actions">
                      {p.squad_status === 'YOUTH' && (
                        <button type="button" className="sq-btn sq-btn--sm sq-btn--promote" onClick={() => promote(p.id)}>Promote</button>
                      )}
                      {p.squad_status === 'MAIN_SQUAD' && (
                        <button type="button" className="sq-btn sq-btn--sm sq-btn--demote" onClick={() => demote(p.id)}>Demote</button>
                      )}
                      <button type="button" className="sq-btn sq-btn--sm sq-btn--danger" onClick={() => release(p.id)}>Release</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}

      <PlayerDetailModal
        open={Boolean(selectedPlayer)}
        selectedPlayer={selectedPlayer}
        playerDetail={playerDetail}
        onClose={() => { setSelectedPlayer(null); setPlayerDetail(null); }}
        StatBar={StatBar}
        OverallRing={OverallRing}
        RolePill={RolePill}
      />
    </div>
  );
}
