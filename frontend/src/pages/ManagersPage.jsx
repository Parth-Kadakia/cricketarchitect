import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import NoFranchiseBox, { isNoFranchiseError } from '../components/NoFranchiseBox';
import TeamNameButton from '../components/TeamNameButton';
import { useAuth } from '../context/AuthContext';
import { setPageTitle } from '../utils/format';

function pct(value) {
  const num = Number(value || 0);
  return `${num.toFixed(1)}%`;
}

function roleLabel(isCpu) {
  return isCpu ? 'CPU' : 'User';
}

function stageLabel(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) {
    return '-';
  }
  if (raw === 'REGULAR') {
    return 'League';
  }
  if (raw === 'PLAYOFF') {
    return 'Semis';
  }
  return raw[0] + raw.slice(1).toLowerCase();
}

function managerScore(row) {
  const wins = Number(row.wins_managed || 0);
  const losses = Number(row.losses_managed || 0);
  const matches = Math.max(1, wins + losses);
  const winPct = (wins / matches) * 100;
  return Number(
    (
      Number(row.level || 1) * 11 +
      Number(row.reputation || 0) * 0.9 +
      winPct * 0.35 +
      Number(row.titles_won || 0) * 4
    ).toFixed(2)
  );
}

export default function ManagersPage() {
  const { token, user, franchise } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedManager, setSelectedManager] = useState(null);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const mode = String(franchise?.competition_mode || user?.career_mode || 'CLUB').toUpperCase();

  useEffect(() => { setPageTitle('Managers'); }, []);

  async function loadDirectory() {
    setError('');
    try {
      const activeSeason = await api.league.activeSeason(token);
      const result = await api.manager.directory(token, {
        seasonId: activeSeason?.season?.id || null,
        mode,
        limit: 300
      });
      setRows(result.managers || []);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load managers.');
    }
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      await loadDirectory();
      if (mounted) {
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [mode, token]);

  const rankedRows = useMemo(() => {
    return [...rows]
      .map((row) => ({
        ...row,
        power_score: managerScore(row),
        wins: Number(row.wins_managed || 0),
        losses: Number(row.losses_managed || 0)
      }))
      .sort((a, b) => Number(b.power_score || 0) - Number(a.power_score || 0));
  }, [rows]);

  async function openProfile(row) {
    try {
      setError('');
      setSelectedManager(row);
      setProfileLoading(true);
      const profile = await api.manager.profile(token, row.id);
      setSelectedProfile(profile || null);
    } catch (profileError) {
      setError(profileError.message || 'Failed to load manager profile.');
      setSelectedProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }

  function closeProfile() {
    setSelectedManager(null);
    setSelectedProfile(null);
    setProfileLoading(false);
  }

  if (loading) {
    return (
      <div className="sq-loading">
        <div className="sq-spinner" />
        <span>Loading manager rankings...</span>
      </div>
    );
  }

  if (isNoFranchiseError(error)) return <NoFranchiseBox />;

  return (
    <div className="stats-page manager-page">
      {error && (
        <div className="sq-error">
          {error}
          <button type="button" onClick={() => setError('')}>
            ×
          </button>
        </div>
      )}

      <div className="stats-header">
        <div>
          <h2 className="stats-title">Manager Rankings</h2>
          <p className="stats-subtitle">
            Every team has a manager. CPU boards hire and fire through the season.
          </p>
        </div>
      </div>

      <div className="stats-table-wrap">
        <table className="stats-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Manager</th>
              <th>Team</th>
              <th>Country</th>
              <th>Type</th>
              <th>Lvl</th>
              <th>Rep</th>
              <th>W</th>
              <th>L</th>
              <th>Win%</th>
              <th>Titles</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {rankedRows.map((row, index) => {
              const matches = Math.max(1, Number(row.wins || 0) + Number(row.losses || 0));
              const winPct = (Number(row.wins || 0) / matches) * 100;
              return (
                <tr
                  key={row.id}
                  className="stats-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => openProfile(row)}
                  onKeyDown={(event) => event.key === 'Enter' && openProfile(row)}
                >
                  <td className="stats-rank">{index + 1}</td>
                  <td className="stats-name">
                    <strong>{row.display_name}</strong>
                  </td>
                  <td>
                    {row.franchise_id ? (
                      <TeamNameButton
                        franchiseId={row.franchise_id}
                        name={row.franchise_name}
                        city={row.city_name}
                        country={row.country}
                      >
                        {row.franchise_name}
                      </TeamNameButton>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td>{row.country || row.nationality || '-'}</td>
                  <td>{roleLabel(row.is_cpu)}</td>
                  <td>{row.level}</td>
                  <td>{row.reputation}</td>
                  <td>{row.wins}</td>
                  <td>{row.losses}</td>
                  <td>{pct(winPct)}</td>
                  <td>{row.titles_won}</td>
                  <td>
                    <span className="stats-rating-chip">{Number(row.power_score || 0).toFixed(1)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(selectedManager || selectedProfile) && (
        <div className="sq-modal-backdrop" role="presentation" onClick={closeProfile}>
          <section className="pd-modal manager-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="pd-close" onClick={closeProfile}>
              ×
            </button>
            {profileLoading || !selectedProfile ? (
              <div className="sq-loading" style={{ minHeight: 180 }}>
                <div className="sq-spinner" />
                <span>Loading manager profile...</span>
              </div>
            ) : (
              <>
                <div className="stats-header" style={{ marginBottom: 12 }}>
                  <div>
                    <h3 className="stats-title" style={{ marginBottom: 4 }}>
                      {selectedProfile.manager.display_name}
                    </h3>
                    <p className="stats-subtitle">
                      {selectedProfile.manager.competition_mode} • {roleLabel(selectedProfile.manager.is_cpu)} Manager
                    </p>
                  </div>
                </div>

                <div className="sb-metrics-grid">
                  <div className="stat-card">
                    <span className="stat-label">Level</span>
                    <strong className="stat-value">{selectedProfile.manager.level}</strong>
                  </div>
                  <div className="stat-card">
                    <span className="stat-label">Reputation</span>
                    <strong className="stat-value">{selectedProfile.manager.reputation}</strong>
                  </div>
                  <div className="stat-card">
                    <span className="stat-label">Matches</span>
                    <strong className="stat-value">{selectedProfile.manager.matches_managed}</strong>
                  </div>
                  <div className="stat-card">
                    <span className="stat-label">W-L</span>
                    <strong className="stat-value">
                      {selectedProfile.manager.wins_managed}-{selectedProfile.manager.losses_managed}
                    </strong>
                  </div>
                  <div className="stat-card">
                    <span className="stat-label">Titles</span>
                    <strong className="stat-value">{selectedProfile.manager.titles_won}</strong>
                  </div>
                </div>

                <div className="panel" style={{ marginTop: 10 }}>
                  <h4 style={{ marginBottom: 8 }}>Career Stints</h4>
                  <div className="stats-table-wrap">
                    <table className="stats-table">
                      <thead>
                        <tr>
                          <th>Team</th>
                          <th>Country</th>
                          <th>Mode</th>
                          <th>Season</th>
                          <th>W-L</th>
                          <th>Matches</th>
                          <th>End</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedProfile.stints.map((stint) => (
                          <tr key={stint.id}>
                            <td>
                              <TeamNameButton
                                franchiseId={stint.franchise_id}
                                name={stint.franchise_name}
                                city={stint.city_name}
                                country={stint.country}
                              >
                                {stint.franchise_name}
                              </TeamNameButton>
                            </td>
                            <td>{stint.country || '-'}</td>
                            <td>{stint.competition_mode}</td>
                            <td>{stint.season_id || '-'}</td>
                            <td>
                              {stint.wins}-{stint.losses}
                            </td>
                            <td>{stint.matches_managed}</td>
                            <td>{stint.ended_at ? String(stint.end_reason || 'ENDED') : 'Active'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="panel" style={{ marginTop: 10 }}>
                  <h4 style={{ marginBottom: 8 }}>Recent Matches</h4>
                  <div className="stats-table-wrap">
                    <table className="stats-table">
                      <thead>
                        <tr>
                          <th>Fixture</th>
                          <th>Stage</th>
                          <th>Round</th>
                          <th>Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedProfile.recentMatches.length ? (
                          selectedProfile.recentMatches.map((match) => (
                            <tr key={match.id}>
                              <td>
                                {match.home_name} vs {match.away_name}
                              </td>
                              <td>{stageLabel(match.stage)}</td>
                              <td>{match.round_no || '-'}</td>
                              <td>{match.result_summary || '-'}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={4}>No recent matches.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
