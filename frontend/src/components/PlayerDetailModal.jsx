import { useEffect, useMemo, useState } from 'react';

/* ── helpers ───────────────────────────────────────────── */
function fmt(v) { return v == null ? '-' : Number(v).toLocaleString(); }
function fmtDec(v, d = 1) { return v == null ? '-' : Number(v).toFixed(d); }
function fmtMoney(v) {
  const n = Number(v || 0);
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
function sr(runs, balls) {
  const b = Number(balls);
  return b > 0 ? ((Number(runs) / b) * 100).toFixed(1) : '-';
}
function bowlEcon(runs, balls) {
  const b = Number(balls);
  return b > 0 ? ((Number(runs) / b) * 6).toFixed(2) : '-';
}
function bowlOvers(balls) {
  const b = Number(balls);
  return b > 0 ? `${Math.floor(b / 6)}.${b % 6}` : '0.0';
}
function ratingColor(r) {
  const v = Number(r);
  if (v >= 80) return 'var(--leaf)';
  if (v >= 50) return 'var(--accent)';
  return 'var(--danger)';
}

const MODAL_TABS = ['Overview', 'Seasons', 'Matches'];

export default function PlayerDetailModal({ open, playerDetail, selectedPlayer, onClose, StatBar, OverallRing, RolePill }) {
  const [activeTab, setActiveTab] = useState('Overview');

  useEffect(() => {
    if (!open) return undefined;
    setActiveTab('Overview');
    function onKeyDown(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKeyDown); document.body.style.overflow = ''; };
  }, [open, onClose]);

  /* ── derived stats ── */
  const p = playerDetail?.player;
  const matches = playerDetail?.recentMatches || [];
  const seasonStats = playerDetail?.seasonStats || [];

  const careerBatAvg = useMemo(() => {
    if (!p) return '-';
    const m = Number(p.career_matches);
    const r = Number(p.career_runs);
    // crude innings ≈ matches (T20 = 1 innings each)
    return m > 0 ? (r / m).toFixed(2) : '-';
  }, [p]);

  const careerBowlAvg = useMemo(() => {
    if (!p) return '-';
    const w = Number(p.career_wickets);
    const rc = Number(p.career_runs_conceded);
    return w > 0 ? (rc / w).toFixed(2) : '-';
  }, [p]);

  const careerSR = useMemo(() => {
    if (!p) return '-';
    const b = Number(p.career_balls);
    return b > 0 ? ((Number(p.career_runs) / b) * 100).toFixed(1) : '-';
  }, [p]);

  const careerEcon = useMemo(() => {
    if (!p) return '-';
    const ov = Number(p.career_overs);
    return ov > 0 ? (Number(p.career_runs_conceded) / ov).toFixed(2) : '-';
  }, [p]);

  if (!open) return null;

  const player = p || selectedPlayer;
  const title = player ? `${player.first_name} ${player.last_name}` : 'Player Detail';

  return (
    <div className="sq-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="pd-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>

        {/* ── Close button ── */}
        <button type="button" className="pd-close" onClick={onClose}>×</button>

        {!p ? (
          <div className="sq-loading" style={{ padding: '3rem' }}>
            <div className="sq-spinner" /><span>Loading player…</span>
          </div>
        ) : (
          <>
            {/* ═══ HERO BANNER ═══ */}
            <div className="pd-hero">
              <div className="pd-hero-left">
                <OverallRing value={p.overall} />
              </div>
              <div className="pd-hero-center">
                <h2 className="pd-name">{p.first_name} {p.last_name}</h2>
                <div className="pd-tags">
                  <RolePill role={p.role} />
                  <span className="pd-tag">{p.squad_status?.replace('_', ' ')}</span>
                  {p.starting_xi && <span className="pd-tag pd-tag--xi">XI #{p.lineup_slot || '-'}</span>}
                  <span className="pd-tag">Age {p.age}</span>
                  <span className="pd-tag">{p.country_origin}</span>
                </div>
                <div className="pd-quick-nums">
                  <span><b>{fmt(p.career_matches)}</b> Mat</span>
                  <span><b>{fmt(p.career_runs)}</b> Runs</span>
                  <span><b>{fmt(p.career_fifties || 0)}</b> 50s</span>
                  <span><b>{fmt(p.career_hundreds || 0)}</b> 100s</span>
                  <span><b>{fmt(p.career_wickets)}</b> Wkts</span>
                  <span><b>{fmt(p.career_player_of_match)}</b> POTM</span>
                </div>
              </div>
              <div className="pd-hero-right">
                <div className="pd-val-box">
                  <span className="pd-val-label">Value</span>
                  <span className="pd-val-amount">{fmtMoney(p.market_value)}</span>
                </div>
                <div className="pd-val-box">
                  <span className="pd-val-label">Salary</span>
                  <span className="pd-val-amount">{fmtMoney(p.salary)}</span>
                </div>
              </div>
            </div>

            {/* ═══ CONDITIONS ROW ═══ */}
            <div className="pd-conditions">
              {[
                { label: 'Form', value: p.form, max: 100 },
                { label: 'Morale', value: p.morale, max: 100 },
                { label: 'Fitness', value: p.fitness, max: 100 },
                { label: 'Potential', value: p.potential, max: 100 },
              ].map((c) => {
                const pct = Math.min(100, Math.max(0, (Number(c.value) / c.max) * 100));
                const col = pct >= 70 ? 'var(--leaf)' : pct >= 40 ? 'var(--accent)' : 'var(--danger)';
                return (
                  <div key={c.label} className="pd-cond">
                    <div className="pd-cond-head">
                      <span>{c.label}</span>
                      <span style={{ color: col, fontWeight: 700 }}>{fmtDec(c.value, 0)}</span>
                    </div>
                    <div className="pd-cond-track"><div className="pd-cond-fill" style={{ width: `${pct}%`, background: col }} /></div>
                  </div>
                );
              })}
            </div>

            {/* ═══ TAB NAV ═══ */}
            <nav className="pd-tabs">
              {MODAL_TABS.map((t) => (
                <button key={t} type="button" className={`pd-tab ${activeTab === t ? 'active' : ''}`} onClick={() => setActiveTab(t)}>{t}</button>
              ))}
            </nav>

            {/* ═══ TAB CONTENT ═══ */}
            <div className="pd-body">
              {activeTab === 'Overview' && (
                <>
                  {/* ── Skills ── */}
                  <div className="pd-section">
                    <h4 className="pd-section-title">Skills</h4>
                    <div className="pd-skills-grid">
                      <StatBar label="Batting" value={p.batting} />
                      <StatBar label="Bowling" value={p.bowling} />
                      <StatBar label="Fielding" value={p.fielding} />
                      <StatBar label="Temperament" value={p.temperament} />
                    </div>
                  </div>

                  {/* ── Career Batting ── */}
                  <div className="pd-section">
                    <h4 className="pd-section-title">Career Batting</h4>
                    <div className="pd-stats-table-wrap">
                        <table className="pd-stats-table">
                          <thead>
                          <tr>
                            <th>Mat</th><th>Runs</th><th>Balls</th><th>Avg</th><th>SR</th><th>4s</th><th>6s</th><th>50s</th><th>100s</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>{fmt(p.career_matches)}</td>
                            <td><b>{fmt(p.career_runs)}</b></td>
                            <td>{fmt(p.career_balls)}</td>
                            <td>{careerBatAvg}</td>
                            <td>{careerSR}</td>
                            <td>{fmt(p.career_fours)}</td>
                            <td>{fmt(p.career_sixes)}</td>
                            <td>{fmt(p.career_fifties || 0)}</td>
                            <td>{fmt(p.career_hundreds || 0)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* ── Career Bowling ── */}
                  <div className="pd-section">
                    <h4 className="pd-section-title">Career Bowling</h4>
                    <div className="pd-stats-table-wrap">
                      <table className="pd-stats-table">
                        <thead>
                          <tr>
                            <th>Overs</th><th>Runs</th><th>Wkts</th><th>Avg</th><th>Econ</th><th>Catches</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>{fmtDec(p.career_overs, 1)}</td>
                            <td>{fmt(p.career_runs_conceded)}</td>
                            <td><b>{fmt(p.career_wickets)}</b></td>
                            <td>{careerBowlAvg}</td>
                            <td>{careerEcon}</td>
                            <td>{fmt(p.career_catches)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* ── Recent Form (last 5 ratings) ── */}
                  {matches.length > 0 && (
                    <div className="pd-section">
                      <h4 className="pd-section-title">Last {Math.min(matches.length, 5)} Match Ratings</h4>
                      <div className="pd-form-strip">
                        {matches.slice(0, 5).map((m, i) => (
                          <div key={i} className="pd-form-pip" style={{ background: ratingColor(m.player_rating) }}>
                            {Number(m.player_rating).toFixed(0)}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {activeTab === 'Seasons' && (
                <div className="pd-section">
                  <h4 className="pd-section-title">Season-by-Season Breakdown</h4>
                  {seasonStats.length === 0 ? (
                    <div className="sq-empty">No season data available yet.</div>
                  ) : (
                    <>
                      {/* ── Season Batting ── */}
                      <div className="pd-subsection-title">Batting</div>
                      <div className="pd-stats-table-wrap">
                        <table className="pd-stats-table pd-stats-table--seasons">
                          <thead>
                            <tr>
                              <th>Season</th><th>Mat</th><th>Runs</th><th>Balls</th><th>Avg</th><th>SR</th><th>4s</th><th>6s</th><th>50s</th><th>100s</th><th>NO</th><th>HS</th>
                            </tr>
                          </thead>
                          <tbody>
                            {seasonStats.map((s) => {
                              const outs = s.matches - (s.not_outs || 0);
                              const avg = outs > 0 ? (s.runs / outs).toFixed(2) : s.runs > 0 ? '∞' : '-';
                              return (
                                <tr key={s.season_id}>
                                  <td><b>S{s.season_id}</b></td>
                                  <td>{s.matches}</td>
                                  <td><b>{fmt(s.runs)}</b></td>
                                  <td>{fmt(s.balls)}</td>
                                  <td>{avg}</td>
                                  <td>{sr(s.runs, s.balls)}</td>
                                  <td>{fmt(s.fours)}</td>
                                  <td>{fmt(s.sixes)}</td>
                                  <td>{fmt(s.fifties || 0)}</td>
                                  <td>{fmt(s.hundreds || 0)}</td>
                                  <td>{s.not_outs || 0}</td>
                                  <td>{fmt(s.highest_score)}</td>
                                </tr>
                              );
                            })}
                            {/* ── Totals row ── */}
                            {seasonStats.length > 1 && (() => {
                              const tot = seasonStats.reduce((a, s) => ({
                                matches: a.matches + s.matches,
                                runs: a.runs + s.runs,
                                balls: a.balls + s.balls,
                                fours: a.fours + s.fours,
                                sixes: a.sixes + s.sixes,
                                fifties: a.fifties + (s.fifties || 0),
                                hundreds: a.hundreds + (s.hundreds || 0),
                                not_outs: a.not_outs + (s.not_outs || 0),
                                highest_score: Math.max(a.highest_score, s.highest_score || 0),
                              }), { matches: 0, runs: 0, balls: 0, fours: 0, sixes: 0, fifties: 0, hundreds: 0, not_outs: 0, highest_score: 0 });
                              const outs = tot.matches - tot.not_outs;
                              const avg = outs > 0 ? (tot.runs / outs).toFixed(2) : '-';
                              return (
                                <tr className="pd-row--total">
                                  <td><b>ALL</b></td>
                                  <td>{tot.matches}</td>
                                  <td><b>{fmt(tot.runs)}</b></td>
                                  <td>{fmt(tot.balls)}</td>
                                  <td>{avg}</td>
                                  <td>{sr(tot.runs, tot.balls)}</td>
                                  <td>{fmt(tot.fours)}</td>
                                  <td>{fmt(tot.sixes)}</td>
                                  <td>{fmt(tot.fifties)}</td>
                                  <td>{fmt(tot.hundreds)}</td>
                                  <td>{tot.not_outs}</td>
                                  <td>{fmt(tot.highest_score)}</td>
                                </tr>
                              );
                            })()}
                          </tbody>
                        </table>
                      </div>

                      {/* ── Season Bowling ── */}
                      <div className="pd-subsection-title" style={{ marginTop: '1.2rem' }}>Bowling</div>
                      <div className="pd-stats-table-wrap">
                        <table className="pd-stats-table pd-stats-table--seasons">
                          <thead>
                            <tr>
                              <th>Season</th><th>Mat</th><th>O</th><th>Runs</th><th>Wkts</th><th>Avg</th><th>Econ</th><th>Mdn</th><th>BW</th><th>Ct</th>
                            </tr>
                          </thead>
                          <tbody>
                            {seasonStats.map((s) => {
                              const bAvg = s.wickets > 0 ? (s.runs_conceded / s.wickets).toFixed(2) : '-';
                              const overs = bowlOvers(s.bowling_balls);
                              const econ = s.bowling_balls > 0 ? ((s.runs_conceded / s.bowling_balls) * 6).toFixed(2) : '-';
                              return (
                                <tr key={s.season_id}>
                                  <td><b>S{s.season_id}</b></td>
                                  <td>{s.matches}</td>
                                  <td>{overs}</td>
                                  <td>{fmt(s.runs_conceded)}</td>
                                  <td><b>{fmt(s.wickets)}</b></td>
                                  <td>{bAvg}</td>
                                  <td>{econ}</td>
                                  <td>{s.maidens || 0}</td>
                                  <td>{fmt(s.best_wickets)}</td>
                                  <td>{fmt(s.catches)}</td>
                                </tr>
                              );
                            })}
                            {seasonStats.length > 1 && (() => {
                              const tot = seasonStats.reduce((a, s) => ({
                                matches: a.matches + s.matches,
                                bowling_balls: a.bowling_balls + s.bowling_balls,
                                runs_conceded: a.runs_conceded + s.runs_conceded,
                                wickets: a.wickets + s.wickets,
                                maidens: a.maidens + (s.maidens || 0),
                                best_wickets: Math.max(a.best_wickets, s.best_wickets || 0),
                                catches: a.catches + s.catches,
                              }), { matches: 0, bowling_balls: 0, runs_conceded: 0, wickets: 0, maidens: 0, best_wickets: 0, catches: 0 });
                              const bAvg = tot.wickets > 0 ? (tot.runs_conceded / tot.wickets).toFixed(2) : '-';
                              const econ = tot.bowling_balls > 0 ? ((tot.runs_conceded / tot.bowling_balls) * 6).toFixed(2) : '-';
                              return (
                                <tr className="pd-row--total">
                                  <td><b>ALL</b></td>
                                  <td>{tot.matches}</td>
                                  <td>{bowlOvers(tot.bowling_balls)}</td>
                                  <td>{fmt(tot.runs_conceded)}</td>
                                  <td><b>{fmt(tot.wickets)}</b></td>
                                  <td>{bAvg}</td>
                                  <td>{econ}</td>
                                  <td>{tot.maidens}</td>
                                  <td>{fmt(tot.best_wickets)}</td>
                                  <td>{fmt(tot.catches)}</td>
                                </tr>
                              );
                            })()}
                          </tbody>
                        </table>
                      </div>

                      {/* ── Season Ratings ── */}
                      <div className="pd-subsection-title" style={{ marginTop: '1.2rem' }}>Performance</div>
                      <div className="pd-stats-table-wrap">
                        <table className="pd-stats-table pd-stats-table--seasons">
                          <thead><tr><th>Season</th><th>Mat</th><th>Avg Rating</th><th>Run Outs</th></tr></thead>
                          <tbody>
                            {seasonStats.map((s) => (
                              <tr key={s.season_id}>
                                <td><b>S{s.season_id}</b></td>
                                <td>{s.matches}</td>
                                <td>
                                  <span className="pd-rating-chip" style={{ background: ratingColor(Number(s.avg_rating)) }}>
                                    {Number(s.avg_rating).toFixed(1)}
                                  </span>
                                </td>
                                <td>{s.run_outs || 0}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeTab === 'Matches' && (
                <div className="pd-section">
                  <h4 className="pd-section-title">Match-by-Match Stats</h4>
                  {matches.length === 0 ? (
                    <div className="sq-empty">No match stats recorded yet.</div>
                  ) : (
                    <div className="pd-stats-table-wrap pd-stats-table-wrap--scroll">
                      <table className="pd-stats-table pd-stats-table--matches">
                        <thead>
                          <tr>
                            <th className="pd-th-freeze">Match</th>
                            <th>Vs</th>
                            <th>Rating</th>
                            <th>Runs</th>
                            <th>Balls</th>
                            <th>SR</th>
                            <th>4s</th>
                            <th>6s</th>
                            <th>Out</th>
                            <th>O</th>
                            <th>Runs C</th>
                            <th>Wkts</th>
                            <th>Econ</th>
                            <th>Mdn</th>
                            <th>Ct</th>
                            <th>RO</th>
                          </tr>
                        </thead>
                        <tbody>
                          {matches.map((m, i) => {
                            const opponent = m.home_franchise_name && m.away_franchise_name
                              ? (Number(m.franchise_id) === Number(p.franchise_id) ? m.away_franchise_name : m.home_franchise_name)
                              : '-';
                            const opponentShort = opponent.length > 16 ? opponent.slice(0, 15) + '…' : opponent;
                            return (
                              <tr key={i} className={Number(m.player_rating) >= 80 ? 'pd-row--star' : ''}>
                                <td className="pd-td-match pd-th-freeze">
                                  <span className="pd-match-id">S{m.season_id} R{m.round_no}</span>
                                  <span className="pd-match-stage">{m.stage}</span>
                                </td>
                                <td className="pd-td-vs" title={opponent}>{opponentShort}</td>
                                <td className="pd-td-rating">
                                  <span className="pd-rating-chip" style={{ background: ratingColor(m.player_rating) }}>
                                    {Number(m.player_rating).toFixed(1)}
                                  </span>
                                </td>
                                <td><b>{m.batting_runs}</b></td>
                                <td>{m.batting_balls}</td>
                                <td>{sr(m.batting_runs, m.batting_balls)}</td>
                                <td>{m.fours || 0}</td>
                                <td>{m.sixes || 0}</td>
                                <td className="pd-td-dismissal">{m.not_out ? <span className="pd-notout">NOT OUT</span> : (m.dismissal_text || 'out')}</td>
                                <td>{bowlOvers(m.bowling_balls)}</td>
                                <td>{m.bowling_runs}</td>
                                <td><b>{m.bowling_wickets}</b></td>
                                <td>{bowlEcon(m.bowling_runs, m.bowling_balls)}</td>
                                <td>{m.maiden_overs || 0}</td>
                                <td>{m.catches || 0}</td>
                                <td>{m.run_outs || 0}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
