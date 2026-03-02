import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import PlayerCard from '../components/PlayerCard';
import PlayerDetailModal from '../components/PlayerDetailModal';
import { useAuth } from '../context/AuthContext';

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

  const [tab, setTab] = useState('squad');
  const [squadData, setSquadData] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [playerDetail, setPlayerDetail] = useState(null);
  const [selectedLineup, setSelectedLineup] = useState([]);
  const [rosterFilter, setRosterFilter] = useState('ALL');
  const [rosterSearch, setRosterSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

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
    try { await api.squad.setLineup(token, selectedLineup.slice(0, 11)); await load(); }
    catch (e) { setError(e.message); }
  }
  async function promote(id) {
    try { await api.squad.promote(token, id); await load(); } catch (e) { setError(e.message); }
  }
  async function release(id) {
    try { await api.squad.release(token, id); await load(); } catch (e) { setError(e.message); }
  }
  async function demote(id) {
    try { await api.squad.demote(token, id); await load(); } catch (e) { setError(e.message); }
  }

  function toggleLineup(playerId) {
    setSelectedLineup((cur) => {
      const id = Number(playerId);
      if (cur.includes(id)) return cur.filter((v) => v !== id);
      if (cur.length >= 11) return cur;
      return [...cur, id];
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

  return (
    <div className="sq-page">
      {error && <div className="sq-error">{error}<button type="button" onClick={() => setError('')}>×</button></div>}

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
                <h3>Main Squad</h3>
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
                <h3>Youth Academy</h3>
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
              <div className="sq-section-header"><h3>Other</h3><span className="sq-badge">{grouped.other.length}</span></div>
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
                <p className="sq-hint">Select exactly 11 players. Drag to reorder batting position.</p>
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

            {/* Selected slots */}
            <div className="sq-lineup-slots">
              {Array.from({ length: 11 }, (_, i) => {
                const entry = orderedLineup[i];
                return (
                  <div key={i} className={`sq-lineup-slot ${entry ? 'filled' : ''}`}>
                    <span className="sq-slot-num">{i + 1}</span>
                    {entry?.player ? (
                      <div className="sq-slot-info">
                        <strong>{entry.player.first_name} {entry.player.last_name}</strong>
                        <RolePill role={entry.player.role} />
                      </div>
                    ) : (
                      <span className="sq-slot-empty">Empty Slot</span>
                    )}
                    {entry && (
                      <button type="button" className="sq-slot-remove" onClick={() => toggleLineup(entry.playerId)}>×</button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Player picker */}
            <h4 className="sq-picker-heading">Available Players</h4>
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
              <h3>Roster Management</h3>
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
