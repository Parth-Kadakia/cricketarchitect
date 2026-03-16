import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import CountryLabel from '../components/CountryLabel';
import TeamNameButton from '../components/TeamNameButton';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { oversFromBalls, scoreLabel, setPageTitle } from '../utils/format';

const TABS = [
  { key: 'standings', label: 'Standings', icon: '🏆' },
  { key: 'stats', label: 'Stats Leaders', icon: '📊' },
  { key: 'knockouts', label: 'Knockouts', icon: '⚡' }
];

function MovementArrow({ value }) {
  const raw = String(value || '').toUpperCase();
  if (raw === 'PROMOTED') return <span className="lg-movement lg-movement--up">▲ Promoted</span>;
  if (raw === 'RELEGATED') return <span className="lg-movement lg-movement--down">▼ Relegated</span>;
  if (raw === 'STAY') return <span className="lg-movement lg-movement--none">—</span>;
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
  const { token } = useAuth();
  const { subscribe } = useSocket();

  const [tab, setTab] = useState('standings');
  const [seasons, setSeasons] = useState([]);
  const [seasonId, setSeasonId] = useState(null);
  const [table, setTable] = useState([]);
  const [summary, setSummary] = useState(null);
  const [seasonStats, setSeasonStats] = useState({ batting: [], bowling: [] });
  const [playoffFixtures, setPlayoffFixtures] = useState([]);
  const [finalFixtures, setFinalFixtures] = useState([]);
  const [expandedTiers, setExpandedTiers] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const shareRef = useRef(null);
  const seasonIdRef = useRef(null);
  const isInternational = String(summary?.season?.competition_mode || '').toUpperCase() === 'INTERNATIONAL';

  useEffect(() => { setPageTitle('League Table'); }, []);

  const tableByLeague = useMemo(() => {
    if (isInternational) {
      return table.length ? [{ tier: 1, rows: table }] : [];
    }
    return [...new Set((table || []).map((row) => Number(row.league_tier || 0)).filter((tier) => tier > 0))]
      .sort((a, b) => a - b)
      .map((tier) => ({
        tier,
        rows: (table || []).filter((row) => Number(row.league_tier) === tier)
      }))
      .filter((g) => g.rows.length > 0);
  }, [isInternational, table]);
  const maxTier = isInternational ? 1 : Number(summary?.season?.league_count || tableByLeague.length || 4);
  const tabs = useMemo(() => {
    if (!isInternational) {
      return TABS;
    }
    return (playoffFixtures.length || finalFixtures.length) ? TABS : TABS.filter((tabItem) => tabItem.key !== 'knockouts');
  }, [finalFixtures.length, isInternational, playoffFixtures.length]);

  const progressPct = useMemo(() => {
    if (!summary?.fixtures) return 0;
    const total = summary.fixtures.total_matches || 1;
    return Math.round((summary.fixtures.completed_matches / total) * 100);
  }, [summary]);

  useEffect(() => {
    seasonIdRef.current = seasonId;
  }, [seasonId]);

  async function loadSeasonStats(targetSeasonId) {
    if (!targetSeasonId) {
      setSeasonStats({ batting: [], bowling: [] });
      setStatsLoading(false);
      return;
    }
    const requestedSeasonId = Number(targetSeasonId);
    setStatsLoading(true);
    try {
      const statsResp = await api.league.seasonStats(token, requestedSeasonId);
      if (requestedSeasonId === Number(seasonIdRef.current)) {
        setSeasonStats(statsResp || { batting: [], bowling: [] });
      }
    } catch (e) {
      if (requestedSeasonId === Number(seasonIdRef.current)) {
        setSeasonStats({ batting: [], bowling: [] });
        setError(e.message);
      }
    } finally {
      if (requestedSeasonId === Number(seasonIdRef.current)) {
        setStatsLoading(false);
      }
    }
  }

  async function load(initial = false) {
    setError('');
    try {
      const seasonResponse = await api.league.seasons(token);
      const seasonRows = seasonResponse.seasons || [];
      setSeasons(seasonRows);
      const currentSeasonId = seasonId || seasonRows[0]?.id;
      setSeasonId(currentSeasonId);
      seasonIdRef.current = currentSeasonId;
      if (currentSeasonId) {
        const [tableResp, summaryResp, fixturesResp] = await Promise.all([
          api.league.table(token, currentSeasonId),
          api.league.seasonSummary(token, currentSeasonId),
          api.league.fixtures(token, currentSeasonId)
        ]);
        setTable(tableResp.table || []);
        setSummary(summaryResp || null);
        const fixtures = fixturesResp.fixtures || [];
        setPlayoffFixtures(fixtures.filter((f) => ['PLAYOFF', 'WORLD_CUP_QF', 'WORLD_CUP_SF'].includes(f.stage)));
        setFinalFixtures(fixtures.filter((f) => ['FINAL', 'WORLD_CUP_FINAL'].includes(f.stage)));
        void loadSeasonStats(currentSeasonId);
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
    seasonIdRef.current = nextId;
    setStatsLoading(true);
    try {
      const [tableResp, summaryResp, fixturesResp] = await Promise.all([
        api.league.table(token, nextId),
        api.league.seasonSummary(token, nextId),
        api.league.fixtures(token, nextId)
      ]);
      setTable(tableResp.table || []);
      setSummary(summaryResp || null);
      const fixtures = fixturesResp.fixtures || [];
      setPlayoffFixtures(fixtures.filter((f) => ['PLAYOFF', 'WORLD_CUP_QF', 'WORLD_CUP_SF'].includes(f.stage)));
      setFinalFixtures(fixtures.filter((f) => ['FINAL', 'WORLD_CUP_FINAL'].includes(f.stage)));
      void loadSeasonStats(nextId);
    } catch (e) { setError(e.message); }
  }

  function toggleTier(tier) {
    setExpandedTiers((prev) => ({ ...prev, [tier]: !prev[tier] }));
  }

  useEffect(() => {
    setExpandedTiers((prev) => {
      const next = { ...prev };
      for (const group of tableByLeague) {
        if (next[group.tier] == null) {
          next[group.tier] = true;
        }
      }
      return next;
    });
  }, [tableByLeague]);

  useEffect(() => {
    if (!tabs.find((tabItem) => tabItem.key === tab)) {
      setTab('standings');
    }
  }, [tab, tabs]);

  /* ── Close share dropdown on outside click ── */
  useEffect(() => {
    if (!shareOpen) return undefined;
    function handleClick(e) {
      if (shareRef.current && !shareRef.current.contains(e.target)) setShareOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [shareOpen]);

  /* ── League Table share helpers ── */

  function generateLeagueBBCode() {
    const seasonName = currentSeason?.name || (isInternational ? 'Global Rankings' : 'League');
    const ln = [];

    ln.push(`[size=5][b]${seasonName}[/b][/size]`);
    if (summary?.fixtures) {
      ln.push(`${summary.fixtures.completed_matches}/${summary.fixtures.total_matches} matches completed (${progressPct}%)`);
    }
    ln.push('');

    for (const group of tableByLeague) {
      ln.push(`[size=4][b]${isInternational ? 'Global Rankings' : `League ${group.tier}`}[/b][/size]`);
      ln.push('');
      ln.push('[table]');
      ln.push('[tr][th]#[/th][th]Franchise[/th][th]City[/th][th]P[/th][th]W[/th][th]L[/th][th]T[/th][th]Pts[/th][th]NRR[/th][/tr]');

      for (const row of group.rows) {
        const pos = Number(row.league_position);
        const isLeader = pos === 1;
        const nrr = Number(row.net_run_rate || 0);
        const nrrStr = (nrr >= 0 ? '+' : '') + nrr.toFixed(3);
        const name = row.franchise_name + (row.country ? ` (${row.country})` : '');
        const nameCell = isLeader ? `[b][color=green]${name}[/color][/b]` : name;
        const ptsCell = isLeader ? `[b]${row.points}[/b]` : String(row.points);
        const nrrCell = nrr > 0 ? `[color=green]${nrrStr}[/color]` : nrr < 0 ? `[color=red]${nrrStr}[/color]` : nrrStr;

        ln.push(`[tr][td]${pos}[/td][td]${nameCell}[/td][td]${row.city || '-'}[/td][td]${row.played}[/td][td]${row.won}[/td][td]${row.lost}[/td][td]${row.tied}[/td][td]${ptsCell}[/td][td]${nrrCell}[/td][/tr]`);
      }

      ln.push('[/table]');
      ln.push('');
    }

    ln.push('[i]Generated by Cricket Architect[/i]');
    return ln.join('\n');
  }

  async function copyLeagueBBCode() {
    const text = generateLeagueBBCode();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
    setShareOpen(false);
  }

  function generateStatsLeadersBBCode() {
    const seasonName = currentSeason?.name || (isInternational ? 'Global Rankings' : 'League');
    const battingRows = (seasonStats?.batting || []).slice(0, 12);
    const bowlingRows = (seasonStats?.bowling || []).slice(0, 12);
    const ln = [];

    ln.push(`[size=5][b]${seasonName} Stats Leaders[/b][/size]`);
    ln.push('');

    ln.push('[size=4][b]Top Batters[/b][/size]');
    if (!battingRows.length) {
      ln.push('No batting stats yet.');
    } else {
      ln.push('[table]');
      ln.push('[tr][th]#[/th][th]Player[/th][th]Team[/th][th]Runs[/th][th]Inns[/th][th]SR[/th][th]4s[/th][th]6s[/th][/tr]');
      battingRows.forEach((p, i) => {
        ln.push(
          `[tr][td]${i + 1}[/td][td]${p.first_name} ${p.last_name}[/td][td]${p.franchise_name}[/td][td]${p.runs}[/td][td]${p.innings}[/td][td]${Number(p.strike_rate || 0).toFixed(1)}[/td][td]${p.fours}[/td][td]${p.sixes}[/td][/tr]`
        );
      });
      ln.push('[/table]');
    }
    ln.push('');

    ln.push('[size=4][b]Top Bowlers[/b][/size]');
    if (!bowlingRows.length) {
      ln.push('No bowling stats yet.');
    } else {
      ln.push('[table]');
      ln.push('[tr][th]#[/th][th]Player[/th][th]Team[/th][th]Wkts[/th][th]Overs[/th][th]Econ[/th][th]Maidens[/th][th]Runs[/th][/tr]');
      bowlingRows.forEach((p, i) => {
        ln.push(
          `[tr][td]${i + 1}[/td][td]${p.first_name} ${p.last_name}[/td][td]${p.franchise_name}[/td][td]${p.wickets}[/td][td]${oversFromBalls(p.balls)}[/td][td]${Number(p.economy || 0).toFixed(1)}[/td][td]${p.maidens}[/td][td]${p.runs_conceded}[/td][/tr]`
        );
      });
      ln.push('[/table]');
    }

    ln.push('');
    ln.push('[i]Generated by Cricket Architect[/i]');
    return ln.join('\n');
  }

  async function copyStatsLeadersBBCode() {
    const text = generateStatsLeadersBBCode();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  }

  function downloadLeaguePNG() {
    setShareOpen(false);
    if (!tableByLeague.length) return;

    const DPR = 2;
    const COL = {
      bg: '#FAF8F4', surface: '#FFFFFF', border: '#E5E0D8',
      ink: '#2C2C2C', muted: '#8C8578', leaf: '#3E7F45',
      accent: '#FFAE47', danger: '#CC3737', cream: '#F2EDE4',
      promoGreen: 'rgba(62,127,69,0.08)', relegRed: 'rgba(204,55,55,0.06)',
    };
    const FONT = (w, s) => `${w} ${s}px "Space Grotesk", "SF Pro Display", system-ui, sans-serif`;
    const BODY = (w, s) => `${w} ${s}px "Barlow", "SF Pro Text", system-ui, sans-serif`;

    const PAD = 28;
    const W = 820;
    const HEADER_H = 56;
    const TIER_HEADER_H = 32;
    const ROW_H = 24;
    const FOOTER_H = 28;
    const TABLE_HEADER_H = 22;

    // Calculate height
    let totalH = PAD + HEADER_H + 12;
    for (const group of tableByLeague) {
      totalH += TIER_HEADER_H + TABLE_HEADER_H + group.rows.length * ROW_H + 16;
    }
    totalH += FOOTER_H + PAD;

    const canvas = document.createElement('canvas');
    canvas.width = W * DPR;
    canvas.height = totalH * DPR;
    const ctx = canvas.getContext('2d');
    ctx.scale(DPR, DPR);

    // Background
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, W, totalH);

    const rrect = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };

    const contentW = W - PAD * 2;
    let y = PAD;

    // ── HEADER ──
    const seasonName = currentSeason?.name || (isInternational ? 'Global Rankings' : 'League');
    rrect(PAD, y, contentW, HEADER_H, 10);
    ctx.fillStyle = COL.leaf;
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.font = FONT('700', 18);
    ctx.fillStyle = '#fff';
    ctx.fillText(seasonName, W / 2, y + 24);
    ctx.font = BODY('400', 11);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    const progressText = summary?.fixtures
      ? `${summary.fixtures.completed_matches}/${summary.fixtures.total_matches} matches (${progressPct}%)`
      : `${table.length} teams`;
    ctx.fillText(progressText, W / 2, y + 42);
    y += HEADER_H + 12;

    // Column positions
    const cols = [
      { label: '#', x: PAD + 8, align: 'center', w: 24 },
      { label: isInternational ? 'TEAM' : 'FRANCHISE', x: PAD + 36, align: 'left', w: 260 },
      { label: isInternational ? 'COUNTRY' : 'CITY', x: PAD + 300, align: 'left', w: 120 },
      { label: 'P', x: PAD + 430, align: 'right' },
      { label: 'W', x: PAD + 470, align: 'right' },
      { label: 'L', x: PAD + 510, align: 'right' },
      { label: 'T', x: PAD + 550, align: 'right' },
      { label: 'PTS', x: PAD + 600, align: 'right' },
      { label: 'NRR', x: PAD + 680, align: 'right' },
    ];

    // ── PER TIER ──
    for (const group of tableByLeague) {
      const rowCount = group.rows.length;

      // Tier header
      ctx.textAlign = 'left';
      ctx.font = FONT('700', 12);
      ctx.fillStyle = COL.leaf;
      ctx.fillText(isInternational ? 'Global Rankings' : `League ${group.tier}`, PAD + 4, y + 20);
      ctx.strokeStyle = COL.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD, y + TIER_HEADER_H - 4);
      ctx.lineTo(PAD + contentW, y + TIER_HEADER_H - 4);
      ctx.stroke();
      y += TIER_HEADER_H;

      // Table header row
      ctx.fillStyle = COL.cream;
      ctx.fillRect(PAD, y, contentW, TABLE_HEADER_H);
      ctx.font = FONT('700', 8);
      ctx.fillStyle = COL.muted;
      for (const col of cols) {
        ctx.textAlign = col.align;
        ctx.fillText(col.label, col.x, y + 15);
      }
      y += TABLE_HEADER_H;

      // Data rows
      for (let i = 0; i < group.rows.length; i++) {
        const row = group.rows[i];
        const pos = Number(row.league_position);
        const isLeader = pos === 1;
        const isPromo = pos <= 2 && group.tier > 1;
        const isReleg = pos >= rowCount - 1 && group.tier < maxTier;
        const nrr = Number(row.net_run_rate || 0);
        const nrrStr = (nrr >= 0 ? '+' : '') + nrr.toFixed(3);

        // Row bg
        if (isLeader) {
          ctx.fillStyle = COL.promoGreen;
          ctx.fillRect(PAD, y, contentW, ROW_H);
        } else if (isPromo) {
          ctx.fillStyle = 'rgba(62,127,69,0.04)';
          ctx.fillRect(PAD, y, contentW, ROW_H);
        } else if (isReleg) {
          ctx.fillStyle = COL.relegRed;
          ctx.fillRect(PAD, y, contentW, ROW_H);
        } else if (i % 2 === 0) {
          ctx.fillStyle = COL.surface;
          ctx.fillRect(PAD, y, contentW, ROW_H);
        }

        // Row divider
        ctx.strokeStyle = COL.border;
        ctx.lineWidth = 0.4;
        ctx.beginPath();
        ctx.moveTo(PAD, y + ROW_H);
        ctx.lineTo(PAD + contentW, y + ROW_H);
        ctx.stroke();

        // Position
        ctx.textAlign = 'center';
        ctx.font = FONT('700', 10);
        ctx.fillStyle = isLeader ? COL.leaf : COL.ink;
        ctx.fillText(String(pos), cols[0].x + 10, y + 16);

        // Franchise name + country
        ctx.textAlign = 'left';
        ctx.font = BODY(isLeader ? '700' : '600', 10);
        ctx.fillStyle = isLeader ? COL.leaf : COL.ink;
        const nameStr = row.franchise_name + (row.country ? `  (${row.country})` : '');
        ctx.fillText(nameStr.length > 36 ? nameStr.slice(0, 34) + '…' : nameStr, cols[1].x, y + 16);

        // City
        ctx.font = BODY('400', 9);
        ctx.fillStyle = COL.muted;
        const city = isInternational ? (row.country || '-') : (row.city || '-');
        ctx.fillText(city.length > 16 ? city.slice(0, 14) + '…' : city, cols[2].x, y + 16);

        // P, W, L, T
        ctx.font = FONT('600', 10);
        ctx.textAlign = 'right';
        ctx.fillStyle = COL.ink;
        ctx.fillText(String(row.played), cols[3].x, y + 16);
        ctx.font = FONT('700', 10);
        ctx.fillText(String(row.won), cols[4].x, y + 16);
        ctx.font = FONT('600', 10);
        ctx.fillStyle = COL.muted;
        ctx.fillText(String(row.lost), cols[5].x, y + 16);
        ctx.fillText(String(row.tied), cols[6].x, y + 16);

        // Pts
        ctx.font = FONT('800', 10);
        ctx.fillStyle = isLeader ? COL.leaf : COL.ink;
        ctx.fillText(String(row.points), cols[7].x, y + 16);

        // NRR
        ctx.font = FONT('600', 9);
        ctx.fillStyle = nrr > 0 ? COL.leaf : nrr < 0 ? COL.danger : COL.muted;
        ctx.fillText(nrrStr, cols[8].x, y + 16);

        y += ROW_H;
      }

      y += 16;
    }

    // Footer
    ctx.textAlign = 'center';
    ctx.font = BODY('400', 9);
    ctx.fillStyle = COL.muted;
    ctx.fillText('Cricket Architect', W / 2, y + 14);

    // Download
    const sName = (currentSeason?.name || 'league').replace(/\s+/g, '-').toLowerCase();
    const link = document.createElement('a');
    link.download = `league-table-${sName}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
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
          {isInternational && (
            <span className="lg-header-teams">
              {summary?.season?.current_phase || 'FTP'} • {summary?.season?.calendar_date || '—'}
            </span>
          )}
          {/* Share dropdown */}
          <div className="lg-share-wrap" ref={shareRef}>
            <button type="button" className="lg-share-btn" onClick={() => setShareOpen((prev) => !prev)} title="Share league table">
              📋 Share
            </button>
            {shareOpen && (
              <div className="lg-share-dropdown">
                <button className="lg-share-option" onClick={downloadLeaguePNG}>
                  🖼️ Download as PNG
                  <span className="lg-share-hint">Image for social media</span>
                </button>
                <button className="lg-share-option" onClick={copyLeagueBBCode}>
                  📋 Copy as BB Code
                  <span className="lg-share-hint">Forums (phpBB, XenForo)</span>
                </button>
              </div>
            )}
            {shareCopied && <span className="lg-share-copied">✓ Copied!</span>}
          </div>
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
        {tabs.map((t) => (
          <button key={t.key} type="button" className={`sq-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            <span className="sq-tab-icon">{t.icon}</span>{t.label}
          </button>
        ))}
      </nav>

      {/* ═══ STANDINGS TAB ═══ */}
      {tab === 'standings' && (
        <div className="sq-tab-content">
          <p className="lg-info-text">
            {isInternational
              ? 'International mode uses one global ranking table across the full FTP cycle. The top 32 teams qualify for the World Cup at the end of Year 4.'
              : 'League winners qualify for semifinals. Bottom-two and top-two movement applies between tiers each season.'}
          </p>
          {tableByLeague.map((group) => {
            const expanded = expandedTiers[group.tier];
            const rowCount = group.rows.length;
            return (
              <section key={`tier-${group.tier}`} className="lg-tier-section">
                <button type="button" className="lg-tier-header" onClick={() => toggleTier(group.tier)}>
                  <div className="lg-tier-header-left">
                    <span className={`lg-tier-badge lg-tier-badge--${group.tier}`}>{group.tier}</span>
                    <h3>{isInternational ? 'Global Rankings' : `League ${group.tier}`}</h3>
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
                            <th>{isInternational ? 'Team' : 'Franchise'}</th>
                            {!isInternational && <th>City</th>}
                            <th className="lg-th-num">P</th>
                            <th className="lg-th-num">W</th>
                            <th className="lg-th-num">L</th>
                            <th className="lg-th-num">T</th>
                            <th className="lg-th-num">Pts</th>
                            <th className="lg-th-nrr">NRR</th>
                            {!isInternational && <th className="lg-th-num">Move</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.map((row, i) => {
                            const pos = Number(row.league_position || row.position || i + 1);
                            const isPromo = !isInternational && pos <= 2 && group.tier > 1;
                            const isRelegation = !isInternational && pos >= rowCount - 1 && group.tier < maxTier;
                            const isLeader = pos === 1;
                            const zoneCls = isLeader ? 'leader' : isPromo ? 'promo' : isRelegation ? 'releg' : '';
                            return (
                              <tr key={row.franchise_id || i} className={`lg-table-row ${zoneCls ? `lg-zone--${zoneCls}` : ''}`}>
                                <td className="lg-td-pos">
                                  <span className={`lg-pos-badge ${zoneCls ? `lg-pos--${zoneCls}` : ''}`}>{pos}</span>
                                </td>
                                <td className="lg-td-name">
                                  <div className="lg-team-with-flag">
                                    {isInternational && row.country && <CountryLabel country={row.country} className="lg-team-flag" showName={false} />}
                                    <TeamNameButton
                                      franchiseId={row.franchise_id}
                                      name={row.franchise_name}
                                      country={row.country}
                                      city={row.city}
                                      className="lg-team-link"
                                    >
                                      {row.franchise_name}
                                    </TeamNameButton>
                                    {!isInternational && row.country && <CountryLabel country={row.country} className="lg-country-tag" />}
                                  </div>
                                </td>
                                {!isInternational && <td className="lg-td-city">{row.city || '-'}</td>}
                                <td className="lg-th-num">{row.played}</td>
                                <td className="lg-th-num"><strong>{row.won}</strong></td>
                                <td className="lg-th-num">{row.lost}</td>
                                <td className="lg-th-num">{row.tied}</td>
                                <td className="lg-td-pts"><strong>{row.points}</strong></td>
                                <td><NrrBadge value={row.net_run_rate} /></td>
                                {!isInternational && <td><MovementArrow value={row.movement} /></td>}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {!isInternational && (
                      <div className="lg-zone-legend">
                        {group.tier > 1 && <span className="lg-legend-item lg-legend--promo">● Promotion Zone</span>}
                        {group.tier < maxTier && <span className="lg-legend-item lg-legend--releg">● Relegation Zone</span>}
                        <span className="lg-legend-item lg-legend--leader">● League Leader</span>
                      </div>
                    )}
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
          <div className="lg-leaderboard-toolbar">
            <div className="lg-leaderboard-toolbar-copy">
              <strong>Stats Leaders</strong>
              <span>Top batting and bowling leaders for the selected season.</span>
            </div>
            <button type="button" className="lg-share-btn" onClick={copyStatsLeadersBBCode} disabled={statsLoading}>
              📋 Copy Leaders BB Code
            </button>
          </div>
          <div className="lg-stats-split">
            {/* Batting Leaderboard */}
            <section className="lg-leaderboard">
              <div className="lg-leaderboard-header">
                <h3>🏏 Top Batters</h3>
              </div>
              {statsLoading ? (
                <div className="sq-empty">Loading batting leaders...</div>
              ) : (seasonStats?.batting || []).length === 0 ? (
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
              {statsLoading ? (
                <div className="sq-empty">Loading bowling leaders...</div>
              ) : (seasonStats?.bowling || []).length === 0 ? (
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
              <h3>{isInternational ? 'World Cup Knockouts' : 'Semifinals'}</h3>
              <span className="lg-ko-count">{playoffFixtures.length} match{playoffFixtures.length !== 1 ? 'es' : ''}</span>
            </div>
            {playoffFixtures.length === 0 ? (
              <div className="sq-empty">{isInternational ? 'No World Cup knockout fixtures for this cycle yet.' : 'No playoff fixtures for this season.'}</div>
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
                        <CountryLabel country={f.home_country} className="lg-match-country" />
                        <span className="lg-match-score">{scoreLabel(f.home_score, f.home_wickets, f.home_balls)}</span>
                      </div>
                      <span className="lg-match-vs">vs</span>
                      <div className="lg-match-team lg-match-team--away">
                        <TeamNameButton franchiseId={f.away_franchise_id} name={f.away_franchise_name} country={f.away_country} className="lg-team-link">
                          {f.away_franchise_name}
                        </TeamNameButton>
                        <CountryLabel country={f.away_country} className="lg-match-country" />
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
              <h3>{isInternational ? '🏆 World Cup Final' : '🏆 Final'}</h3>
            </div>
            {finalFixtures.length === 0 ? (
              <div className="sq-empty">{isInternational ? 'No World Cup final fixture for this cycle yet.' : 'No final fixture for this season.'}</div>
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
                        <CountryLabel country={f.home_country} className="lg-match-country" />
                        <span className="lg-match-score">{scoreLabel(f.home_score, f.home_wickets, f.home_balls)}</span>
                      </div>
                      <span className="lg-match-vs">vs</span>
                      <div className="lg-match-team lg-match-team--away">
                        <TeamNameButton franchiseId={f.away_franchise_id} name={f.away_franchise_name} country={f.away_country} className="lg-team-link">
                          {f.away_franchise_name}
                        </TeamNameButton>
                        <CountryLabel country={f.away_country} className="lg-match-country" />
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
