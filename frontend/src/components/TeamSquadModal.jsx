import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import CountryLabel from './CountryLabel';
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
  const isInternational = String(franchise?.competition_mode || seed?.competition_mode || '').toUpperCase() === 'INTERNATIONAL';

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
    ? { city: franchise.city_name, country: franchise.country }
    : { city: seed?.city, country: seed?.country };
  const activeTabLabel = TABS.find((item) => item.key === tab)?.label || 'Squad';
  const keyMetrics = [
    {
      label: isInternational ? 'World Rank' : 'League',
      value: isInternational
        ? (franchise?.league_position ? `#${franchise.league_position}` : 'Unranked')
        : (franchise?.current_league_tier ? `League ${franchise.current_league_tier}` : '-')
    },
    { label: 'Record', value: `${franchise?.wins || 0}W-${franchise?.losses || 0}L` },
    {
      label: isInternational ? 'Strength' : 'Value',
      value: isInternational
        ? Number(franchise?.strength_rating ?? squad?.averageOverall ?? 0).toFixed(1)
        : money(franchise?.total_valuation)
    },
    { label: 'Academy', value: `Lv ${franchise?.academy_level || 1}` },
    { label: 'Squad OVR', value: Number(squad?.averageOverall || 0).toFixed(1) },
    { label: activeTabLabel, value: currentRows.length }
  ];

  return (
    <div className="team-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="team-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <header className="team-modal-header">
          <div className="team-modal-hero-copy">
            <span className="team-modal-kicker">{isInternational ? 'National Team Snapshot' : 'Club Snapshot'}</span>
            <h3>{isInternational ? <CountryLabel country={title} /> : title}</h3>
            {(subtitle?.city || subtitle?.country) && (
              <p>
                {subtitle?.city ? (
                  <>
                    {subtitle.city}{subtitle.country ? ', ' : ''}
                  </>
                ) : null}
                {isInternational ? <CountryLabel country={subtitle?.country} /> : subtitle?.country}
              </p>
            )}
            <div className="team-modal-hero-tags">
              <span>{franchise?.owner_name || 'CPU'} manager control</span>
              <span>{franchise?.championships || 0} titles</span>
              <span>{currentRows.length} players in view</span>
            </div>
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
              {keyMetrics.map((metric) => (
                <div key={metric.label} className="team-modal-metric-card">
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                </div>
              ))}
            </div>

            <div className="team-modal-submetrics">
              <span>Owner <strong>{franchise?.owner_name || 'CPU'}</strong></span>
              <span>Batters <strong>{squad?.roleCounts?.BATTER || 0}</strong></span>
              <span>Bowlers <strong>{squad?.roleCounts?.BOWLER || 0}</strong></span>
              <span>All-Rounders <strong>{squad?.roleCounts?.ALL_ROUNDER || 0}</strong></span>
              <span>Keepers <strong>{squad?.roleCounts?.WICKET_KEEPER || 0}</strong></span>
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
              <div className="team-modal-card-grid">
                {currentRows.map((player, index) => (
                  <button
                    key={player.id}
                    type="button"
                    className="team-modal-player-card"
                    onClick={() => setSelectedPlayer(player)}
                  >
                    <div className="team-modal-player-top">
                      <span className="team-modal-player-slot">
                        {tab === 'xi' ? `XI #${player.lineup_slot || index + 1}` : `#${index + 1}`}
                      </span>
                      <TeamRolePill role={player.role} />
                      <span className="team-modal-player-ovr">{Number(player.overall || 0).toFixed(1)}</span>
                    </div>
                    <h4 className="team-modal-player-name">{player.first_name} {player.last_name}</h4>
                    <div className="team-modal-player-meta">
                      <span>
                        {isInternational
                          ? <CountryLabel country={player.country_origin || subtitle?.country || 'Unknown Origin'} />
                          : (player.country_origin || [subtitle?.city, subtitle?.country].filter(Boolean).join(', ') || 'Unknown Origin')}
                      </span>
                      <span>Age {player.age}</span>
                      <span>{player.batsman_hand || '-'} hand</span>
                    </div>
                    <div className="team-modal-player-style">
                      {(player.batsman_type || 'Balanced')} • {(player.bowler_style || 'No bowling style')}
                    </div>
                    <div className="team-modal-player-stats">
                      <div><span>BAT</span><strong>{player.batting}</strong></div>
                      <div><span>BWL</span><strong>{player.bowling}</strong></div>
                      <div><span>FLD</span><strong>{player.fielding}</strong></div>
                      <div><span>FIT</span><strong>{player.fitness}</strong></div>
                    </div>
                    <div className="team-modal-player-footer">
                      <span>Form {Number(player.form || 0).toFixed(0)}</span>
                      <span>Morale {Number(player.morale || 0).toFixed(0)}</span>
                      <span>Pot {player.potential}</span>
                    </div>
                    <div className="team-modal-player-status">
                      {player.squad_status === 'LOANED' && player.on_loan_to_franchise_name
                        ? `Loaned to ${player.on_loan_to_franchise_name}`
                        : roleLabel(player.squad_status)}
                    </div>
                  </button>
                ))}
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
