import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import TeamNameButton from '../components/TeamNameButton';
import { useSocket } from '../context/SocketContext';

function oversFromBalls(balls) {
  const complete = Math.floor(Number(balls || 0) / 6);
  const rem = Number(balls || 0) % 6;
  return `${complete}.${rem}`;
}

function scoreLabel(runs, wickets, balls) {
  if (runs == null) return '-';
  return `${runs}/${wickets} (${oversFromBalls(balls)})`;
}

const TABS = [
  { key: 'standings', label: 'Standings', icon: '🏆' },
  { key: 'stats', label: 'Stats Leaders', icon: '📊' },
  { key: 'knockouts', label: 'Knockouts', icon: '⚡' }
];

function MovementArrow({ value }) {
  const v = Number(value || 0);
  if (v > 0) return <span className="lg-movement lg-movement--up">▲ {v}</span>;
  if (v < 0) return <span className="lg-movement lg-movement--down">▼ {Math.abs(v)}</span>;
  return <span className="lg-movement lg-movement--none">—</span>;
}

function NrrBadge({ value }) {
  const v = Number(value || 0);
  const cls = v > 0 ? 'positive' : v < 0 ? 'negative' : 'neutral';
  return <span className={`lg-nrr lg-nrr--${cls}`}>{v >= 0 ? '+' : ''}{v.toFixed(3)}</span>;
}

function StatusDot({ status }) {
  const s = (status || '').toLowerCase();
  const label = s === 'completed' ? 'Done' : s === 'live' ? 'Live' : s;
  const cls = s === 'completed' ? 'done' : s === 'live' ? 'live' : 'scheduled';
  return <span className={`lg-status-dot lg-status-dot--${cls}`}>{label}</span>;
}

export default function LeagueTablePage() {
  const { subscribe } = useSocket();

  const [tab, setTab] = useState('standings');
  const [seasons, setSeasons] = useState([]);
  const [seasonId, setSeasonId] = useState(null);
  const [table, setTable] = useState([]);
  const [summary, setSummary] = useState(null);
  const [seasonStats, setSeasonStats] = useState({ batting: [], bowling: [] });
  const [playoffFixtures, setPlayoffFixtures] = useState([]);
  const [finalFixtures, setFinalFixtures] = useState([]);
  const [expandedTiers, setExpandedTiers] = useState({ 1: true, 2: true, 3: true, 4: true });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const tableByLeague = useMemo(
    () => [1, 2, 3, 4].map((tier) => ({
      tier,
      rows: (table || []).filter((row) => Number(row.league_tier) === tier)
    })).filter((g) => g.rows.length > 0),
    [table]
  );

  const progressPct = useMemo(() => {
    if (!summary?.fixtures) return 0;
    const total = summary.fixtures.total_matches || 1;
    return Math.round((summary.fixtures.completed_matches / total) * 100);
  }, [summary]);

  async function load(initial = false) {
    setError('');
    try {
      const seasonResponse = await api.league.seasons();
      const seasonRows = seasonResponse.seasons || [];
      setSeasons(seasonRows);
      const currentSeasonId = seasonId || seasonRows[0]?.id;
      setSeasonId(currentSeasonId);
      if (currentSeasonId) {
        const [tableResp, summaryResp, fixturesResp, statsResp] = await Promise.all([
          api.league.table(currentSeasonId),
          api.league.seasonSummary(currentSeasonId),
          api.league.fixtures(currentSeasonId),
          api.league.seasonStats(currentSeasonId)
        ]);
        setTable(tableResp.table || []);
        setSummary(summaryResp || null);
        setSeasonStats(statsResp || { batting: [], bowling: [] });
        const fixtures = fixturesResp.fixtures || [];
        setPlayoffFixtures(fixtures.filter((f) => f.stage === 'PLAYOFF'));
        setFinalFixtures(fixtures.filter((f) => f.stage === 'FINAL'));
      }
    } catch (e) { setError(e.message); }
    finally { if (initial) setLoading(false); }
  }

  useEffect(() => { load(true); }, []);
  useEffect(() => {
    const off = subscribe('league:update', () => load(false));
    return () => off();
  }, [subscribe, seasonId]);

  async function handleSeasonChange(nextId) {
    setSeasonId(nextId);
    try {
      const [tableResp, summaryResp, fixturesResp, statsResp] = await Promise.all([
        api.league.table(nextId),
        api.league.seasonSummary(nextId),
        api.league.fixtures(nextId),
        api.league.seasonStats(nextId)
      ]);
      setTable(tableResp.table || []);
      setSummary(summaryResp || null);
      setSeasonStats(statsResp || { batting: [], bowling: [] });
      const fixtures = fixturesResp.fixtures || [];
      setPlayoffFixtures(fixtures.filter((f) => f.stage === 'PLAYOFF'));
      setFinalFixtures(fixtures.filter((f) => f.stage === 'FINAL'));
    } catch (e) { setError(e.message); }
  }

  function toggleTier(tier) {
    setExpandedTiers((prev) => ({ ...prev, [tier]: !prev[tier] }));
  }

  if (loading) return <div className="sq-loading"><div className="sq-spinner" /><span>Loading league data...</span></div>;

  const currentSeason = seasons.find((s) => Number(s.id) === Number(seasonId));

  return (
    <div className="lg-page">
      {error && <div className="sq-error">{error}<button type="button" onClick={() => setError('')}>×</button></div>}

      {/* ── Season Selector ── */}
      <div className="lg-season-bar">
        <div className="lg-season-pills">
          {seasons.map((s) => {
            const active = Number(s.id) === Number(seasonId);
            const statusCls = (s.status || '').toLowerCase();
            return (
              <button key={s.id} type="button" className={`lg-season-pill ${active ? 'active' : ''}`} onClick={() => handleSeasonChange(s.id)}>
                <span className="lg-season-pill-name">{s.name}</span>
                <span className={`lg-season-pill-status lg-season-pill-status--${statusCls}`}>{s.status}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Header Strip ── */}
      <div className="lg-header-strip">
        <div className="lg-header-title">
          <h2>{currentSeason?.name || 'League'}</h2>
          <span className="lg-header-teams">{summary?.season?.team_count || table.length} Teams</span>
        </div>
        {summary?.fixtures && (
          <div className="lg-progress-wrap">
            <div className="lg-progress-nums">
              <span>{summary.fixtures.completed_matches} / {summary.fixtures.total_matches} matches</span>
              <span className="lg-progress-pct">{progressPct}%</span>
            </div>
            <div className="lg-progress-track">
              <div className="lg-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="lg-progress-status-row">
              {summary.fixtures.live_matches > 0 && <span className="lg-live-badge">🔴 {summary.fixtures.live_matches} Live</span>}
              {summary.fixtures.scheduled_matches > 0 && <span className="lg-scheduled-badge">{summary.fixtures.scheduled_matches} Scheduled</span>}
            </div>
          </div>
        )}
      </div>

      {/* ── Tab Navigation ── */}
      <nav className="sq-tabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`sq-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            <span className="sq-tab-icon">{t.icon}</span>{t.label}
          </button>
        ))}
      </nav>

      {/* ═══ STANDINGS TAB ═══ */}
      {tab === 'standings' && (
        <div className="sq-tab-content">
          <p className="lg-info-text">League winners qualify for semifinals. Bottom-two and top-two movement applies between tiers each season.</p>
          {tableByLeague.map((group) => {
            const expanded = expandedTiers[group.tier];
            const rowCount = group.rows.length;
            return (
              <section key={`tier-${group.tier}`} className="lg-tier-section">
                <button type="button" className="lg-tier-header" onClick={() => toggleTier(group.tier)}>
                  <div className="lg-tier-header-left">
                    <span className={`lg-tier-badge lg-tier-badge--${group.tier}`}>{group.tier}</span>
                    <h3>League {group.tier}</h3>
                    <span className="lg-tier-count">{rowCount} teams</span>
                  </div>
                  <span className={`lg-tier-chevron ${expanded ? 'open' : ''}`}>▾</span>
                </button>
                {expanded && (
                  <div className="lg-tier-body">
                    <div className="lg-table-wrap">
                      <table className="lg-table">
                        <thead>
                          <tr>
                            <th className="lg-th-pos">#</th>
                            <th>Franchise</th>
                            <th>City</th>
                            <th className="lg-th-num">P</th>
                            <th className="lg-th-num">W</th>
                            <th className="lg-th-num">L</th>
                            <th className="lg-th-num">T</th>
                            <th className="lg-th-num">Pts</th>
                            <th className="lg-th-nrr">NRR</th>
                            <th className="lg-th-num">Move</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.map((row, i) => {
                            const pos = Number(row.league_position);
                            const isPromo = pos <= 2 && group.tier > 1;
                            const isRelegation = pos >= rowCount - 1 && group.tier < 4;
                            const isLeader = pos === 1;
                            const zoneCls = isLeader ? 'leader' : isPromo ? 'promo' : isRelegation ? 'releg' : '';
                            return (
                              <tr key={row.franchise_id || i} className={`lg-table-row ${zoneCls ? `lg-zone--${zoneCls}` : ''}`}>
                                <td className="lg-td-pos">
                                  <span className={`lg-pos-badge ${zoneCls ? `lg-pos--${zoneCls}` : ''}`}>{pos}</span>
                                </td>
                                <td className="lg-td-name">
                                  <TeamNameButton
                                    franchiseId={row.franchise_id}
                                    name={row.franchise_name}
                                    country={row.country}
                                    city={row.city}
                                    className="lg-team-link"
                                  >
                                    {row.franchise_name}
                                  </TeamNameButton>
                                  {row.country && <span className="lg-country-tag">{row.country}</span>}
                                </td>
                                <td className="lg-td-city">{row.city || '-'}</td>
                                <td className="lg-th-num">{row.played}</td>
                                <td className="lg-th-num"><strong>{row.won}</strong></td>
                                <td className="lg-th-num">{row.lost}</td>
                                <td className="lg-th-num">{row.tied}</td>
                                <td className="lg-td-pts"><strong>{row.points}</strong></td>
                                <td><NrrBadge value={row.net_run_rate} /></td>
                                <td><MovementArrow value={row.movement} /></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="lg-zone-legend">
                      {group.tier > 1 && <span className="lg-legend-item lg-legend--promo">● Promotion Zone</span>}
                      {group.tier < 4 && <span className="lg-legend-item lg-legend--releg">● Relegation Zone</span>}
                      <span className="lg-legend-item lg-legend--leader">● League Leader</span>
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* ═══ STATS TAB ═══ */}
      {tab === 'stats' && (
        <div className="sq-tab-content">
          <div className="lg-stats-split">
            {/* Batting Leaderboard */}
            <section className="lg-leaderboard">
              <div className="lg-leaderboard-header">
                <h3>🏏 Top Batters</h3>
              </div>
              {(seasonStats?.batting || []).length === 0 ? (
                <div className="sq-empty">No batting stats yet.</div>
              ) : (
                <div className="lg-leaderboard-list">
                  {(seasonStats.batting || []).slice(0, 12).map((p, i) => (
                    <div key={p.player_id || i} className={`lg-leader-row ${i < 3 ? `lg-leader-row--top${i + 1}` : ''}`}>
                      <span className={`lg-leader-rank ${i < 3 ? 'lg-leader-rank--medal' : ''}`}>
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                      </span>
                      <div className="lg-leader-info">
                        <strong>{p.first_name} {p.last_name}</strong>
                        <TeamNameButton franchiseId={p.franchise_id} name={p.franchise_name} className="lg-leader-team">
                          {p.franchise_name}
                        </TeamNameButton>
                      </div>
                      <div className="lg-leader-stats">
                        <span className="lg-leader-primary">{p.runs}</span>
                        <span className="lg-leader-secondary">{p.innings} inn · SR {Number(p.strike_rate).toFixed(1)}</span>
                      </div>
                      <div className="lg-leader-extras">
                        <span>{p.fours} × 4s</span>
                        <span>{p.sixes} × 6s</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Bowling Leaderboard */}
            <section className="lg-leaderboard">
              <div className="lg-leaderboard-header">
                <h3>🎯 Top Bowlers</h3>
              </div>
              {(seasonStats?.bowling || []).length === 0 ? (
                <div className="sq-empty">No bowling stats yet.</div>
              ) : (
                <div className="lg-leaderboard-list">
                  {(seasonStats.bowling || []).slice(0, 12).map((p, i) => (
                    <div key={p.player_id || i} className={`lg-leader-row ${i < 3 ? `lg-leader-row--top${i + 1}` : ''}`}>
                      <span className={`lg-leader-rank ${i < 3 ? 'lg-leader-rank--medal' : ''}`}>
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                      </span>
                      <div className="lg-leader-info">
                        <strong>{p.first_name} {p.last_name}</strong>
                        <TeamNameButton franchiseId={p.franchise_id} name={p.franchise_name} className="lg-leader-team">
                          {p.franchise_name}
                        </TeamNameButton>
                      </div>
                      <div className="lg-leader-stats">
                        <span className="lg-leader-primary">{p.wickets} wkts</span>
                        <span className="lg-leader-secondary">{oversFromBalls(p.balls)} ov · Econ {Number(p.economy).toFixed(1)}</span>
                      </div>
                      <div className="lg-leader-extras">
                        <span>{p.maidens} mdn</span>
                        <span>{p.runs_conceded} runs</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {/* ═══ KNOCKOUTS TAB ═══ */}
      {tab === 'knockouts' && (
        <div className="sq-tab-content">
          {/* Playoffs */}
          <section className="lg-ko-section">
            <div className="lg-ko-header">
              <h3>Semifinals</h3>
              <span className="lg-ko-count">{playoffFixtures.length} match{playoffFixtures.length !== 1 ? 'es' : ''}</span>
            </div>
            {playoffFixtures.length === 0 ? (
              <div className="sq-empty">No playoff fixtures for this season.</div>
            ) : (
              <div className="lg-ko-grid">
                {playoffFixtures.map((f, i) => (
                  <div key={f.id || i} className="lg-match-card">
                    <div className="lg-match-card-header">
                      <span className="lg-match-label">{f.matchday_label}</span>
                      <StatusDot status={f.status} />
                    </div>
                    <div className="lg-match-teams">
                      <div className="lg-match-team">
                        <TeamNameButton franchiseId={f.home_franchise_id} name={f.home_franchise_name} country={f.home_country} className="lg-team-link">
                          {f.home_franchise_name}
                        </TeamNameButton>
                        <span className="lg-match-country">{f.home_country || ''}</span>
                        <span className="lg-match-score">{scoreLabel(f.home_score, f.home_wickets, f.home_balls)}</span>
                      </div>
                      <span className="lg-match-vs">vs</span>
                      <div className="lg-match-team lg-match-team--away">
                        <TeamNameButton franchiseId={f.away_franchise_id} name={f.away_franchise_name} country={f.away_country} className="lg-team-link">
                          {f.away_franchise_name}
                        </TeamNameButton>
                        <span className="lg-match-country">{f.away_country || ''}</span>
                        <span className="lg-match-score">{scoreLabel(f.away_score, f.away_wickets, f.away_balls)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Final */}
          <section className="lg-ko-section">
            <div className="lg-ko-header">
              <h3>🏆 Final</h3>
            </div>
            {finalFixtures.length === 0 ? (
              <div className="sq-empty">No final fixture for this season.</div>
            ) : (
              <div className="lg-ko-grid">
                {finalFixtures.map((f, i) => (
                  <div key={f.id || i} className="lg-match-card lg-match-card--final">
                    <div className="lg-match-card-header">
                      <span className="lg-match-label">{f.matchday_label}</span>
                      <StatusDot status={f.status} />
                    </div>
                    <div className="lg-match-teams">
                      <div className="lg-match-team">
                        <TeamNameButton franchiseId={f.home_franchise_id} name={f.home_franchise_name} country={f.home_country} className="lg-team-link">
                          {f.home_franchise_name}
                        </TeamNameButton>
                        <span className="lg-match-country">{f.home_country || ''}</span>
                        <span className="lg-match-score">{scoreLabel(f.home_score, f.home_wickets, f.home_balls)}</span>
                      </div>
                      <span className="lg-match-vs">vs</span>
                      <div className="lg-match-team lg-match-team--away">
                        <TeamNameButton franchiseId={f.away_franchise_id} name={f.away_franchise_name} country={f.away_country} className="lg-team-link">
                          {f.away_franchise_name}
                        </TeamNameButton>
                        <span className="lg-match-country">{f.away_country || ''}</span>
                        <span className="lg-match-score">{scoreLabel(f.away_score, f.away_wickets, f.away_balls)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
