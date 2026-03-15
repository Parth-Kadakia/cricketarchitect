import { useEffect, useMemo, useState } from 'react';

/* ── helpers ───────────────────────────────────────────── */
function fmt(v) { return v == null ? '-' : Number(v).toLocaleString(); }
function fmtDec(v, d = 1) { return v == null ? '-' : Number(v).toFixed(d); }
function pretty(v) { return v == null || v === '' ? '-' : String(v).replace(/_/g, ' '); }
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
function condColor(pct) {
  if (pct >= 70) return 'var(--success)';
  if (pct >= 40) return 'var(--accent)';
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
  const clubSeasonStats = playerDetail?.clubSeasonStats || [];
  const internationalSeasonStats = playerDetail?.internationalSeasonStats || [];
  const competitionSplits = playerDetail?.competitionSplits || { club: {}, international: {} };
  const careerMode = String(playerDetail?.careerMode || p?.franchise_competition_mode || '').toUpperCase();
  const isInternationalCareerMode = careerMode === 'INTERNATIONAL';
  const showClubSections = !isInternationalCareerMode;
  const showInternationalSections = isInternationalCareerMode || Number(competitionSplits.international?.matches || 0) > 0;

  const careerBatAvg = useMemo(() => {
    if (!p) return '-';
    const m = Number(p.career_matches);
    const r = Number(p.career_runs);
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

  const headlineStats = useMemo(() => {
    if (isInternationalCareerMode && Number(competitionSplits.international?.matches || 0) > 0) {
      return {
        matches: Number(competitionSplits.international.matches || 0),
        runs: Number(competitionSplits.international.runs || 0),
        battingAverage: competitionSplits.international.battingAverage ?? 0,
        strikeRate: competitionSplits.international.strikeRate ?? 0,
        wickets: Number(competitionSplits.international.wickets || 0),
        economy: competitionSplits.international.economy ?? 0,
        fifties: Number(competitionSplits.international.fifties || 0),
        hundreds: Number(competitionSplits.international.hundreds || 0)
      };
    }

    return {
      matches: Number(p?.career_matches || 0),
      runs: Number(p?.career_runs || 0),
      battingAverage: careerBatAvg,
      strikeRate: careerSR,
      wickets: Number(p?.career_wickets || 0),
      economy: careerEcon,
      fifties: Number(p?.career_fifties || 0),
      hundreds: Number(p?.career_hundreds || 0)
    };
  }, [careerBatAvg, careerEcon, careerSR, competitionSplits.international, isInternationalCareerMode, p]);

  function renderSplitSummary(title, stats) {
    const safeStats = stats || {};
    const hasMatches = Number(safeStats.matches || 0) > 0;

    return (
      <div className="pd-split-block">
        <div className="pd-subsection-title">{title}</div>
        {!hasMatches ? (
          <div className="sq-empty">No stats yet.</div>
        ) : (
          <div className="pd-stat-cards pd-stat-cards--split">
            <div className="pd-stat-card"><span className="pd-sc-val">{fmt(safeStats.matches)}</span><span className="pd-sc-label">Matches</span></div>
            <div className="pd-stat-card"><span className="pd-sc-val">{fmt(safeStats.runs)}</span><span className="pd-sc-label">Runs</span></div>
            <div className="pd-stat-card"><span className="pd-sc-val">{fmtDec(safeStats.battingAverage, 2)}</span><span className="pd-sc-label">Bat Avg</span></div>
            <div className="pd-stat-card"><span className="pd-sc-val">{fmtDec(safeStats.strikeRate, 2)}</span><span className="pd-sc-label">Strike Rate</span></div>
            <div className="pd-stat-card"><span className="pd-sc-val">{fmt(safeStats.wickets)}</span><span className="pd-sc-label">Wickets</span></div>
            <div className="pd-stat-card"><span className="pd-sc-val">{fmtDec(safeStats.economy, 2)}</span><span className="pd-sc-label">Economy</span></div>
            <div className="pd-stat-card"><span className="pd-sc-val">{fmt(safeStats.fifties)}/{fmt(safeStats.hundreds)}</span><span className="pd-sc-label">50s / 100s</span></div>
            <div className="pd-stat-card"><span className="pd-sc-val">{fmt(safeStats.highestScore)}</span><span className="pd-sc-label">Highest</span></div>
          </div>
        )}
      </div>
    );
  }

  function renderSeasonTables(title, rows) {
    if (!rows.length) {
      return (
        <div className="pd-season-group">
          <div className="pd-subsection-title">{title}</div>
          <div className="sq-empty">No season data available yet.</div>
        </div>
      );
    }

    return (
      <div className="pd-season-group">
        <div className="pd-subsection-title">{title}</div>
        <div className="pd-stats-table-wrap">
          <table className="pd-stats-table pd-stats-table--seasons">
            <thead>
              <tr>
                <th>Season</th><th>Mat</th><th>Runs</th><th>Avg</th><th>SR</th><th>4s</th><th>6s</th><th>50s</th><th>100s</th><th>HS</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const outs = Number(s.matches || 0) - Number(s.not_outs || 0);
                const avg = outs > 0 ? (Number(s.runs || 0) / outs).toFixed(1) : Number(s.runs || 0) > 0 ? '∞' : '-';
                return (
                  <tr key={`${title}-${s.season_id}`}>
                    <td><b>{s.season_name || `Season ${s.season_id}`}</b></td>
                    <td>{s.matches}</td>
                    <td><b>{fmt(s.runs)}</b></td>
                    <td>{avg}</td>
                    <td>{sr(s.runs, s.balls)}</td>
                    <td>{fmt(s.fours)}</td>
                    <td>{fmt(s.sixes)}</td>
                    <td>{fmt(s.fifties || 0)}</td>
                    <td>{fmt(s.hundreds || 0)}</td>
                    <td>{fmt(s.highest_score)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="pd-stats-table-wrap">
          <table className="pd-stats-table pd-stats-table--seasons">
            <thead>
              <tr>
                <th>Season</th><th>Overs</th><th>Runs</th><th>Wkts</th><th>Avg</th><th>Econ</th><th>Best</th><th>Ct</th><th>RO</th><th>Rtg</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const wickets = Number(s.wickets || 0);
                const runsConceded = Number(s.runs_conceded || 0);
                return (
                  <tr key={`${title}-bowl-${s.season_id}`}>
                    <td><b>{s.season_name || `Season ${s.season_id}`}</b></td>
                    <td>{bowlOvers(s.bowling_balls)}</td>
                    <td>{fmt(s.runs_conceded)}</td>
                    <td><b>{fmt(s.wickets)}</b></td>
                    <td>{wickets > 0 ? (runsConceded / wickets).toFixed(1) : '-'}</td>
                    <td>{bowlEcon(s.runs_conceded, s.bowling_balls)}</td>
                    <td>{fmt(s.best_wickets)}</td>
                    <td>{fmt(s.catches)}</td>
                    <td>{fmt(s.run_outs)}</td>
                    <td>
                      <span className="pd-rating-chip" style={{ background: ratingColor(Number(s.avg_rating || 0)) }}>
                        {Number(s.avg_rating || 0).toFixed(1)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

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
            {/* ═══ HERO ═══ */}
            <div className="pd-hero">
              <OverallRing value={p.overall} />
              <div className="pd-hero-info">
                <h2 className="pd-name">{p.first_name} {p.last_name}</h2>
                <div className="pd-tags">
                  <RolePill role={p.role} />
                  <span className="pd-tag">Age {p.age}</span>
                  <span className="pd-tag">{p.country_origin}</span>
                  {p.starting_xi && <span className="pd-tag pd-tag--xi">XI #{p.lineup_slot || '-'}</span>}
                </div>
              </div>
              <div className="pd-hero-money">
                <span className="pd-money-val">{fmtMoney(p.market_value)}</span>
                <span className="pd-money-label">Value</span>
              </div>
            </div>

            {/* ═══ STATUS STRIP ═══ */}
            <div className="pd-status-strip">
              {[
                { label: 'Form', value: p.form },
                { label: 'Morale', value: p.morale },
                { label: 'Fitness', value: p.fitness },
                { label: 'Potential', value: p.potential },
                { label: 'BAT', value: p.batting },
                { label: 'BOWL', value: p.bowling },
                { label: 'FIELD', value: p.fielding },
                { label: 'TEMP', value: p.temperament },
              ].map((s) => {
                const v = Number(s.value || 0);
                const pct = Math.min(100, Math.max(0, v));
                return (
                  <div key={s.label} className="pd-status-item">
                    <svg width="36" height="36" viewBox="0 0 36 36">
                      <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
                      <circle cx="18" cy="18" r="15" fill="none" stroke={condColor(pct)} strokeWidth="3" strokeLinecap="round"
                        strokeDasharray={`${2 * Math.PI * 15}`} strokeDashoffset={`${2 * Math.PI * 15 * (1 - pct / 100)}`}
                        transform="rotate(-90 18 18)" style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
                    </svg>
                    <span className="pd-status-val">{v.toFixed(0)}</span>
                    <span className="pd-status-label">{s.label}</span>
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
                  {/* ── Career at a glance ── */}
                  <div className="pd-stat-cards">
                    <div className="pd-stat-card">
                      <span className="pd-sc-val">{fmt(headlineStats.matches)}</span>
                      <span className="pd-sc-label">Matches</span>
                    </div>
                    <div className="pd-stat-card">
                      <span className="pd-sc-val">{fmt(headlineStats.runs)}</span>
                      <span className="pd-sc-label">Runs</span>
                    </div>
                    <div className="pd-stat-card">
                      <span className="pd-sc-val">{headlineStats.battingAverage}</span>
                      <span className="pd-sc-label">Bat Avg</span>
                    </div>
                    <div className="pd-stat-card">
                      <span className="pd-sc-val">{headlineStats.strikeRate}</span>
                      <span className="pd-sc-label">Strike Rate</span>
                    </div>
                    <div className="pd-stat-card">
                      <span className="pd-sc-val">{fmt(headlineStats.wickets)}</span>
                      <span className="pd-sc-label">Wickets</span>
                    </div>
                    <div className="pd-stat-card">
                      <span className="pd-sc-val">{headlineStats.economy}</span>
                      <span className="pd-sc-label">Economy</span>
                    </div>
                    <div className="pd-stat-card">
                      <span className="pd-sc-val">{fmt(headlineStats.fifties)}/{fmt(headlineStats.hundreds)}</span>
                      <span className="pd-sc-label">50s / 100s</span>
                    </div>
                    <div className="pd-stat-card">
                      <span className="pd-sc-val">{fmt(p.career_player_of_match)}</span>
                      <span className="pd-sc-label">POTM</span>
                    </div>
                  </div>

                  {showClubSections && renderSplitSummary('Club Career', competitionSplits.club)}
                  {showInternationalSections && renderSplitSummary('International Career', competitionSplits.international)}

                  {/* ── Profile chips ── */}
                  <div className="pd-profile-chips">
                    <div className="pd-chip"><span>Bat</span><strong>{pretty(p.batsman_type)}</strong></div>
                    <div className="pd-chip"><span>Hand</span><strong>{pretty(p.batsman_hand)}</strong></div>
                    <div className="pd-chip"><span>Bowl</span><strong>{pretty(p.bowler_style)}</strong></div>
                    <div className="pd-chip"><span>Arm</span><strong>{pretty(p.bowler_hand)}</strong></div>
                    <div className="pd-chip"><span>Mentality</span><strong>{pretty(p.bowler_mentality)}</strong></div>
                    <div className="pd-chip"><span>Salary</span><strong>{fmtMoney(p.salary)}</strong></div>
                  </div>

                  {/* ── Recent Form ── */}
                  {matches.length > 0 && (
                    <div className="pd-section">
                      <h4 className="pd-section-title">Last {Math.min(matches.length, 5)} Ratings</h4>
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
                  <h4 className="pd-section-title">Season-by-Season</h4>
                  {!seasonStats.length ? (
                    <div className="sq-empty">No season data available yet.</div>
                  ) : (
                    <>
                      {showClubSections && renderSeasonTables('Club Seasons', clubSeasonStats)}
                      {showInternationalSections && renderSeasonTables('International Seasons', internationalSeasonStats)}
                    </>
                  )}
                </div>
              )}

              {activeTab === 'Matches' && (
                <div className="pd-section">
                  <h4 className="pd-section-title">Match Log</h4>
                  {matches.length === 0 ? (
                    <div className="sq-empty">No match stats recorded yet.</div>
                  ) : (
                    <div className="pd-stats-table-wrap pd-stats-table-wrap--scroll">
                      <table className="pd-stats-table pd-stats-table--matches">
                        <thead>
                          <tr>
                            <th className="pd-th-freeze">Match</th>
                            <th>Mode</th>
                            <th>Vs</th>
                            <th>Rtg</th>
                            <th>R</th>
                            <th>B</th>
                            <th>SR</th>
                            <th>4s</th>
                            <th>6s</th>
                            <th>Out</th>
                            <th>O</th>
                            <th>RC</th>
                            <th>W</th>
                            <th>Ec</th>
                            <th>Ct</th>
                          </tr>
                        </thead>
                        <tbody>
                          {matches.map((m, i) => {
                            const opponent = m.home_franchise_name && m.away_franchise_name
                              ? (Number(m.franchise_id) === Number(p.franchise_id) ? m.away_franchise_name : m.home_franchise_name)
                              : '-';
                            const opponentShort = opponent.length > 14 ? opponent.slice(0, 13) + '…' : opponent;
                            return (
                              <tr key={i} className={Number(m.player_rating) >= 80 ? 'pd-row--star' : ''}>
                                <td className="pd-td-match pd-th-freeze">
                                  <span className="pd-match-id">{m.season_name || `S${m.season_id}`} R{m.round_no}</span>
                                </td>
                                <td>{String(m.competition_mode || '').toUpperCase() || '-'}</td>
                                <td className="pd-td-vs" title={opponent}>{opponentShort}</td>
                                <td>
                                  <span className="pd-rating-chip" style={{ background: ratingColor(m.player_rating) }}>
                                    {Number(m.player_rating).toFixed(0)}
                                  </span>
                                </td>
                                <td><b>{m.batting_runs}</b></td>
                                <td>{m.batting_balls}</td>
                                <td>{sr(m.batting_runs, m.batting_balls)}</td>
                                <td>{m.fours || 0}</td>
                                <td>{m.sixes || 0}</td>
                                <td className="pd-td-dismissal">{m.not_out ? <span className="pd-notout">NO</span> : 'out'}</td>
                                <td>{bowlOvers(m.bowling_balls)}</td>
                                <td>{m.bowling_runs}</td>
                                <td><b>{m.bowling_wickets}</b></td>
                                <td>{bowlEcon(m.bowling_runs, m.bowling_balls)}</td>
                                <td>{m.catches || 0}</td>
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
