import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import PlayerDetailModal from './PlayerDetailModal';

const TABS = [
  { key: 'xi', label: 'Playing XI' },
  { key: 'main', label: 'Main Squad' },
  { key: 'youth', label: 'Youth' },
  { key: 'loaned', label: 'Loaned Out' }
];

function roleLabel(role) {
  return String(role || '').replace(/_/g, ' ');
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

export default function TeamSquadModal({ open, franchiseId, seed, onClose }) {
  const { token } = useAuth();

  const [teamData, setTeamData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('xi');
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [playerDetail, setPlayerDetail] = useState(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !franchiseId || !token) {
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');

      try {
        const response = await api.squad.franchise(token, franchiseId);
        if (!cancelled) {
          setTeamData(response);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message);
          setTeamData(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [open, franchiseId, token]);

  useEffect(() => {
    if (!open) {
      setTab('xi');
      setSelectedPlayer(null);
      setPlayerDetail(null);
    }
  }, [open]);

  /* Load player detail when a player row is clicked */
  useEffect(() => {
    if (!selectedPlayer?.id || !token) {
      setPlayerDetail(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const detail = await api.squad.playerDetail(token, selectedPlayer.id);
        if (!cancelled) setPlayerDetail(detail);
      } catch {
        if (!cancelled) setPlayerDetail(null);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedPlayer, token]);

  const franchise = teamData?.franchise || null;
  const squad = teamData?.squad || null;

  const currentRows = useMemo(() => {
    if (!squad) {
      return [];
    }
    if (tab === 'xi') {
      return squad.lineup || [];
    }
    if (tab === 'main') {
      return squad.mainSquad || [];
    }
    if (tab === 'youth') {
      return squad.youth || [];
    }
    if (tab === 'loaned') {
      return squad.loanedOut || [];
    }
    return [];
  }, [squad, tab]);

  if (!open) {
    return null;
  }

  const title = franchise?.franchise_name || seed?.name || 'Team Squad';
  const subtitle = franchise?.city_name
    ? `${franchise.city_name}, ${franchise.country}`
    : [seed?.city, seed?.country].filter(Boolean).join(', ');

  return (
    <div className="team-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="team-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <header className="team-modal-header">
          <div>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="team-modal-close" onClick={onClose}>
            ×
          </button>
        </header>

        {loading ? (
          <div className="sq-loading" style={{ padding: '2rem 0.8rem' }}>
            <div className="sq-spinner" />
            <span>Loading squad...</span>
          </div>
        ) : error ? (
          <div className="sq-error" style={{ margin: '0.5rem 0' }}>
            {error}
          </div>
        ) : (
          <>
            <div className="team-modal-metrics">
              <div>
                <span>League</span>
                <strong>{franchise?.current_league_tier ? `League ${franchise.current_league_tier}` : '-'}</strong>
              </div>
              <div>
                <span>Record</span>
                <strong>{franchise?.wins || 0}W-{franchise?.losses || 0}L</strong>
              </div>
              <div>
                <span>Points</span>
                <strong>{franchise?.points ?? 0}</strong>
              </div>
              <div>
                <span>Value</span>
                <strong>{money(franchise?.total_valuation)}</strong>
              </div>
              <div>
                <span>Academy</span>
                <strong>Lv {franchise?.academy_level || 1}</strong>
              </div>
              <div>
                <span>Squad OVR</span>
                <strong>{Number(squad?.averageOverall || 0).toFixed(1)}</strong>
              </div>
            </div>

            <div className="team-modal-submetrics">
              <span>Owner: <strong>{franchise?.owner_name || 'CPU'}</strong></span>
              <span>Batters: <strong>{squad?.roleCounts?.BATTER || 0}</strong></span>
              <span>Bowlers: <strong>{squad?.roleCounts?.BOWLER || 0}</strong></span>
              <span>All-Rounders: <strong>{squad?.roleCounts?.ALL_ROUNDER || 0}</strong></span>
              <span>Keepers: <strong>{squad?.roleCounts?.WICKET_KEEPER || 0}</strong></span>
            </div>

            <nav className="team-modal-tabs">
              {TABS.map((item) => {
                const count =
                  item.key === 'xi'
                    ? squad?.lineup?.length || 0
                    : item.key === 'main'
                      ? squad?.mainSquad?.length || 0
                      : item.key === 'youth'
                        ? squad?.youth?.length || 0
                        : squad?.loanedOut?.length || 0;

                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`team-modal-tab ${tab === item.key ? 'active' : ''}`}
                    onClick={() => setTab(item.key)}
                  >
                    {item.label}
                    <span>{count}</span>
                  </button>
                );
              })}
            </nav>

            {currentRows.length === 0 ? (
              <div className="sq-empty" style={{ marginTop: '0.6rem' }}>
                No players available in this group.
              </div>
            ) : (
              <div className="team-modal-table-wrap">
                <table className="team-modal-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Player</th>
                      <th>Role</th>
                      <th>Age</th>
                      <th>OVR</th>
                      <th>BAT</th>
                      <th>BWL</th>
                      <th>FLD</th>
                      <th>FIT</th>
                      <th>POT</th>
                      <th>Form</th>
                      <th>Morale</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentRows.map((player, index) => (
                      <tr
                        key={player.id}
                        className="team-modal-row-clickable"
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedPlayer(player)}
                        onKeyDown={(e) => e.key === 'Enter' && setSelectedPlayer(player)}
                      >
                        <td>{player.lineup_slot || index + 1}</td>
                        <td>
                          <strong className="team-modal-player-link">{player.first_name} {player.last_name}</strong>
                          <div className="team-modal-player-sub">{player.country_origin}</div>
                          <div className="team-modal-player-sub">
                            {(player.batsman_hand || '-')} • {(player.batsman_type || '-')} • {(player.bowler_style || '-')}
                          </div>
                        </td>
                        <td>{roleLabel(player.role)}</td>
                        <td>{player.age}</td>
                        <td><strong>{Number(player.overall || 0).toFixed(1)}</strong></td>
                        <td>{player.batting}</td>
                        <td>{player.bowling}</td>
                        <td>{player.fielding}</td>
                        <td>{player.fitness}</td>
                        <td>{player.potential}</td>
                        <td>{Number(player.form || 0).toFixed(0)}</td>
                        <td>{Number(player.morale || 0).toFixed(0)}</td>
                        <td>
                          {player.squad_status === 'LOANED' && player.on_loan_to_franchise_name
                            ? `LOANED (${player.on_loan_to_franchise_name})`
                            : player.squad_status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      {/* Player detail modal (nested) */}
      <PlayerDetailModal
        open={Boolean(selectedPlayer)}
        selectedPlayer={selectedPlayer}
        playerDetail={playerDetail}
        onClose={() => { setSelectedPlayer(null); setPlayerDetail(null); }}
        StatBar={TeamStatBar}
        OverallRing={TeamOverallRing}
        RolePill={TeamRolePill}
      />
    </div>
  );
}

/* ── Inline helper components for PlayerDetailModal ── */
function TeamStatBar({ label, value }) {
  const v = Number(value || 0);
  const pct = Math.min(100, (v / 100) * 100);
  const col = v >= 70 ? 'var(--leaf)' : v >= 40 ? 'var(--accent)' : 'var(--danger)';
  return (
    <div className="sq-stat-bar">
      <div className="sq-stat-bar-header"><span>{label}</span><span style={{ color: col, fontWeight: 700 }}>{v}</span></div>
      <div className="sq-stat-bar-track"><div className="sq-stat-bar-fill" style={{ width: `${pct}%`, background: col }} /></div>
    </div>
  );
}

function TeamOverallRing({ value }) {
  const v = Number(value || 0).toFixed(1);
  const col = v >= 70 ? 'var(--leaf)' : v >= 40 ? 'var(--accent)' : 'var(--danger)';
  return (
    <div className="sq-overall-ring" style={{ '--ring-color': col }}>
      <span>{v}</span>
    </div>
  );
}

function TeamRolePill({ role }) {
  return <span className="sq-role-pill">{String(role || '').replace(/_/g, ' ')}</span>;
}
