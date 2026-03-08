import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import PlayerDetailModal from '../components/PlayerDetailModal';
import { setPageTitle } from '../utils/format';

/* ── tiny helpers ── */
function fmt(v) { return v == null ? '-' : Number(v).toLocaleString(); }
function fmtDec(v, d = 2) { return v == null ? '-' : Number(v).toFixed(d); }
function bowlOvers(balls) {
  const b = Number(balls || 0);
  return b > 0 ? `${Math.floor(b / 6)}.${b % 6}` : '0.0';
}

const RANK_TABS = [
  { key: 'batting', label: '🏏 Top Batsmen' },
  { key: 'bowling', label: '🎳 Top Bowlers' },
  { key: 'allRounders', label: '⚡ All-Rounders' }
];

export default function StatsPage() {
  const { token } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('batting');
  const [seasonId, setSeasonId] = useState('');

  /* player detail modal */
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [playerDetail, setPlayerDetail] = useState(null);

  useEffect(() => { setPageTitle('Stats'); }, []);

  async function loadStats(sid) {
    setLoading(true);
    setError('');
    try {
      const result = await api.league.allStats(sid || null);
      setData(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadStats(seasonId); }, [seasonId]);

  /* load player detail on click */
  useEffect(() => {
    if (!selectedPlayer?.player_id || !token) {
      setPlayerDetail(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const detail = await api.squad.playerDetail(token, selectedPlayer.player_id);
        if (!cancelled) setPlayerDetail(detail);
      } catch {
        if (!cancelled) setPlayerDetail(null);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedPlayer, token]);

  const seasons = data?.seasons || [];
  const batting = data?.batting || [];
  const bowling = data?.bowling || [];
  const allRounders = data?.allRounders || [];

  const currentList = tab === 'batting' ? batting : tab === 'bowling' ? bowling : allRounders;

  function openPlayer(row) {
    setSelectedPlayer(row);
  }

  if (loading) return <div className="sq-loading"><div className="sq-spinner" /><span>Loading rankings...</span></div>;

  return (
    <div className="stats-page">
      {error && <div className="sq-error">{error}<button type="button" onClick={() => setError('')}>×</button></div>}

      {/* ── Header ── */}
      <div className="stats-header">
        <div>
          <h2 className="stats-title">Player Rankings</h2>
          <p className="stats-subtitle">Top 100 across all teams and leagues</p>
        </div>
        <div className="stats-season-filter">
          <label htmlFor="stats-season-select">Season</label>
          <select
            id="stats-season-select"
            className="stats-select"
            value={seasonId}
            onChange={(e) => setSeasonId(e.target.value)}
          >
            <option value="">All Time</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>{s.name} {s.status === 'ACTIVE' ? '(current)' : ''}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <nav className="stats-tabs">
        {RANK_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`stats-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* ── Table ── */}
      {currentList.length === 0 ? (
        <div className="sq-empty" style={{ marginTop: '1rem' }}>No data available for this category yet.</div>
      ) : (
        <div className="stats-table-wrap">
          {tab === 'batting' && (
            <table className="stats-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>Team</th>
                  <th>Role</th>
                  <th>Age</th>
                  <th>Mat</th>
                  <th>Inn</th>
                  <th>Runs</th>
                  <th>Balls</th>
                  <th>Avg</th>
                  <th>SR</th>
                  <th>HS</th>
                  <th>4s</th>
                  <th>6s</th>
                  <th>NO</th>
                  <th>Rating</th>
                </tr>
              </thead>
              <tbody>
                {batting.map((row, i) => (
                  <tr key={row.player_id} className="stats-row" role="button" tabIndex={0} onClick={() => openPlayer(row)} onKeyDown={(e) => e.key === 'Enter' && openPlayer(row)}>
                    <td className="stats-rank">{i + 1}</td>
                    <td className="stats-name"><strong>{row.first_name} {row.last_name}</strong></td>
                    <td className="stats-team">{row.franchise_name}</td>
                    <td>{String(row.role || '').replace(/_/g, ' ')}</td>
                    <td>{row.age}</td>
                    <td>{row.matches}</td>
                    <td>{row.innings}</td>
                    <td><b>{fmt(row.runs)}</b></td>
                    <td>{fmt(row.balls)}</td>
                    <td>{fmtDec(row.average)}</td>
                    <td>{fmtDec(row.strike_rate, 1)}</td>
                    <td>{row.highest_score}</td>
                    <td>{row.fours}</td>
                    <td>{row.sixes}</td>
                    <td>{row.not_outs}</td>
                    <td><span className="stats-rating-chip" style={{ background: ratingColor(row.avg_rating) }}>{fmtDec(row.avg_rating, 1)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'bowling' && (
            <table className="stats-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>Team</th>
                  <th>Role</th>
                  <th>Age</th>
                  <th>Mat</th>
                  <th>O</th>
                  <th>Runs</th>
                  <th>Wkts</th>
                  <th>Avg</th>
                  <th>Econ</th>
                  <th>BW</th>
                  <th>Mdn</th>
                  <th>Rating</th>
                </tr>
              </thead>
              <tbody>
                {bowling.map((row, i) => (
                  <tr key={row.player_id} className="stats-row" role="button" tabIndex={0} onClick={() => openPlayer(row)} onKeyDown={(e) => e.key === 'Enter' && openPlayer(row)}>
                    <td className="stats-rank">{i + 1}</td>
                    <td className="stats-name"><strong>{row.first_name} {row.last_name}</strong></td>
                    <td className="stats-team">{row.franchise_name}</td>
                    <td>{String(row.role || '').replace(/_/g, ' ')}</td>
                    <td>{row.age}</td>
                    <td>{row.matches}</td>
                    <td>{bowlOvers(row.bowling_balls)}</td>
                    <td>{fmt(row.runs_conceded)}</td>
                    <td><b>{fmt(row.wickets)}</b></td>
                    <td>{fmtDec(row.average)}</td>
                    <td>{fmtDec(row.economy)}</td>
                    <td>{row.best_wickets}</td>
                    <td>{row.maidens}</td>
                    <td><span className="stats-rating-chip" style={{ background: ratingColor(row.avg_rating) }}>{fmtDec(row.avg_rating, 1)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'allRounders' && (
            <table className="stats-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>Team</th>
                  <th>Role</th>
                  <th>Age</th>
                  <th>Mat</th>
                  <th>Runs</th>
                  <th>SR</th>
                  <th>Wkts</th>
                  <th>Econ</th>
                  <th>Ct</th>
                  <th>Rating</th>
                </tr>
              </thead>
              <tbody>
                {allRounders.map((row, i) => (
                  <tr key={row.player_id} className="stats-row" role="button" tabIndex={0} onClick={() => openPlayer(row)} onKeyDown={(e) => e.key === 'Enter' && openPlayer(row)}>
                    <td className="stats-rank">{i + 1}</td>
                    <td className="stats-name"><strong>{row.first_name} {row.last_name}</strong></td>
                    <td className="stats-team">{row.franchise_name}</td>
                    <td>{String(row.role || '').replace(/_/g, ' ')}</td>
                    <td>{row.age}</td>
                    <td>{row.matches}</td>
                    <td><b>{fmt(row.runs)}</b></td>
                    <td>{fmtDec(row.strike_rate, 1)}</td>
                    <td><b>{fmt(row.wickets)}</b></td>
                    <td>{fmtDec(row.economy)}</td>
                    <td>{row.catches}</td>
                    <td><span className="stats-rating-chip" style={{ background: ratingColor(row.avg_rating) }}>{fmtDec(row.avg_rating, 1)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Player detail modal */}
      <PlayerDetailModal
        open={Boolean(selectedPlayer)}
        selectedPlayer={selectedPlayer ? { id: selectedPlayer.player_id, first_name: selectedPlayer.first_name, last_name: selectedPlayer.last_name } : null}
        playerDetail={playerDetail}
        onClose={() => { setSelectedPlayer(null); setPlayerDetail(null); }}
        StatBar={MiniStatBar}
        OverallRing={MiniOverallRing}
        RolePill={MiniRolePill}
      />
    </div>
  );
}

/* ── Rating color helper ── */
function ratingColor(r) {
  const v = Number(r);
  if (v >= 80) return 'var(--leaf)';
  if (v >= 50) return 'var(--accent)';
  return 'var(--danger)';
}

/* ── Inline helper components for PlayerDetailModal ── */
function MiniStatBar({ label, value }) {
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

function MiniOverallRing({ value }) {
  const v = Number(value || 0).toFixed(1);
  const col = v >= 70 ? 'var(--leaf)' : v >= 40 ? 'var(--accent)' : 'var(--danger)';
  return (
    <div className="sq-overall-ring" style={{ '--ring-color': col }}>
      <span>{v}</span>
    </div>
  );
}

function MiniRolePill({ role }) {
  return <span className="sq-role-pill">{String(role || '').replace(/_/g, ' ')}</span>;
}
