import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import TeamNameButton from '../components/TeamNameButton';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { oversFromBalls, scoreLabel, setPageTitle } from '../utils/format';

function roundStatus(round) {
  if (Number(round.completed_matches) === Number(round.total_matches)) return 'completed';
  if (Number(round.completed_matches) > 0) return 'in-progress';
  return 'pending';
}

function createSimulationOperationId(prefix = 'sim') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function battingOrder(row) {
  const homeId = Number(row.home_franchise_id || 0);
  const awayId = Number(row.away_franchise_id || 0);
  const tossWinnerId = Number(row.toss_winner_franchise_id || 0);
  const tossDecision = String(row.toss_decision || '').toUpperCase();
  if (!tossWinnerId || !tossDecision) return null;
  const first = tossDecision === 'BAT' ? tossWinnerId : (tossWinnerId === homeId ? awayId : homeId);
  return { homeBattedFirst: first === homeId };
}

function teamSnap(row, side) {
  const isHome = side === 'home';
  return {
    id: Number(isHome ? row.home_franchise_id : row.away_franchise_id) || 0,
    name: (isHome ? row.home_franchise_name : row.away_franchise_name) || (isHome ? 'Home' : 'Away'),
    country: (isHome ? row.home_country : row.away_country) || '',
    ovr: Number(isHome ? row.home_avg_overall : row.away_avg_overall) || 0,
    score: isHome ? row.home_score : row.away_score,
    wickets: isHome ? row.home_wickets : row.away_wickets,
    balls: isHome ? row.home_balls : row.away_balls,
  };
}

/* ── Main component ── */

export default function FixturesResultsPage() {
  const { token, franchise } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { subscribe } = useSocket();

  const [tab, setTab] = useState('regular');
  const [seasons, setSeasons] = useState([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState(Number(searchParams.get('season') || 0) || null);
  const [rounds, setRounds] = useState([]);
  const [selectedRound, setSelectedRound] = useState(Number(searchParams.get('round') || 0) || null);
  const [selectedLeagueTier, setSelectedLeagueTier] = useState(Number(searchParams.get('league') || 0) || 0);
  const [fixtures, setFixtures] = useState([]);
  const [allFixtures, setAllFixtures] = useState([]);
  const [simulatingAction, setSimulatingAction] = useState(false);
  const [activeSimulation, setActiveSimulation] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [roundShareOpen, setRoundShareOpen] = useState(null);
  const [roundShareCopied, setRoundShareCopied] = useState(false);
  const shareRef = useRef(null);

  useEffect(() => { setPageTitle('Fixtures & Results'); }, []);

  /* ── Data helpers ── */

  function filterRoundFixtures(allRows, roundNo, leagueTier = 0) {
    return (allRows || []).filter(
      (fixture) =>
        fixture.stage === 'REGULAR' &&
        Number(fixture.round_no) === Number(roundNo) &&
        (!leagueTier || Number(fixture.league_tier) === Number(leagueTier))
    );
  }

  function syncQueryParams(sId, roundNo, leagueTier) {
    const next = {};
    if (sId) next.season = String(sId);
    if (roundNo) next.round = String(roundNo);
    if (leagueTier) next.league = String(leagueTier);
    setSearchParams(next, { replace: true });
  }

  async function loadSeason(nextSeasonId = null, nextRound = null) {
    setError('');
    setLoading(true);
    try {
      const seasonResponse = await api.league.seasons(token);
      const seasonRows = seasonResponse.seasons || [];
      setSeasons(seasonRows);
      const querySeason = Number(searchParams.get('season') || 0) || null;
      const requestedSeason = nextSeasonId || selectedSeasonId || querySeason;
      const resolvedSeason = (requestedSeason && seasonRows.find((s) => Number(s.id) === Number(requestedSeason))) || seasonRows[0] || null;
      if (!resolvedSeason?.id) {
        setSelectedSeasonId(null); setRounds([]); setFixtures([]); setAllFixtures([]); setSelectedRound(null);
        syncQueryParams(null, null, null); return;
      }
      const sId = Number(resolvedSeason.id);
      setSelectedSeasonId(sId);
      const [roundsResp, allFixResp] = await Promise.all([api.league.rounds(token, sId), api.league.fixtures(token, sId)]);
      const roundRows = roundsResp.rounds || [];
      const fixtureRows = allFixResp.fixtures || [];
      setRounds(roundRows);
      setAllFixtures(fixtureRows);
      const queryRound = Number(searchParams.get('round') || 0);
      const firstPending = roundRows.find((r) => Number(r.completed_matches) < Number(r.total_matches))?.round_no;
      const fallbackRound = firstPending || roundRows[0]?.round_no || null;
      const resolvedRoundCandidate = nextRound || selectedRound || queryRound || fallbackRound;
      const resolvedRound = resolvedRoundCandidate && roundRows.some((r) => Number(r.round_no) === Number(resolvedRoundCandidate))
        ? Number(resolvedRoundCandidate) : fallbackRound || null;
      setSelectedRound(resolvedRound);
      setFixtures(filterRoundFixtures(fixtureRows, resolvedRound, selectedLeagueTier));
      syncQueryParams(sId, resolvedRound, selectedLeagueTier);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function changeRound(roundNo) {
    if (!roundNo || !seasonId) return;
    setError('');
    setSelectedRound(roundNo);
    setFixtures(filterRoundFixtures(allFixtures, roundNo, selectedLeagueTier));
    syncQueryParams(selectedSeasonId, roundNo, selectedLeagueTier);
  }

  async function changeSeason(sId) {
    if (!sId) return;
    setSelectedSeasonId(sId);
    await loadSeason(sId, null);
  }

  function isManagedFixture(row) {
    const managedId = Number(franchise?.id || 0);
    if (!managedId) return false;
    return managedId === Number(row.home_franchise_id || 0) || managedId === Number(row.away_franchise_id || 0);
  }

  async function refreshCurrentSeasonData() {
    const currentSId = Number(selectedSeasonId || 0);
    if (!currentSId) return;
    const [roundsResp, allFixResp] = await Promise.all([api.league.rounds(token, currentSId), api.league.fixtures(token, currentSId)]);
    const roundRows = roundsResp.rounds || [];
    const fixtureRows = allFixResp.fixtures || [];
    setRounds(roundRows);
    setAllFixtures(fixtureRows);
    setFixtures(filterRoundFixtures(fixtureRows, selectedRound, selectedLeagueTier));
  }

  async function simulateFixtureWithoutOpening(row) {
    if (!token) { setError('Please log in to simulate fixtures.'); return; }
    const operationId = createSimulationOperationId('fixture');
    const isRegularRound = String(row.stage || '').toUpperCase() === 'REGULAR';
    const pendingInRound = isRegularRound
      ? (allFixtures || []).filter((f) => String(f.stage || '').toUpperCase() === 'REGULAR' && Number(f.round_no) === Number(row.round_no) && Number(f.league_tier) === Number(row.league_tier) && String(f.status || '').toUpperCase() !== 'COMPLETED').length
      : 1;
    try {
      setError(''); setSimulatingAction(true);
      setActiveSimulation({ operationId, rowId: Number(row.id), label: isRegularRound ? `Simulating L${Number(row.league_tier)} R${Number(row.round_no)}` : 'Simulating Match', phase: 'start', completed: 0, total: Math.max(1, pendingInRound) });
      if (isRegularRound) {
        const result = await api.league.simulateLeagueRound(token, { seasonId: selectedSeasonId, roundNo: row.round_no, leagueTier: row.league_tier, operationId });
        setActiveSimulation((prev) => prev?.operationId === operationId ? { ...prev, phase: 'complete', completed: Number(result.simulated || prev.completed || 0), total: Number(prev.total || result.totalMatches || result.simulated || 0) } : prev);
      } else {
        await api.league.simulateInstant(token, row.id, { operationId, useExternalFullMatchApi: true });
        setActiveSimulation((prev) => prev?.operationId === operationId ? { ...prev, phase: 'complete', completed: 1, total: 1 } : prev);
      }
      await refreshCurrentSeasonData();
    } catch (e) { setError(e.message); setActiveSimulation((prev) => (prev?.operationId === operationId ? null : prev)); }
    finally { setSimulatingAction(false); }
  }

  async function resetStuckMatch(matchId) {
    if (!token || !matchId) return;
    try {
      setError('');
      await api.league.resetMatch(token, matchId);
      await refreshCurrentSeasonData();
    } catch (e) { setError(e.message); }
  }

  async function simulateMyLeagueRoundNow() {
    if (!token) { setError('Please log in to simulate your league round.'); return; }
    const operationId = createSimulationOperationId('my-league');
    try {
      setError(''); setSimulatingAction(true);
      setActiveSimulation({ operationId, rowId: null, label: 'Simulating My League Round', phase: 'start', completed: 0, total: 0 });
      const result = await api.league.simulateMyLeagueRound(token, { operationId });
      setActiveSimulation((prev) => prev?.operationId === operationId ? { ...prev, phase: 'complete', completed: Number(result.simulated || prev.completed || 0), total: Number(prev.total || result.totalMatches || result.simulated || 0) } : prev);
      await refreshCurrentSeasonData();
    } catch (e) { setError(e.message); setActiveSimulation((prev) => (prev?.operationId === operationId ? null : prev)); }
    finally { setSimulatingAction(false); }
  }

  useEffect(() => { loadSeason(); }, []);

  useEffect(() => {
    const offLeagueUpdate = subscribe('league:update', async (msg) => {
      const sSeason = Number(msg.payload?.seasonId || 0);
      const cur = Number(selectedSeasonId || 0);
      if (!sSeason || !cur || sSeason !== cur) return;
      try {
        const [rResp, fResp] = await Promise.all([api.league.rounds(token, cur), api.league.fixtures(token, cur)]);
        setRounds(rResp.rounds || []);
        const fix = fResp.fixtures || [];
        setAllFixtures(fix);
        setFixtures(filterRoundFixtures(fix, selectedRound, selectedLeagueTier));
      } catch { /* ignore */ }
    });

    const offProgress = subscribe('league:simulation_progress', (msg) => {
      const payload = msg.payload || {};
      const opId = String(payload.operationId || '').trim();
      if (!opId) return;
      setActiveSimulation((prev) => {
        if (!prev || String(prev.operationId) !== opId) return prev;
        return { ...prev, phase: payload.phase || prev.phase, completed: Number(payload.completed ?? prev.completed ?? 0), total: Number(payload.total ?? prev.total ?? 0) };
      });
    });

    return () => { offLeagueUpdate(); offProgress(); };
  }, [subscribe, selectedSeasonId, selectedRound, selectedLeagueTier]);

  useEffect(() => {
    if (!activeSimulation || activeSimulation.phase !== 'complete') return undefined;
    const timer = window.setTimeout(() => { setActiveSimulation((prev) => (prev?.phase === 'complete' ? null : prev)); }, 2200);
    return () => window.clearTimeout(timer);
  }, [activeSimulation]);

  /* ── Derived data ── */

  const seasonMeta = useMemo(() => seasons.find((s) => Number(s.id) === Number(selectedSeasonId)) || null, [seasons, selectedSeasonId]);
  const seasonId = selectedSeasonId;
  const isInternationalSeason = String(seasonMeta?.competition_mode || '').toUpperCase() === 'INTERNATIONAL';
  const playoffFixtures = useMemo(() => (allFixtures || []).filter((f) => f.stage === 'PLAYOFF'), [allFixtures]);
  const finalFixtures = useMemo(() => (allFixtures || []).filter((f) => f.stage === 'FINAL'), [allFixtures]);
  const roundFixturesByLeague = useMemo(
    () =>
      [...new Set((fixtures || []).map((f) => Number(f.league_tier || 0)).filter((tier) => tier > 0))]
        .sort((a, b) => a - b)
        .map((tier) => ({ tier, rows: (fixtures || []).filter((f) => Number(f.league_tier) === tier) })),
    [fixtures]
  );
  const leagueTierFilters = useMemo(
    () => [0, ...new Set((allFixtures || []).map((f) => Number(f.league_tier || 0)).filter((tier) => tier > 0))].sort((a, b) => a - b),
    [allFixtures]
  );

  const earliestIncompleteRoundByLeague = useMemo(() => {
    const map = new Map();
    for (const f of allFixtures || []) {
      if (String(f.stage || '').toUpperCase() !== 'REGULAR') continue;
      if (String(f.status || '').toUpperCase() === 'COMPLETED') continue;
      const tier = Number(f.league_tier || 0);
      const round = Number(f.round_no || 0);
      if (!tier || !round) continue;
      const current = Number(map.get(tier) || 0);
      if (!current || round < current) map.set(tier, round);
    }
    return map;
  }, [allFixtures]);

  function isFutureRoundBlocked(row) {
    if (String(row.stage || '').toUpperCase() !== 'REGULAR') return false;
    const firstOpenRound = Number(earliestIncompleteRoundByLeague.get(Number(row.league_tier || 0)) || 0);
    if (!firstOpenRound) return false;
    return Number(row.round_no || 0) > firstOpenRound;
  }

  const activeSimulationPercent = useMemo(() => {
    const done = Number(activeSimulation?.completed || 0);
    const total = Number(activeSimulation?.total || 0);
    if (!total) return 0;
    return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
  }, [activeSimulation]);

  const selectedRoundIndex = useMemo(() => rounds.findIndex((r) => Number(r.round_no) === Number(selectedRound)), [rounds, selectedRound]);

  const completedRounds = useMemo(() => rounds.filter((r) => Number(r.completed_matches) === Number(r.total_matches)).length, [rounds]);
  const currentRoundMeta = useMemo(() => rounds.find((r) => Number(r.round_no) === Number(selectedRound)) || null, [rounds, selectedRound]);
  const previousRound = selectedRoundIndex > 0 ? rounds[selectedRoundIndex - 1]?.round_no : null;
  const nextRound = selectedRoundIndex >= 0 && selectedRoundIndex < rounds.length - 1 ? rounds[selectedRoundIndex + 1]?.round_no : null;

  function changeLeagueFilter(nextTier) {
    setSelectedLeagueTier(nextTier);
    setFixtures(filterRoundFixtures(allFixtures, selectedRound, nextTier));
    syncQueryParams(selectedSeasonId, selectedRound, nextTier);
  }

  /* ── Close share dropdown on outside click ── */
  useEffect(() => {
    if (roundShareOpen === null) return undefined;
    function handleClick(e) {
      if (shareRef.current && !shareRef.current.contains(e.target)) setRoundShareOpen(null);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [roundShareOpen]);

  /* ── Round share helpers ── */

  function getRoundMatchesForShare(roundNo) {
    return (allFixtures || []).filter(
      (f) => String(f.stage || '').toUpperCase() === 'REGULAR' && Number(f.round_no) === Number(roundNo)
    );
  }

  function generateRoundBBCode(roundNo) {
    const matches = getRoundMatchesForShare(roundNo);
    const seasonName = seasonMeta?.name || `Season ${selectedSeasonId}`;
    const ln = [];

    ln.push(`[size=5][b]${seasonName} — Round ${roundNo}[/b][/size]`);
    ln.push('');

    // Group by league tier
    const tiers = [...new Set(matches.map((f) => Number(f.league_tier || 0)))].sort((a, b) => a - b);

    for (const tier of tiers) {
      const tierMatches = matches.filter((f) => Number(f.league_tier) === tier);
      ln.push(`[size=4][b]League ${tier}[/b][/size]`);
      ln.push('');
      ln.push('[table]');
      ln.push('[tr][th]Home[/th][th]Score[/th][th][/th][th]Score[/th][th]Away[/th][th]Result[/th][/tr]');

      for (const row of tierMatches) {
        const home = teamSnap(row, 'home');
        const away = teamSnap(row, 'away');
        const status = String(row.status || '').toUpperCase();
        const completed = status === 'COMPLETED';
        const winnerId = Number(row.winner_franchise_id || 0);

        const homeScore = completed ? scoreLabel(home.score, home.wickets, home.balls) : '-';
        const awayScore = completed ? scoreLabel(away.score, away.wickets, away.balls) : '-';
        const homeName = winnerId === home.id ? `[b][color=green]${home.name}[/color][/b]` : home.name;
        const awayName = winnerId === away.id ? `[b][color=green]${away.name}[/color][/b]` : away.name;

        let result = 'Scheduled';
        if (completed && winnerId === home.id) result = `[color=green]${home.name} won[/color]`;
        else if (completed && winnerId === away.id) result = `[color=green]${away.name} won[/color]`;
        else if (completed && !winnerId) result = 'Tied';

        ln.push(`[tr][td]${homeName} (${home.country})[/td][td]${homeScore}[/td][td]vs[/td][td]${awayScore}[/td][td]${awayName} (${away.country})[/td][td]${result}[/td][/tr]`);
      }

      ln.push('[/table]');
      ln.push('');
    }

    ln.push('[i]Generated by Cricket Architect[/i]');
    return ln.join('\n');
  }

  async function copyRoundBBCode(roundNo) {
    const text = generateRoundBBCode(roundNo);
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
    setRoundShareCopied(true);
    setTimeout(() => setRoundShareCopied(false), 2000);
    setRoundShareOpen(null);
  }

  function downloadRoundPNG(roundNo) {
    setRoundShareOpen(null);
    const matches = getRoundMatchesForShare(roundNo);
    if (!matches.length) return;

    const DPR = 2;
    const COL = {
      bg: '#FAF8F4', surface: '#FFFFFF', border: '#E5E0D8',
      ink: '#2C2C2C', muted: '#8C8578', leaf: '#3E7F45',
      accent: '#FFAE47', danger: '#CC3737', cream: '#F2EDE4',
    };
    const FONT = (w, s) => `${w} ${s}px "Space Grotesk", "SF Pro Display", system-ui, sans-serif`;
    const BODY = (w, s) => `${w} ${s}px "Barlow", "SF Pro Text", system-ui, sans-serif`;

    // Layout constants
    const PAD = 28;
    const CARD_W = 164;
    const CARD_H = 110;
    const CARD_GAP = 12;
    const COLS = 5;
    const HEADER_H = 56;
    const TIER_HEADER_H = 32;
    const FOOTER_H = 28;

    // Group by tier
    const tiers = [...new Set(matches.map((f) => Number(f.league_tier || 0)))].sort((a, b) => a - b);
    const tierGroups = tiers.map((tier) => ({
      tier,
      rows: matches.filter((f) => Number(f.league_tier) === tier),
    }));

    // Calculate canvas size
    const gridWidth = COLS * CARD_W + (COLS - 1) * CARD_GAP;
    const W = gridWidth + PAD * 2;
    let totalH = PAD + HEADER_H + 12;
    for (const group of tierGroups) {
      const rowCount = Math.ceil(group.rows.length / COLS);
      totalH += TIER_HEADER_H + rowCount * CARD_H + (rowCount - 1) * CARD_GAP + 16;
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

    // Rounded rect helper
    const rrect = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };

    let y = PAD;

    // ── HEADER ──
    const seasonName = seasonMeta?.name || `Season ${selectedSeasonId}`;
    rrect(PAD, y, gridWidth, HEADER_H, 10);
    ctx.fillStyle = COL.leaf;
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.font = FONT('700', 18);
    ctx.fillStyle = '#fff';
    ctx.fillText(`${seasonName} — Round ${roundNo}`, PAD + gridWidth / 2, y + 24);
    ctx.font = BODY('400', 11);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    const totalMatches = matches.length;
    const completedMatches = matches.filter((f) => String(f.status || '').toUpperCase() === 'COMPLETED').length;
    ctx.fillText(`${completedMatches}/${totalMatches} matches completed`, PAD + gridWidth / 2, y + 42);
    y += HEADER_H + 12;

    // ── PER TIER ──
    for (const group of tierGroups) {
      // Tier header
      ctx.textAlign = 'left';
      ctx.font = FONT('700', 12);
      ctx.fillStyle = COL.leaf;
      ctx.fillText(`League ${group.tier}`, PAD + 4, y + 20);
      // Underline
      ctx.strokeStyle = COL.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD, y + TIER_HEADER_H - 4);
      ctx.lineTo(PAD + gridWidth, y + TIER_HEADER_H - 4);
      ctx.stroke();
      y += TIER_HEADER_H;

      for (let i = 0; i < group.rows.length; i++) {
        const row = group.rows[i];
        const col = i % COLS;
        const gridRow = Math.floor(i / COLS);
        const cx = PAD + col * (CARD_W + CARD_GAP);
        const cy = y + gridRow * (CARD_H + CARD_GAP);

        const home = teamSnap(row, 'home');
        const away = teamSnap(row, 'away');
        const status = String(row.status || '').toUpperCase();
        const completed = status === 'COMPLETED';
        const winnerId = Number(row.winner_franchise_id || 0);

        // Card bg
        rrect(cx, cy, CARD_W, CARD_H, 8);
        ctx.fillStyle = COL.surface;
        ctx.fill();
        ctx.strokeStyle = COL.border;
        ctx.lineWidth = 0.8;
        ctx.stroke();

        // Winner accent bar
        if (completed && winnerId) {
          rrect(cx, cy, CARD_W, 3, 0);
          ctx.fillStyle = COL.leaf;
          ctx.fill();
        }

        const cardCx = cx + CARD_W / 2;
        let ty = cy + 16;

        // Home team
        ctx.textAlign = 'center';
        ctx.font = BODY('600', 10);
        ctx.fillStyle = winnerId === home.id ? COL.leaf : COL.ink;
        const homeTxt = home.name.length > 18 ? home.name.slice(0, 16) + '…' : home.name;
        ctx.fillText(homeTxt, cardCx, ty);
        ty += 11;
        ctx.font = BODY('400', 7.5);
        ctx.fillStyle = COL.muted;
        ctx.fillText(home.country || '', cardCx, ty);
        ty += 12;

        // Scores or vs
        if (completed) {
          ctx.font = FONT('800', 12);
          ctx.fillStyle = winnerId === home.id ? COL.leaf : COL.ink;
          const hs = scoreLabel(home.score, home.wickets, home.balls);
          ctx.fillText(hs, cardCx, ty);
          ty += 13;
          ctx.fillStyle = COL.muted;
          ctx.font = FONT('400', 7);
          ctx.fillText('vs', cardCx, ty);
          ty += 10;
          ctx.font = FONT('800', 12);
          ctx.fillStyle = winnerId === away.id ? COL.leaf : COL.ink;
          const as = scoreLabel(away.score, away.wickets, away.balls);
          ctx.fillText(as, cardCx, ty);
        } else {
          ctx.font = FONT('600', 11);
          ctx.fillStyle = COL.muted;
          ctx.fillText('vs', cardCx, ty + 10);
        }

        // Away team
        ty = cy + CARD_H - 14;
        ctx.textAlign = 'center';
        ctx.font = BODY('400', 7.5);
        ctx.fillStyle = COL.muted;
        ctx.fillText(away.country || '', cardCx, ty - 10);
        ctx.font = BODY('600', 10);
        ctx.fillStyle = winnerId === away.id ? COL.leaf : COL.ink;
        const awayTxt = away.name.length > 18 ? away.name.slice(0, 16) + '…' : away.name;
        ctx.fillText(awayTxt, cardCx, ty);
      }

      const rowCount = Math.ceil(group.rows.length / COLS);
      y += rowCount * CARD_H + (rowCount - 1) * CARD_GAP + 16;
    }

    // Footer
    ctx.textAlign = 'center';
    ctx.font = BODY('400', 9);
    ctx.fillStyle = COL.muted;
    ctx.fillText('Cricket Architect', PAD + gridWidth / 2, y + 14);

    // Download
    const sName = (seasonMeta?.name || 'season').replace(/\s+/g, '-').toLowerCase();
    const link = document.createElement('a');
    link.download = `round-${roundNo}-${sName}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  useEffect(() => {
    if (isInternationalSeason && tab === 'knockouts') {
      setTab('regular');
    }
  }, [isInternationalSeason, tab]);

  if (loading) return <div className="sq-loading"><div className="sq-spinner" /><span>Loading fixtures...</span></div>;

  /* ── Render a single fixture row ── */
  function renderFixtureRow(row) {
    const status = String(row.status || '').toUpperCase();
    const completed = status === 'COMPLETED';
    const live = status === 'LIVE';
    const pending = !completed && !live;
    const blocked = isFutureRoundBlocked(row);
    const rowIsActive = activeSimulation && Number(activeSimulation.rowId || 0) === Number(row.id || 0);
    const managed = isManagedFixture(row);
    const winnerId = Number(row.winner_franchise_id || 0);

    const home = teamSnap(row, 'home');
    const away = teamSnap(row, 'away');
    const order = battingOrder(row);

    const homeWon = winnerId === home.id;
    const awayWon = winnerId === away.id;

    return (
      <div
        key={row.id}
        className={`fxr ${managed ? 'fxr--mine' : ''} ${completed ? 'fxr--done' : ''} ${live ? 'fxr--live' : ''}`}
        onClick={() => navigate(`/matches/${row.id}?season=${seasonId || ''}&round=${selectedRound || row.round_no}`)}
      >
        {/* Left: home team */}
        <div className={`fxr-team fxr-team--home ${homeWon ? 'fxr-team--won' : ''}`}>
          <TeamNameButton franchiseId={home.id} name={home.name} country={home.country} className="fxr-team-name">
            {home.name}
          </TeamNameButton>
          {home.country && <span className="fxr-team-flag">{home.country}</span>}
          {(completed || live) && (
            <span className={`fxr-mob-score ${homeWon ? 'fxr-score--won' : ''}`}>
              {scoreLabel(home.score, home.wickets, home.balls)}
            </span>
          )}
        </div>

        {/* Center: score block (desktop only) */}
        <div className="fxr-center">
          {completed || live ? (
            <div className="fxr-scores">
              <span className={`fxr-score ${homeWon ? 'fxr-score--won' : ''}`}>
                {scoreLabel(home.score, home.wickets, home.balls)}
              </span>
              <span className="fxr-score-sep">–</span>
              <span className={`fxr-score ${awayWon ? 'fxr-score--won' : ''}`}>
                {scoreLabel(away.score, away.wickets, away.balls)}
              </span>
            </div>
          ) : (
            <span className="fxr-vs">vs</span>
          )}
          {/* Result / status line */}
          <div className="fxr-meta">
            {live && <span className="fxr-badge fxr-badge--live">LIVE</span>}
            {pending && <span className="fxr-scheduled">Scheduled</span>}
            {order && completed && (
              <span className="fxr-toss">
                {order.homeBattedFirst ? home.name : away.name} batted first
              </span>
            )}
          </div>
          {completed && winnerId > 0 && (
            <span className="fxr-result">
              {homeWon ? home.name : away.name} won
            </span>
          )}
          {completed && !winnerId && <span className="fxr-result fxr-result--tie">Tied</span>}
          {/* Sim progress */}
          {rowIsActive && (
            <div className="fxr-sim">
              <div className="fxr-sim-track"><div className="fxr-sim-fill" style={{ width: `${activeSimulationPercent}%` }} /></div>
            </div>
          )}
        </div>

        {/* Right: away team */}
        <div className={`fxr-team fxr-team--away ${awayWon ? 'fxr-team--won' : ''}`}>
          <TeamNameButton franchiseId={away.id} name={away.name} country={away.country} className="fxr-team-name">
            {away.name}
          </TeamNameButton>
          {away.country && <span className="fxr-team-flag">{away.country}</span>}
          {(completed || live) && (
            <span className={`fxr-mob-score ${awayWon ? 'fxr-score--won' : ''}`}>
              {scoreLabel(away.score, away.wickets, away.balls)}
            </span>
          )}
        </div>

        {/* Far right: actions */}
        <div className="fxr-actions" onClick={(e) => e.stopPropagation()}>
          {pending && (
            <button
              type="button"
              className="fxr-btn fxr-btn--sim"
              onClick={() => simulateFixtureWithoutOpening(row)}
              disabled={blocked || simulatingAction}
              title={blocked ? `Complete earlier rounds first` : managed ? 'Play Round' : 'Simulate'}
            >
              {rowIsActive && simulatingAction ? '...' : '▶'}
            </button>
          )}
          {live && (
            <button type="button" className="fxr-btn fxr-btn--reset" onClick={() => resetStuckMatch(row.id)} disabled={simulatingAction}>
              ↺
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fx-page">
      {error && <div className="sq-error">{error}<button type="button" onClick={() => setError('')}>×</button></div>}

      {/* ── Top bar: season + tabs ── */}
      <div className="fx-topbar">
        <div className="fx-season-row">
          {seasons.map((s) => (
            <button key={s.id} type="button" className={`fx-season-btn ${Number(s.id) === Number(selectedSeasonId) ? 'active' : ''}`} onClick={() => changeSeason(s.id)}>
              {s.name}
              <span className={`fx-season-status fx-season-status--${(s.status || '').toLowerCase()}`}>{s.status}</span>
            </button>
          ))}
        </div>
        <div className="fx-tab-row">
          <button type="button" className={`fx-tab-btn ${tab === 'regular' ? 'active' : ''}`} onClick={() => setTab('regular')}>
            Regular Season
          </button>
          {!isInternationalSeason && (
            <button type="button" className={`fx-tab-btn ${tab === 'knockouts' ? 'active' : ''}`} onClick={() => setTab('knockouts')}>
              Knockouts
            </button>
          )}
        </div>
      </div>

      {/* ═══ REGULAR SEASON TAB ═══ */}
      {tab === 'regular' && (
        <>
          {!seasonMeta ? (
            <div className="sq-empty">Select a season to view fixtures.</div>
          ) : (
            <>
              {/* Round strip: prev | chips | next */}
              <div className="fx-round-strip">
                <button type="button" className="fx-round-arr" disabled={!previousRound} onClick={() => changeRound(previousRound)}>‹</button>
                <div className="fx-round-scroll">
                  {rounds.map((round) => {
                    const st = roundStatus(round);
                    const active = Number(selectedRound) === Number(round.round_no);
                    return (
                      <button key={round.round_no} type="button" className={`fx-rchip ${active ? 'fx-rchip--active' : ''} fx-rchip--${st}`} onClick={() => changeRound(round.round_no)}>
                        {round.round_no}
                      </button>
                    );
                  })}
                </div>
                <button type="button" className="fx-round-arr" disabled={!nextRound} onClick={() => changeRound(nextRound)}>›</button>
              </div>

              {/* Toolbar: league filters + round info + simulate + share */}
              <div className="fx-toolbar">
                <div className="fx-league-pills">
                  {leagueTierFilters.map((tier) => (
                    <button key={tier} type="button" className={`fx-lpill ${Number(selectedLeagueTier) === tier ? 'fx-lpill--active' : ''}`} onClick={() => changeLeagueFilter(tier)}>
                      {tier === 0 ? 'All' : `L${tier}`}
                    </button>
                  ))}
                </div>
                <div className="fx-toolbar-info">
                  <span className="fx-toolbar-round">Round {selectedRound || '-'}</span>
                  <span className="fx-toolbar-progress">{currentRoundMeta ? `${currentRoundMeta.completed_matches}/${currentRoundMeta.total_matches}` : ''}</span>
                  <span className="fx-toolbar-season-progress">{completedRounds}/{rounds.length} rounds</span>
                </div>
                <div className="fx-toolbar-actions">
                  {/* Share dropdown */}
                  <div className="fx-share-wrap" ref={shareRef}>
                    <button
                      type="button"
                      className="fx-share-btn"
                      onClick={() => setRoundShareOpen((prev) => (prev === selectedRound ? null : selectedRound))}
                      title="Share this round"
                    >
                      📋 Share
                    </button>
                    {roundShareOpen === selectedRound && (
                      <div className="fx-share-dropdown">
                        <button className="fx-share-option" onClick={() => downloadRoundPNG(selectedRound)}>
                          🖼️ Download as PNG
                          <span className="fx-share-hint">Image for social media</span>
                        </button>
                        <button className="fx-share-option" onClick={() => copyRoundBBCode(selectedRound)}>
                          📋 Copy as BB Code
                          <span className="fx-share-hint">Forums (phpBB, XenForo)</span>
                        </button>
                      </div>
                    )}
                    {roundShareCopied && <span className="fx-share-copied">✓ Copied!</span>}
                  </div>
                  {franchise && (
                    <button type="button" className="fx-sim-btn" onClick={simulateMyLeagueRoundNow} disabled={simulatingAction}>
                      {simulatingAction && !activeSimulation?.rowId ? 'Simulating...' : '▶ Simulate Round'}
                    </button>
                  )}
                </div>
              </div>

              {/* Global simulation progress */}
              {activeSimulation && !activeSimulation.rowId && (
                <div className="fx-global-sim">
                  <div className="fx-global-sim-head">
                    <span>{activeSimulation.label}</span>
                    <span>{activeSimulation.total ? `${activeSimulation.completed}/${activeSimulation.total}` : activeSimulation.phase === 'complete' ? 'Done' : '...'}</span>
                  </div>
                  <div className="fxr-sim-track"><div className="fxr-sim-fill" style={{ width: `${activeSimulationPercent}%` }} /></div>
                </div>
              )}

              {/* Fixture rows */}
              {selectedLeagueTier ? (
                <div className="fx-fixture-list">
                  {fixtures.length === 0 ? <div className="sq-empty">No fixtures this round.</div> : fixtures.map(renderFixtureRow)}
                </div>
              ) : (
                roundFixturesByLeague.map((group) => (
                  <section key={group.tier} className="fx-league-section">
                    <div className="fx-league-hdr">
                      <span className={`lg-tier-badge lg-tier-badge--${group.tier}`} style={{ width: 20, height: 20, fontSize: '0.65rem' }}>{group.tier}</span>
                      <span className="fx-league-title">League {group.tier}</span>
                      <span className="fx-league-ct">{group.rows.length}</span>
                    </div>
                    <div className="fx-fixture-list">
                      {group.rows.length === 0
                        ? <div className="sq-empty">No fixtures.</div>
                        : group.rows.map(renderFixtureRow)}
                    </div>
                  </section>
                ))
              )}
            </>
          )}
        </>
      )}

      {/* ═══ KNOCKOUTS TAB ═══ */}
      {tab === 'knockouts' && (
        <>
          <section className="fx-league-section">
            <div className="fx-league-hdr">
              <span className="fx-league-title">Semifinals</span>
              <span className="fx-league-ct">{playoffFixtures.length}</span>
            </div>
            <div className="fx-fixture-list">
              {playoffFixtures.length === 0
                ? <div className="sq-empty">No semifinal fixtures.</div>
                : playoffFixtures.map(renderFixtureRow)}
            </div>
          </section>
          <section className="fx-league-section">
            <div className="fx-league-hdr">
              <span className="fx-league-title">🏆 Final</span>
            </div>
            <div className="fx-fixture-list">
              {finalFixtures.length === 0
                ? <div className="sq-empty">No final fixture yet.</div>
                : finalFixtures.map(renderFixtureRow)}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
